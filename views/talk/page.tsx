import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { useTranslation } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

type TalkMessage = {
  role: "user" | "assistant";
  content: string;
  urgent?: boolean;
};

const starters = [
  { key: "talk.starters.lingering" as TranslationKey },
  { key: "talk.starters.confused" as TranslationKey },
  { key: "talk.starters.listen" as TranslationKey },
];

const maxUserMessages = 8;

export default function TalkPage() {
  const { locale, t } = useTranslation();
  const [messages, setMessages] = useState<TalkMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestHumanSupport, setSuggestHumanSupport] = useState(false);

  const userMessageCount = useMemo(
    () => messages.filter((message) => message.role === "user").length,
    [messages],
  );
  const reachedLimit = userMessageCount >= maxUserMessages;

  async function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    const content = draft.trim();
    if (!content || loading || reachedLimit) return;

    const nextMessages: TalkMessage[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setDraft("");
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/ai/talk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locale,
          messages: nextMessages.map(({ role, content: messageContent }) => ({
            role,
            content: messageContent,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || t("talk.messages.connectionFailed"));
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: typeof data.reply === "string" ? data.reply : t("talk.messages.pause"),
          urgent: data.urgent === true,
        },
      ]);
      setSuggestHumanSupport(data.suggestHumanSupport === true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : t("talk.messages.connectionFailedWithReferral"),
      );
    } finally {
      setLoading(false);
    }
  }

  function startWith(text: string) {
    setDraft(text);
    setError("");
  }

  function resetConversation() {
    setMessages([]);
    setDraft("");
    setError("");
    setSuggestHumanSupport(false);
  }

  return (
    <>
      <PageHero
        title={t("talk.hero.title")}
        subtitle={t("talk.hero.description")}
        aside={
          <IllustrationPanel
            src="/illustrations/system/feature-talk.webp"
            alt={t("talk.hero.imageAlt")}
            priority
          />
        }
      />

      <section className="section section-muted pt-8 sm:pt-12">
        <div className="container grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="overflow-hidden rounded-2xl border border-ink/10 bg-white/85 shadow-soft">
            <div className="border-b border-ink/10 px-5 py-4 sm:px-6">
              <p className="font-bold text-ink">{t("talk.session.title")}</p>
              <p className="mt-1 text-xs leading-6 text-muted">
                {t("talk.session.description")}
              </p>
            </div>

            <div className="min-h-80 space-y-4 px-4 py-6 sm:px-6" aria-live="polite">
              {messages.length === 0 ? (
                <div>
                  <p className="text-sm font-bold text-ink">{t("talk.starters.title")}</p>
                  <div className="mt-4 grid gap-3">
                    {starters.map((starter) => (
                      <button
                        key={starter.key}
                        type="button"
                        className="min-h-11 rounded-xl border border-ink/10 bg-cream px-4 py-3 text-left text-sm font-bold leading-6 text-ink/75 transition hover:border-sage/50"
                        onClick={() => startWith(t(starter.key))}
                      >
                        {t(starter.key)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-7 sm:max-w-[75%] ${
                      message.role === "user"
                        ? "bg-sage text-white"
                        : message.urgent
                          ? "border border-[#d59b78] bg-[#fff6ef] font-bold text-ink"
                          : "bg-cream text-ink"
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              ))}
              {loading ? (
                <div className="flex justify-start">
                  <p className="rounded-2xl bg-cream px-4 py-3 text-sm text-muted">{t("talk.session.organizing")}</p>
                </div>
              ) : null}
            </div>

            <form className="border-t border-ink/10 p-4 sm:p-6" onSubmit={sendMessage}>
              <label className="grid gap-2">
                <span className="sr-only">{t("talk.form.label")}</span>
                <textarea
                  className="min-h-24 w-full resize-y rounded-2xl border border-ink/10 bg-white p-4 leading-7 outline-none transition focus:border-sage"
                  value={draft}
                  maxLength={500}
                  disabled={loading || reachedLimit}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={reachedLimit ? t("talk.form.limitPlaceholder") : t("talk.form.placeholder")}
                />
              </label>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <VoiceInputButton value={draft} onChange={setDraft} />
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted">{draft.length}/500</span>
                  <button
                    type="submit"
                    className="button-primary px-5 py-2 text-xs"
                    disabled={!draft.trim() || loading || reachedLimit}
                  >
                    {t("talk.actions.send")}
                  </button>
                </div>
              </div>
              {error ? <p className="mt-3 text-sm font-bold text-sage-dark">{error}</p> : null}
            </form>
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-ink/10 bg-white/80 p-5">
              <p className="font-bold text-ink">{t("talk.support.title")}</p>
              <p className="mt-3 text-sm leading-7 text-muted">
                {t("talk.support.description")}
              </p>
              <Link href="/referral" className="button-secondary mt-5 w-full px-4 py-2 text-xs">
                {t("talk.actions.viewReferral")}
              </Link>
            </div>
            {suggestHumanSupport || reachedLimit ? (
              <div className="rounded-2xl border border-sage/25 bg-mist p-5">
                <p className="font-bold text-ink">{t("talk.support.tellSomeoneTitle")}</p>
                <p className="mt-2 text-sm leading-7 text-muted">
                  {t("talk.support.tellSomeoneText")}
                </p>
              </div>
            ) : null}
            {messages.length > 0 ? (
              <button type="button" className="button-secondary w-full px-4 py-2 text-xs" onClick={resetConversation}>
                {t("talk.actions.clear")}
              </button>
            ) : null}
          </aside>
        </div>
      </section>
    </>
  );
}
