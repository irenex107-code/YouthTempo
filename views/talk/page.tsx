import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { VoiceInputButton } from "@/components/VoiceInputButton";

type TalkMessage = {
  role: "user" | "assistant";
  content: string;
  urgent?: boolean;
};

const starters = [
  "我最近有件事一直放不下。",
  "我现在有点乱，不知道从哪里说。",
  "我只想先找个人听我说说。",
];

const maxUserMessages = 8;

export default function TalkPage() {
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
          messages: nextMessages.map(({ role, content: messageContent }) => ({
            role,
            content: messageContent,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI request failed");
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: typeof data.reply === "string" ? data.reply : "我们可以先停一下。",
          urgent: data.urgent === true,
        },
      ]);
      setSuggestHumanSupport(data.suggestHumanSupport === true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "这次没有连接成功，可以稍后再试，或先转到支持路径。",
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
        title="陪我捋一捋"
        subtitle="不用一次说清楚。可以先写下眼前最卡住的一件事，AI 会陪你整理几轮。"
        aside={
          <IllustrationPanel
            src="/illustrations/system/feature-talk.webp"
            alt="把打结的感受慢慢整理成清晰路径的插画"
            priority
          />
        }
      />

      <section className="section section-muted pt-8 sm:pt-12">
        <div className="container grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="overflow-hidden rounded-2xl border border-ink/10 bg-white/85 shadow-soft">
            <div className="border-b border-ink/10 px-5 py-4 sm:px-6">
              <p className="font-bold text-ink">本次对话</p>
              <p className="mt-1 text-xs leading-6 text-muted">
                内容只保留在当前页面，刷新或离开后会清空。AI 不能代替真人或专业支持。
              </p>
            </div>

            <div className="min-h-80 space-y-4 px-4 py-6 sm:px-6" aria-live="polite">
              {messages.length === 0 ? (
                <div>
                  <p className="text-sm font-bold text-ink">可以从一句话开始</p>
                  <div className="mt-4 grid gap-3">
                    {starters.map((starter) => (
                      <button
                        key={starter}
                        type="button"
                        className="min-h-11 rounded-xl border border-ink/10 bg-cream px-4 py-3 text-left text-sm font-bold leading-6 text-ink/75 transition hover:border-sage/50"
                        onClick={() => startWith(starter)}
                      >
                        {starter}
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
                  <p className="rounded-2xl bg-cream px-4 py-3 text-sm text-muted">正在整理你的话…</p>
                </div>
              ) : null}
            </div>

            <form className="border-t border-ink/10 p-4 sm:p-6" onSubmit={sendMessage}>
              <label className="grid gap-2">
                <span className="sr-only">写下想说的话</span>
                <textarea
                  className="min-h-24 w-full resize-y rounded-2xl border border-ink/10 bg-white p-4 leading-7 outline-none transition focus:border-sage"
                  value={draft}
                  maxLength={500}
                  disabled={loading || reachedLimit}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={reachedLimit ? "这次先聊到这里。" : "写下你现在最想说的话…"}
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
                    发送
                  </button>
                </div>
              </div>
              {error ? <p className="mt-3 text-sm font-bold text-sage-dark">{error}</p> : null}
            </form>
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-ink/10 bg-white/80 p-5">
              <p className="font-bold text-ink">什么时候转向真人支持</p>
              <p className="mt-3 text-sm leading-7 text-muted">
                如果已经影响睡眠、吃饭、学习或安全，不用继续和 AI 解释，可以直接找可信任的大人或学校老师。
              </p>
              <Link href="/referral" className="button-secondary mt-5 w-full px-4 py-2 text-xs">
                看看下一步找谁
              </Link>
            </div>
            {suggestHumanSupport || reachedLimit ? (
              <div className="rounded-2xl border border-sage/25 bg-mist p-5">
                <p className="font-bold text-ink">可以让一个人知道</p>
                <p className="mt-2 text-sm leading-7 text-muted">
                  你可以直接说：“我最近有点难撑，能先陪我聊一会儿吗？”
                </p>
              </div>
            ) : null}
            {messages.length > 0 ? (
              <button type="button" className="button-secondary w-full px-4 py-2 text-xs" onClick={resetConversation}>
                结束并清空
              </button>
            ) : null}
          </aside>
        </div>
      </section>
    </>
  );
}
