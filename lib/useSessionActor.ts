import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabaseClient";

/** Private UI lifetime only. Permission decisions remain in each existing API. */
export function useSessionActor() {
  const [actorId, setActorId] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready" | "signed_out" | "error">("loading");
  const [revision, setRevision] = useState(0);
  const actor = useRef("");
  const mounted = useRef(false);
  const epoch = useRef(0);
  const reads = useRef(0);

  const apply = useCallback((session: Session | null) => {
    const id = session?.access_token ? session.user.id : "";
    if (id !== actor.current) { actor.current = id; ++epoch.current; setRevision(epoch.current); }
    setActorId(id);
    setPhase(id ? "ready" : "signed_out");
  }, []);

  const refreshIdentity = useCallback(async () => {
    const request = ++reads.current;
    let timeout: number | undefined;
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error("session_unavailable");
      const result = await Promise.race([
        supabase.auth.getSession(),
        new Promise<never>((_resolve, reject) => { timeout = window.setTimeout(() => reject(new Error("session_timeout")), 10_000); }),
      ]);
      if (!mounted.current || request !== reads.current) return;
      if (result.error) throw new Error("session_unavailable");
      apply(result.data.session);
    } catch {
      if (!mounted.current || request !== reads.current) return;
      ++epoch.current;
      setRevision(epoch.current);
      actor.current = "";
      setActorId("");
      setPhase("error");
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
    }
  }, [apply]);

  useEffect(() => {
    mounted.current = true;
    void refreshIdentity();
    const subscription = getSupabase()?.auth.onAuthStateChange((event, session) => {
      if (!mounted.current) return;
      // The callback is synchronous; do not await another Auth call under its lock.
      if (event === "INITIAL_SESSION") return;
      ++reads.current;
      apply(session);
    });
    return () => {
      mounted.current = false;
      ++reads.current;
      ++epoch.current;
      subscription?.data.subscription.unsubscribe();
    };
  }, [apply, refreshIdentity]);

  const trackRequest = useCallback(() => {
    const revision = epoch.current;
    const id = actor.current;
    return () => mounted.current && Boolean(id) && id === actor.current && revision === epoch.current;
  }, []);
  const isSameActor = useCallback((id: string) => mounted.current && Boolean(id) && id === actor.current, []);
  const isCurrentRevision = useCallback((revision: number) => mounted.current && revision === epoch.current, []);

  const getToken = useCallback(async (expectedId = actorId) => {
    const id = expectedId;
    const current = trackRequest();
    let timeout: number | undefined;
    try {
      const supabase = getSupabase();
      if (!id || id !== actor.current || !supabase) throw new Error("session_unavailable");
      const result = await Promise.race([
        supabase.auth.getSession(),
        new Promise<never>((_resolve, reject) => { timeout = window.setTimeout(() => reject(new Error("session_timeout")), 10_000); }),
      ]);
      if (!current() || result.error || result.data.session?.user.id !== id || !result.data.session.access_token) {
        throw new Error("session_changed");
      }
      return result.data.session.access_token;
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
    }
  }, [actorId, trackRequest]);

  return { actorId, phase, revision, refreshIdentity, trackRequest, isSameActor, isCurrentRevision, getToken };
}

export type SessionActor = ReturnType<typeof useSessionActor>;
