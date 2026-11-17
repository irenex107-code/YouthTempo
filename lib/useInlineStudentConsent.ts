import type { Session, User } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { createConsentWriteIntent, isAccountConsentSnapshot, isConsentWriteResponse, isVerifiedConsentOperation, saveProfile,
  type ConsentWriteIntent, type AccountStatus, type StudentConsentResponse } from "@/lib/cloudRecords";
import { getSupabase } from "@/lib/supabaseClient";
import { isActiveStudentConsent, STUDENT_CONSENT_POLICY_VERSION, type StudentAgeBand } from "@/lib/studentConsent";

export type InlineConsentPhase = "loading" | "signed_out" | "needs_profile" | "needs_consent"
  | "pending_guardian" | "ineligible" | "ready" | "other" | "error" | "unknown";

function withSignal<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("request_interrupted"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** UI state only: the existing API and database remain authoritative. */
export function useInlineStudentConsent() {
  const [phase, setPhase] = useState<InlineConsentPhase>("loading");
  const [userId, setUserId] = useState("");
  const [summary, setSummary] = useState<StudentConsentResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKind, setErrorKind] = useState<"load" | "submit" | "profile" | null>(null);
  const generation = useRef(0);
  const currentUser = useRef<User | null>(null);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const mutating = useRef(false);
  const needsVerification = useRef(false);
  const pendingWrites = useRef(new Map<string, { intent: ConsentWriteIntent; ageBand: StudentAgeBand }>());
  const mutationEpoch = useRef(0);
  const accessEpoch = useRef(0);
  const lastAccess = useRef("");

  function recordAccess(key: string) {
    if (key !== lastAccess.current) { lastAccess.current = key; ++accessEpoch.current; }
  }

  const refresh = useCallback(async (knownSession?: Session | null, verifyOperation = false) => {
    const revision = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    if (mounted.current) {
      // Background verification must not unmount a same-account draft.
      setPhase((current) => pendingWrites.current.has(currentUser.current?.id || "") ? "unknown"
        : current === "ready" || current === "other" ? current : "loading");
      setErrorKind(null);
    }
    const valid = () => mounted.current && revision === generation.current;
    try {
      const supabase = getSupabase();
      const session = knownSession === undefined
        ? (supabase ? (await withSignal(supabase.auth.getSession(), controller.signal)).data.session : null) : knownSession;
      if (!valid()) return;
      currentUser.current = session?.user || null;
      setUserId(session?.user.id || "");
      needsVerification.current = pendingWrites.current.has(session?.user.id || "");
      if (!session?.access_token) {
        recordAccess("signed_out");
        setSummary(null);
        setPhase("signed_out");
        return;
      }
      const headers = { authorization: `Bearer ${session.access_token}` };
      const pending = pendingWrites.current.get(session.user.id);
      const lookup = verifyOperation && pending ? `?operationId=${encodeURIComponent(pending.intent.operationId)}` : "";
      const [statusResponse, consentResponse] = await Promise.all([
        fetch("/api/account/status", { headers, cache: "no-store", signal: controller.signal }),
        fetch(`/api/account/consent${lookup}`, { headers, cache: "no-store", signal: controller.signal }),
      ]);
      if (!valid()) return;
      if (statusResponse.status === 401 || consentResponse.status === 401) {
        if (pending) { recordAccess("unverified"); setPhase("unknown"); setErrorKind("load"); return; }
        recordAccess("signed_out");
        currentUser.current = null;
        setUserId("");
        setPhase("signed_out");
        return;
      }
      if (!statusResponse.ok || !consentResponse.ok) throw new Error("consent_status_unavailable");
      const [status, consent] = await Promise.all([
        statusResponse.json() as Promise<AccountStatus>,
        consentResponse.json() as Promise<StudentConsentResponse>,
      ]);
      if (!valid()) return;
      if (!isAccountConsentSnapshot(consent, session.user.id)) throw new Error("invalid_consent_response");
      if (pending) {
        if (!verifyOperation || pendingWrites.current.get(session.user.id) !== pending
          || !isVerifiedConsentOperation(consent, pending.intent, "student_assent", pending.ageBand)) {
          // A valid active/withdrawn snapshot does not settle this operation.
          setSummary(consent); needsVerification.current = true;
          recordAccess("unverified"); setPhase("unknown");
          if (verifyOperation) setErrorKind("load");
          return;
        }
        pendingWrites.current.delete(session.user.id);
        needsVerification.current = false;
      }
      if (!status.profile?.display_name?.trim() && !status.hasSchool && !status.adminAccess) {
        recordAccess(`${session.user.id}:needs_profile`);
        setPhase("needs_profile");
        return;
      }
      if (consent.role !== "student") {
        if (!["guardian", "other"].includes(consent.role)) throw new Error("invalid_consent_response");
        needsVerification.current = false;
        recordAccess(`${session.user.id}:other`);
        setPhase("other");
        return;
      }
      if (consent.policyVersion !== STUDENT_CONSENT_POLICY_VERSION
        || consent.consent?.studentUserId !== session.user.id) throw new Error("invalid_consent_response");
      const c = consent.consent;
      const active = isActiveStudentConsent({
        age_band: c.ageBand!, consent_basis: c.consentBasis!, policy_version: c.policyVersion,
        status: c.status === "not_started" ? "withdrawn" : c.status,
        student_assented_at: c.studentAssentedAt, guardian_user_id: c.guardianUserId,
        guardian_consented_at: c.guardianConsentedAt,
      });
      setSummary(consent);
      recordAccess(JSON.stringify([session.user.id, c.status, c.ageBand, c.consentBasis, c.policyVersion,
        c.studentAssentedAt, c.guardianUserId, c.guardianConsentedAt, c.withdrawnAt, consent.consentRevision]));
      needsVerification.current = false;
      setPhase(active ? "ready" : c.status === "ineligible" || c.ageBand === "under_14" ? "ineligible"
        : c.status === "pending_guardian" ? "pending_guardian" : "needs_consent");
    } catch {
      if (valid()) {
        recordAccess("unverified");
        setPhase(needsVerification.current ? "unknown" : "error");
        setErrorKind("load");
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const supabase = getSupabase();
    // Do not await Auth calls inside Supabase's synchronous auth callback.
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      const changed = session?.user.id !== currentUser.current?.id || event === "SIGNED_OUT";
      if (changed) {
        recordAccess(`actor:${session?.user.id || "signed_out"}`);
        ++generation.current;
        request.current?.abort();
        currentUser.current = session?.user || null;
        setUserId(session?.user.id || "");
        setSummary(null);
        needsVerification.current = pendingWrites.current.has(session?.user.id || "");
        ++mutationEpoch.current; mutating.current = false; setBusy(false);
        setPhase(session ? "loading" : "signed_out");
      }
      window.setTimeout(() => {
        if ((session?.user.id || "") !== (currentUser.current?.id || "")) return;
        if (mounted.current && (changed || !mutating.current)) void refresh(session);
      }, 0);
    });
    const check = () => { if (!mutating.current) void refresh(); };
    const onVisibility = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", check);
    window.addEventListener("youthtempo:consent-updated", check);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted.current = false;
      ++generation.current;
      request.current?.abort();
      subscription?.data.subscription.unsubscribe();
      window.removeEventListener("focus", check);
      window.removeEventListener("youthtempo:consent-updated", check);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  async function assent(ageBand: StudentAgeBand) {
    if (mutating.current || needsVerification.current || phase !== "needs_consent") return false;
    mutating.current = true;
    const mutation = ++mutationEpoch.current;
    setBusy(true);
    setErrorKind(null);
    const actor = currentUser.current?.id;
    const revision = generation.current;
    const valid = () => mounted.current && mutation === mutationEpoch.current
      && actor === currentUser.current?.id && revision === generation.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    try {
      const intent = createConsentWriteIntent(summary, actor || "");
      const supabase = getSupabase();
      const session = supabase ? (await withSignal(supabase.auth.getSession(), controller.signal)).data.session : null;
      if (!valid()) return false;
      if (!actor || session?.user.id !== actor || !session?.access_token) throw new Error("actor_changed");
      // A failed response can follow a successful write. Always re-read before a new POST.
      needsVerification.current = true;
      const pending = { intent, ageBand }; pendingWrites.current.set(actor, pending);
      const response = await fetch("/api/account/consent", {
        method: "POST", signal: controller.signal, cache: "no-store",
        headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "student_assent", ageBand, operationId: intent.operationId, expectedUpdatedAt: intent.expectedUpdatedAt }),
      });
      if (!valid()) return false;
      const result: unknown = await withSignal(response.json(), controller.signal);
      if (!valid()) return false;
      if (!response.ok || !isConsentWriteResponse(result, actor, intent, "student_assent", ageBand)) throw new Error("assent_unconfirmed");
      if (pendingWrites.current.get(actor) !== pending) return false;
      pendingWrites.current.delete(actor); needsVerification.current = false;
      // Read the authoritative state; never infer active from an optimistic form submission.
      await refresh(session);
      if (!mounted.current || actor !== currentUser.current?.id || mutation !== mutationEpoch.current) return false;
      window.dispatchEvent(new Event("youthtempo:consent-updated"));
      return true;
    } catch {
      if (valid()) {
        recordAccess("unverified");
        setPhase(needsVerification.current ? "unknown" : "error");
        setErrorKind("submit");
      }
      return false;
    } finally {
      window.clearTimeout(timeout);
      if (mutation === mutationEpoch.current) { mutating.current = false; if (mounted.current) setBusy(false); }
    }
  }

  async function completeProfile(displayName: string) {
    const user = currentUser.current;
    if (!user || !displayName.trim() || mutating.current) return;
    mutating.current = true;
    const mutation = ++mutationEpoch.current;
    setBusy(true);
    setErrorKind(null);
    try {
      await saveProfile(user, displayName.trim());
      if (user.id === currentUser.current?.id) await refresh();
    } catch {
      if (mounted.current && user.id === currentUser.current?.id) setErrorKind("profile");
    } finally {
      if (mutation === mutationEpoch.current) { mutating.current = false; if (mounted.current) setBusy(false); }
    }
  }

  function trackRequest() {
    const revision = accessEpoch.current;
    const actor = currentUser.current?.id;
    return () => mounted.current && revision === accessEpoch.current && actor === currentUser.current?.id;
  }

  const isSameActor = (id: string) => mounted.current && id === currentUser.current?.id;
  return { phase, userId, summary, busy, errorKind, refresh, assent, completeProfile, trackRequest, isSameActor,
    canProceed: phase === "ready" || phase === "other", studentReady: phase === "ready" };
}

export type InlineStudentConsentController = ReturnType<typeof useInlineStudentConsent>;
