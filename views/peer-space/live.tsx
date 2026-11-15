import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { MicroPilotFeedback } from "@/components/MicroPilotFeedback";
import { InlineStudentConsent } from "@/components/InlineStudentConsent";
import { useInlineStudentConsent } from "@/lib/useInlineStudentConsent";
import { useTranslation } from "@/lib/i18n/client";
import { PeerSpaceRequestError, peerSpaceRequest, type PeerChatMessage, type PeerRoomSummary } from "@/lib/peerSpaceClient";

type Access = { available: false } | { available: true; rulesAccepted: boolean; rulesVersion: string };
type RoomsResponse = { rulesAccepted: boolean; rooms: PeerRoomSummary[] };
type MessagesResponse = { messages: PeerChatMessage[]; roomStatus: PeerRoomSummary["status"] };
type Control = { id: string; type: "block" | "mute"; targetLabel: string };
const reportReasons = ["privacy", "harassment", "safety", "other"] as const;

export default function PeerSpaceLivePage() {
  const { locale, t } = useTranslation();
  const consent = useInlineStudentConsent();
  const lifecycle = useRef(0);
  const selectedRoom = useRef<string | null>(null);
  const inFlight = useRef(false);
  const roomsRequest = useRef(0);
  const messagesRequest = useRef(0);
  const controlsRequest = useRef(0);
  const [access, setAccess] = useState<Access | null>(null);
  const [rooms, setRooms] = useState<PeerRoomSummary[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PeerChatMessage[]>([]);
  const [controls, setControls] = useState<Control[]>([]);
  const [draft, setDraft] = useState("");
  const [rulesChecked, setRulesChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [feedbackTrigger, setFeedbackTrigger] = useState(0);
  const room = rooms.find((candidate) => candidate.id === selectedRoomId) || null;

  function trackPeerRequest(roomId?: string) {
    const revision = lifecycle.current;
    const actor = consent.userId;
    const current = consent.trackRequest();
    return {
      current: () => revision === lifecycle.current && current() && (!roomId || selectedRoom.current === roomId),
      settled: () => revision === lifecycle.current && consent.isSameActor(actor),
    };
  }

  const loadRooms = useCallback(async () => {
    const revision = ++roomsRequest.current;
    const guard = trackPeerRequest();
    const result = await peerSpaceRequest<RoomsResponse>("/api/peer-space/rooms", locale, "GET", undefined, consent.userId);
    if (!guard.current() || revision !== roomsRequest.current) return;
    const nextRoom = selectedRoom.current && result.rooms.some((candidate) => candidate.id === selectedRoom.current)
      ? selectedRoom.current : result.rooms[0]?.id || null;
    selectedRoom.current = nextRoom;
    setRooms(result.rooms);
    setSelectedRoomId(nextRoom);
  }, [locale, consent.userId]);

  const refreshMessages = useCallback(async (roomId: string) => {
    const revision = ++messagesRequest.current;
    const guard = trackPeerRequest(roomId);
    const result = await peerSpaceRequest<MessagesResponse>(
      `/api/peer-space/messages?roomId=${encodeURIComponent(roomId)}`, locale, "GET", undefined, consent.userId,
    );
    if (!guard.current() || revision !== messagesRequest.current) return;
    setMessages(result.messages);
    setRooms((current) => current.map((item) => item.id === roomId ? { ...item, status: result.roomStatus } : item));
  }, [locale, consent.userId]);

  const refreshControls = useCallback(async (roomId: string) => {
    const revision = ++controlsRequest.current;
    const guard = trackPeerRequest(roomId);
    const result = await peerSpaceRequest<{ controls: Control[] }>(
      `/api/peer-space/controls?roomId=${encodeURIComponent(roomId)}`, locale, "GET", undefined, consent.userId,
    );
    if (guard.current() && revision === controlsRequest.current) setControls(result.controls);
  }, [locale, consent.userId]);

  useEffect(() => { setRulesChecked(false); }, [access?.available ? access.rulesVersion : null]);

  useEffect(() => {
    setAccess(null); setRooms([]); selectedRoom.current = null; setSelectedRoomId(null);
    setMessages([]); setControls([]); setDraft(""); setRulesChecked(false);
    setBusy(false); inFlight.current = false; setNotice(""); setError(""); setFeedbackTrigger(0);
  }, [consent.userId, consent.studentReady]);

  useEffect(() => {
    let active = true;
    ++lifecycle.current;
    const guard = trackPeerRequest();
    setLoading(consent.phase === "loading" || consent.studentReady);
    if (!consent.studentReady) return () => { active = false; ++lifecycle.current; };
    peerSpaceRequest<Access>("/api/peer-space/access", locale, "GET", undefined, consent.userId)
      .then(async (result) => {
        if (!active || !guard.current()) return;
        setAccess(result);
        if (result.available && result.rulesAccepted) await loadRooms();
      })
      .catch((caught) => {
        if (active && guard.current()) setError(caught instanceof Error ? caught.message : t("peerSpaceChat.errors.unavailable"));
      })
      .finally(() => { if (active && guard.settled()) setLoading(false); });
    return () => { active = false; ++lifecycle.current; };
  }, [locale, loadRooms, consent.userId, consent.studentReady, consent.phase, t]);

  useEffect(() => {
    setMessages([]); setControls([]);
    if (!consent.studentReady || !room?.joined) return;
    let active = true;
    const roomId = room.id;
    const revision = lifecycle.current;
    const actor = consent.userId;
    const currentRoom = () => active && revision === lifecycle.current && consent.isSameActor(actor) && selectedRoom.current === roomId;
    const refresh = async () => {
      if (!currentRoom() || document.visibilityState === "hidden") return;
      const guard = trackPeerRequest(roomId);
      try { await refreshMessages(roomId); }
      catch (caught) {
        if (currentRoom() && guard.current()) {
          setMessages([]);
          setError(caught instanceof Error ? caught.message : t("peerSpaceChat.errors.unavailable"));
        }
      }
    };
    void refresh();
    const controlGuard = trackPeerRequest(roomId);
    void refreshControls(roomId).catch(() => { if (currentRoom() && controlGuard.current()) setControls([]); });
    const interval = window.setInterval(refresh, 5000);
    return () => { active = false; window.clearInterval(interval); };
  }, [room?.id, room?.joined, refreshMessages, refreshControls, consent.studentReady, t]);

  async function run(action: (current: () => boolean) => Promise<void>, success?: string) {
    if (!consent.studentReady || inFlight.current) return;
    const guard = trackPeerRequest(selectedRoom.current || undefined);
    inFlight.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      await action(guard.current);
      if (guard.current() && success) setNotice(success);
    } catch (caught) {
      if (!guard.current()) return;
      setError(caught instanceof Error ? caught.message : t("peerSpaceChat.errors.unavailable"));
      if (caught instanceof PeerSpaceRequestError && caught.urgent) setNotice(t("peerSpaceLive.urgent"));
    } finally {
      if (guard.settled()) { inFlight.current = false; setBusy(false); }
    }
  }

  async function acceptRules() {
    if (!access?.available || !rulesChecked) return;
    await run(async (current) => {
      await peerSpaceRequest("/api/peer-space/rules", locale, "POST", {
        accepted: true, rulesVersion: access.rulesVersion,
      }, consent.userId);
      if (!current()) return;
      setAccess({ ...access, rulesAccepted: true });
      await loadRooms();
    });
  }

  async function joinOrLeave(target: PeerRoomSummary) {
    await run(async (current) => {
      await peerSpaceRequest("/api/peer-space/rooms", locale, target.joined ? "DELETE" : "POST", { roomId: target.id }, consent.userId);
      if (!current()) return;
      if (target.joined) {
        setMessages([]); setControls([]); setDraft("");
        setFeedbackTrigger((value) => value + 1);
      }
      await loadRooms();
    }, target.joined ? t("peerSpaceLive.left") : t("peerSpaceLive.joined"));
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!room?.joined || room.status !== "staffed_open" || !draft.trim()) return;
    const sentDraft = draft;
    await run(async (current) => {
      const result = await peerSpaceRequest<{ safetyNotice: boolean; reviewPending: boolean }>(
        "/api/peer-space/messages", locale, "POST", { roomId: room.id, body: sentDraft.trim() }, consent.userId,
      );
      if (!current()) return;
      setDraft((value) => value === sentDraft ? "" : value);
      await refreshMessages(room.id);
      if (!current()) return;
      if (result.safetyNotice) setNotice(t("peerSpaceLive.urgent"));
      else if (result.reviewPending) setNotice(t("peerSpaceLive.reviewPending"));
    });
  }

  async function messageAction(message: PeerChatMessage, action: "report" | "block" | "mute" | "delete") {
    if (!room) return;
    let reasonCode: (typeof reportReasons)[number] = "other";
    if (action === "report") {
      const answer = window.prompt(t("peerSpaceLive.reportPrompt"), "safety");
      if (!answer || !reportReasons.includes(answer as typeof reasonCode)) return;
      reasonCode = answer as typeof reasonCode;
    }
    await run(async (current) => {
      if (action === "delete") {
        await peerSpaceRequest("/api/peer-space/messages", locale, "DELETE", { messageId: message.id }, consent.userId);
      } else if (action === "report") {
        const result = await peerSpaceRequest<{ safetyNotice: boolean }>(
          "/api/peer-space/reports", locale, "POST", { roomId: room.id, messageId: message.id, reasonCode }, consent.userId,
        );
        if (!current()) return;
        setNotice(result.safetyNotice ? t("peerSpaceLive.urgent") : t("peerSpaceLive.reported"));
      } else {
        await peerSpaceRequest("/api/peer-space/controls", locale, "POST", {
          roomId: room.id, messageId: message.id, controlType: action,
        }, consent.userId);
        if (!current()) return;
        await refreshControls(room.id);
      }
      if (current()) await refreshMessages(room.id);
    }, action === "report" ? undefined : t("peerSpaceLive.updated"));
  }

  return (
    <>
      <PageHero
        label={t("peerSpaceLive.label")}
        title={t("peerSpaceLive.title")}
        subtitle={t("peerSpaceLive.description")}
        action={<Link href="/referral" className="button-secondary">{t("peerSpaceLive.support")}</Link>}
      />
      <div className="section section-muted min-h-[50vh]">
        <div className="container max-w-5xl min-w-0 space-y-5">
          <InlineStudentConsent controller={consent} studentOnly />
          {loading ? <p role="status">{t("peerSpace.loading")}</p> : null}
          {error ? <p role="alert" className="rounded-xl bg-white p-4 text-sm text-ink">{error}</p> : null}
          {notice ? <p role="status" className="rounded-xl bg-mint p-4 text-sm text-ink">{notice}</p> : null}
          <MicroPilotFeedback feature="peer_space" trigger={feedbackTrigger} crisis={notice === t("peerSpaceLive.urgent")} />
          {consent.studentReady && !loading && !access?.available ? (
            <section className="card">
              <h2 className="text-xl font-bold">{t("peerSpace.unavailable.title")}</h2>
              <p className="mt-2 text-sm text-muted">{t("peerSpace.unavailable.description")}</p>
              <Link href="/account?next=/peer-space" className="button-primary mt-5">{t("peerSpaceLive.account")}</Link>
            </section>
          ) : null}
          {consent.studentReady && access?.available && !access.rulesAccepted ? (
            <section className="card">
              <h2 className="text-xl font-bold">{t("peerSpace.rules.title")}</h2>
              <p className="mt-2 text-sm leading-7 text-muted">{t("peerSpace.rules.description")}</p>
              <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-7 text-ink">
                <li>{t("peerSpace.rules.items.realtimeDuty.text")}</li>
                <li>{t("peerSpace.rules.items.privacySafety.text")}</li>
              </ul>
              <label className="mt-5 flex items-start gap-3 text-sm">
                <input type="checkbox" checked={rulesChecked} onChange={(event) => setRulesChecked(event.target.checked)} />
                {t("peerSpace.rules.confirmation")}
              </label>
              <button type="button" className="button-primary mt-5" disabled={busy || !rulesChecked} onClick={acceptRules}>
                {t("peerSpace.rules.enterAction")}
              </button>
            </section>
          ) : null}
          {consent.studentReady && access?.available && access.rulesAccepted ? (
            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
              <section className="card min-w-0" aria-label={t("peerSpaceLive.rooms")}>
                <h2 className="text-xl font-bold">{t("peerSpaceLive.rooms")}</h2>
                <div className="mt-4 grid gap-3">
                  {rooms.map((item) => (
                    <button key={item.id} type="button" disabled={busy} onClick={() => {
                      if (selectedRoom.current !== item.id) { setDraft(""); setMessages([]); setControls([]); }
                      selectedRoom.current = item.id; setSelectedRoomId(item.id);
                    }}
                      className={`rounded-xl border p-3 text-left focus-visible:ring-2 focus-visible:ring-sage ${item.id === selectedRoomId ? "border-sage bg-mist" : "border-ink/10 bg-white"}`}>
                      <span className="block font-bold">{item.title}</span>
                      <span className="mt-1 block text-xs text-muted">{t(`peerSpaceLive.status.${item.status}`)}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="card min-w-0">
                {room ? (
                  <>
                    <h2 className="text-2xl font-bold">{room.title}</h2>
                    <p className="mt-2 text-sm leading-7 text-muted">{room.description}</p>
                    <p className="mt-3 rounded-xl bg-mist p-3 text-sm leading-6">{room.guidelines}</p>
                    <p className="mt-3 text-sm font-bold" role="status">{t(`peerSpaceLive.status.${room.status}`)}</p>
                    <button type="button" className="button-secondary mt-4" disabled={busy} onClick={() => joinOrLeave(room)}>
                      {room.joined ? t("peerSpaceLive.leave") : t("peerSpaceLive.join")}
                    </button>
                    {room.joined && room.status !== "paused" && room.status !== "closed" ? (
                      <>
                        <div className="mt-5 max-h-[28rem] space-y-3 overflow-y-auto border-t border-ink/10 pt-4" aria-live="polite">
                          {messages.length === 0 ? <p className="text-sm text-muted">{t("peerSpace.room.empty.text")}</p> : null}
                          {messages.map((message) => (
                            <article key={message.id} className="min-w-0 rounded-xl bg-mist/60 p-3">
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                                <strong>{message.authorLabel}</strong>
                                <time dateTime={message.createdAt}>{new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(message.createdAt))}</time>
                                {message.status === "safety_review" ? <span>{t("peerSpaceLive.reviewPending")}</span> : null}
                              </div>
                              <p className="mt-2 break-words whitespace-pre-wrap text-sm leading-6">{message.body}</p>
                              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                                {message.own ? <button type="button" disabled={busy} onClick={() => messageAction(message, "delete")}>{t("peerSpaceLive.delete")}</button> : (
                                  <>
                                    <button type="button" disabled={busy} onClick={() => messageAction(message, "report")}>{t("peerSpaceLive.report")}</button>
                                    <button type="button" disabled={busy} onClick={() => messageAction(message, "block")}>{t("peerSpaceLive.block")}</button>
                                    <button type="button" disabled={busy} onClick={() => messageAction(message, "mute")}>{t("peerSpaceLive.mute")}</button>
                                  </>
                                )}
                              </div>
                            </article>
                          ))}
                        </div>
                        {room.status === "staffed_open" ? (
                          <form onSubmit={sendMessage} className="mt-5">
                            <label htmlFor="peer-message" className="block text-sm font-bold">{t("peerSpace.room.composer.label")}</label>
                            <textarea id="peer-message" className="mt-2 w-full rounded-xl border border-sage/30 p-3 text-sm" rows={3}
                              maxLength={600} value={draft} onChange={(event) => setDraft(event.target.value)}
                              placeholder={t("peerSpace.room.composer.placeholder")} />
                            <button type="submit" className="button-primary mt-3" disabled={busy || !draft.trim()}>{t("peerSpace.room.composer.action")}</button>
                          </form>
                        ) : <p className="mt-5 text-sm text-muted">{t("peerSpace.room.readOnly.notice")}</p>}
                        {controls.length ? (
                          <details className="mt-5 border-t border-ink/10 pt-3">
                            <summary className="cursor-pointer text-sm font-bold">{t("peerSpaceLive.controls")}</summary>
                            <ul className="mt-3 space-y-2">
                              {controls.map((control) => <li key={control.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                                <span>{control.targetLabel} · {t(`peerSpaceLive.${control.type}`)}</span>
                                <button type="button" disabled={busy} className="underline" onClick={() => run(async (current) => {
                                  await peerSpaceRequest("/api/peer-space/controls", locale, "DELETE", { controlId: control.id }, consent.userId);
                                  if (!current()) return;
                                  await refreshControls(room.id);
                                  if (current()) await refreshMessages(room.id);
                                })}>{t("peerSpaceLive.undo")}</button>
                              </li>)}
                            </ul>
                          </details>
                        ) : null}
                      </>
                    ) : null}
                  </>
                ) : <p className="text-sm text-muted">{t("peerSpaceLive.noRooms")}</p>}
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
