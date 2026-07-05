import Link from "next/link";
import { InfoCard } from "@/components/Cards";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";

const startCards = [
  {
    title: "我想看看今天状态",
    label: "SWEET Rhythm",
    text: "从睡眠、醒来、饮食、运动和任务投入，记录今天真实的生活节奏。",
    action: "做 SWEET 节律记录",
    href: "/check-in",
  },
  {
    title: "我有点说不清自己的感受",
    label: "Emotion Expression",
    text: "先不用解释清楚，可以从情绪词、引导式整理和 AI 回应开始表达。",
    action: "做情绪表达",
    href: "/mood-journal",
  },
  {
    title: "我睡前总是想很多",
    label: "Worry Time",
    text: "把担心写下来，分清哪些可以先做一点，哪些可以先放一放。",
    action: "做睡前整理",
    href: "/worry-time",
  },
  {
    title: "我想知道下一步可以怎么做",
    label: "Support Pathway",
    text: "当压力持续很多天，或生活学习明显受影响时，可以看看适合的支持路径。",
    action: "查看支持路径",
    href: "/referral",
  },
];

const toolCards = [
  ["SWEET 节律记录", "SWEET Rhythm Check-in", "适合在一天开始或结束时，从五个日常维度记录自己的生活节奏。"],
  ["情绪表达", "Emotion Expression", "适合把情绪、身体感受和脑中反复出现的话慢慢表达出来。"],
  ["睡前整理", "Worry Time", "适合在睡前把担心拆小，给明天留一个可执行的小行动。"],
  ["支持路径", "Referral Support", "适合在一个人扛不动时，了解可以连接哪些可信任的人。"],
];
export default function ForTeensPage() {
  return (
    <>
      <PageHero
        label="For Teens"
        title="青少年入口"
        subtitle="你不需要等到撑不住了，才开始获得支持。可以从一个最容易开始的工具进入，先看见今天的状态、压力和需要的支持。"
        action={<Link href="/check-in" className="button-primary">开始 SWEET 节律记录</Link>}
      />

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            title="今天想从哪里开始？"
            description="不需要先把问题讲清楚。选择一个最接近今天状态的入口，就可以开始。"
          />
          <div className="grid gap-5 md:grid-cols-2">
            {startCards.map((card) => (
              <article key={card.title} className="card flex flex-col p-5">
                <h3 className="text-lg font-bold leading-snug text-ink sm:text-xl">{card.title}</h3>
                <p className="mt-2 text-xs font-bold text-sage">{card.label}</p>
                <p className="mt-3 text-[0.95rem] leading-7 text-muted">{card.text}</p>
                <Link href={card.href} className="button-primary mt-5 w-fit px-4 py-2 text-xs">
                  {card.action}
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            title="今天你可以选择的工具"
            description="这些工具都只是帮助你整理状态，不是测试，也不会给你贴标签。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {toolCards.map(([title, label, text]) => (
              <InfoCard key={title} title={title} label={label}>
                {text}
              </InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <InfoCard title="这不是测试，也不是正式评估" label="Low-stigma support">
            这里的工具不是为了判断你“有没有问题”，而是帮助你更早看见自己的节奏、压力和需要的支持。
          </InfoCard>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container grid gap-6 lg:grid-cols-[1fr_0.75fr]">
          <InfoCard title="什么时候需要更多支持" label="Support Pathway">
            如果压力持续很多天，或者睡眠、吃饭、学习、人际和日常生活都变得很难管理，你不需要一个人撑着。可以先找一个可信任的大人、学校老师或专业支持资源聊一聊。
          </InfoCard>
          <div className="card">
            <h3 className="text-xl font-bold text-ink">可以先说的一句话</h3>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">
              “我最近有点说不清楚，但我想找个人一起看看现在的状态。”
            </p>
            <Link href="/referral" className="button-secondary mt-6">
              查看支持路径
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
