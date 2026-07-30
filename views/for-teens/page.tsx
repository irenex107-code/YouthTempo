import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";

const startCards = [
  {
    title: "我想看看今天状态",
    text: "从睡眠、醒来、饮食、运动和任务投入，记录今天真实的生活节奏。",
    action: "做 SWEET 节律记录",
    href: "/check-in",
  },
  {
    title: "我有点说不清自己的感受",
    text: "先不用解释清楚，可以从情绪词、引导式整理和 AI 回应开始表达。",
    action: "做情绪表达",
    href: "/mood-journal",
  },
  {
    title: "我想先找个地方说说",
    text: "从眼前最卡住的一件事开始，和 AI 简短聊几轮，把想法理清一点。",
    action: "陪我理一理",
    href: "/talk",
  },
  {
    title: "我有些话想告诉老师或家长",
    text: "不容易当面说的话，可以先写下来，选择送给老师、家长，或只留给自己。",
    action: "写下想说的话",
    href: "/messages",
  },
  {
    title: "我睡前总是想很多",
    text: "把担心写下来，分清哪些可以先做一点，哪些可以先放一放。",
    action: "做睡前整理",
    href: "/worry-time",
  },
  {
    title: "我想知道下一步可以怎么做",
    text: "当压力持续很多天，或生活学习明显受影响时，可以看看适合的支持路径。",
    action: "查看支持路径",
    href: "/referral",
  },
];

export default function ForTeensPage() {
  return (
    <>
      <PageHero
        title="青少年入口"
        subtitle="选一个最接近现在需要的入口，不必先把所有事情说清楚。"
        action={
          <>
            <Link href="/account" className="button-primary">进入青少年工作台</Link>
            <Link href="/sweet-model" className="button-secondary">了解 SWEET</Link>
          </>
        }
      />

      <section className="section section-muted pt-8 sm:pt-12">
        <div className="container">
          <SectionHeader
            title="今天想从哪里开始？"
            description="每次只做一件事。"
          />
          <div className="grid gap-5 md:grid-cols-2">
            {startCards.map((card) => (
              <article key={card.title} className="card flex flex-col p-5 sm:min-h-60">
                <h3 className="text-lg font-bold leading-snug text-ink sm:text-xl">{card.title}</h3>
                <p className="mt-3 text-[0.95rem] leading-7 text-muted">{card.text}</p>
                <Link href={card.href} className="button-primary mt-5 w-fit px-4 py-2 text-xs">
                  {card.action}
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container rounded-2xl border border-sage/25 bg-mint/60 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div>
            <h2 className="text-lg font-bold text-ink">最近一直很难撑住？</h2>
            <p className="mt-2 text-sm leading-7 text-muted">先找一个可信任的大人或老师聊一聊，也可以查看适合的支持路径。</p>
          </div>
          <Link href="/referral" className="button-secondary mt-4 w-full sm:mt-0 sm:w-auto">
            查看支持路径
          </Link>
        </div>
      </section>
    </>
  );
}
