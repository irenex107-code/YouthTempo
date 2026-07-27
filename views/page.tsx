import Link from "next/link";
import { useState } from "react";
import { InfoCard } from "@/components/Cards";
import { SectionHeader } from "@/components/SectionHeader";

const audienceCards = [
  {
    title: "青少年 14-18",
    label: "Adolescents",
    text: "处在学习压力、情绪变化、家庭沟通和自我探索交织的阶段。很多状态变化会先出现在睡眠、饮食、运动、任务投入和情绪表达里。",
  },
  {
    title: "青年 18-25",
    label: "Emerging Adults",
    text: "从学校走向更独立的生活阶段，可能面对身份探索、学业选择、未来压力和关系变化，需要更柔和、更容易开始的支持。",
  },
  {
    title: "家长与学校",
    label: "Parents & Schools",
    text: "作为年轻人身边的重要支持系统，家长和学校可以更早理解状态变化，并用更低冲突的方式连接支持。",
  },
];

const supportLayers = [
  {
    title: "第一层：SWEET 节律系统",
    label: "Daily Rhythm",
    text: "从 Sleep、Wake、Eat、Exercise、Task 五个维度看见日常状态的变化。",
  },
  {
    title: "第二层：表达与整理工具",
    label: "Expression & Organization",
    text: "当状态出现波动时，通过情绪表达和睡前整理，把模糊压力具体化。",
  },
  {
    title: "第三层：支持路径",
    label: "Support Pathway",
    text: "当自助整理不够时，引导用户连接可信任的大人、学校支持、家校资源或专业资源。",
  },
];

const heroSweetItems = [
  { title: "睡眠", label: "Sleep" },
  { title: "醒来", label: "Wake" },
  { title: "饮食", label: "Eat" },
  { title: "运动", label: "Exercise" },
  { title: "任务投入", label: "Task" },
];

const demoOptions = [
  {
    id: "steady",
    label: "还算顺利",
    summary: "今天早晨的节奏还算稳定。",
    step: "保留现在有效的做法就好，不需要额外给自己加任务。",
  },
  {
    id: "slow",
    label: "有点费力",
    summary: "今天早晨启动有点费力。这是状态线索，不是对能力的判断。",
    step: "先选一件最小的事开始，例如洗漱、喝水或收好书包。",
  },
  {
    id: "stuck",
    label: "很难开始",
    summary: "今天早晨很难启动，可以再看看睡眠或压力是不是也在影响你。",
    step: "把必须做的事缩成一步，也可以告诉一个你信任的大人。",
  },
] as const;

export default function Home() {
  const [demoChoice, setDemoChoice] = useState<(typeof demoOptions)[number]["id"]>("slow");
  const demoResult = demoOptions.find((item) => item.id === demoChoice) ?? demoOptions[1];

  return (
    <>
      <section className="section">
        <div className="container grid items-center gap-12 lg:grid-cols-[1.08fr_0.92fr]">
          <div>
            <p className="eyebrow">YouthTempo</p>
            <h1 className="mt-4 max-w-3xl text-[2.05rem] font-bold leading-[1.17] text-ink sm:text-[2.8rem] lg:text-[3.1rem]">
              成长不是抢跑，而是找到自己的节奏。
            </h1>
            <p className="mt-6 max-w-3xl text-base leading-8 text-muted">
              YouthTempo 从日常节律开始，帮助年轻人在压力变得更难承受之前，看见自己的状态、表达感受，并更容易找到可以信任的支持。
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/sweet-model" className="button-secondary">了解 SWEET 模型</Link>
              <Link href="/check-in" className="button-primary">开始 SWEET 节律记录</Link>
            </div>
          </div>
          <div className="card mx-auto w-full max-w-md p-7">
            <p className="text-xs font-bold text-sage">SWEET 日常节律</p>
            <h2 className="mt-2 text-[1.35rem] font-extrabold leading-tight text-ink">从日常节律开始</h2>
            <div className="mt-6 space-y-3">
              {heroSweetItems.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-4 rounded-2xl bg-cream px-4 py-3.5 text-sm"
                >
                  <span className="font-bold text-ink/80">{item.title}</span>
                  <span className="text-xs font-bold text-sage-dark">{item.label}</span>
                </div>
              ))}
            </div>
            <p className="mt-5 text-sm font-bold leading-7 text-sage-dark">
              支持可以从一个更容易观察、也更容易开口的地方开始。
            </p>
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container grid items-center gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-12">
          <div>
            <p className="eyebrow">10 秒体验</p>
            <h2 className="mt-3 max-w-2xl text-[1.8rem] font-bold leading-[1.25] text-ink sm:text-[2.35rem]">
              一次记录会得到什么？
            </h2>
            <p className="mt-4 max-w-2xl text-[0.95rem] leading-7 text-muted">
              先从一个具体状态开始。YouthTempo 会帮你把变化说清楚，再找到一个容易开始的小行动。
            </p>
            <Link href="/check-in" className="button-primary mt-6 w-full sm:w-auto">
              开始完整 SWEET 记录
            </Link>
          </div>

          <div className="card">
            <p className="text-sm font-bold text-ink">今天早晨开始一天时，你感觉怎么样？</p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="选择今天早晨的状态">
              {demoOptions.map((item) => {
                const selected = demoChoice === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`min-h-12 rounded-2xl border px-4 py-3 text-sm font-bold transition ${
                      selected
                        ? "border-sage bg-mint text-sage-dark"
                        : "border-ink/10 bg-white text-ink/70 hover:border-sage/50"
                    }`}
                    aria-pressed={selected}
                    onClick={() => setDemoChoice(item.id)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-5 border-t border-ink/10 pt-5" aria-live="polite">
              <p className="text-xs font-bold text-sage-dark">整理结果</p>
              <p className="mt-2 text-base font-bold leading-7 text-ink">{demoResult.summary}</p>
              <p className="mt-3 text-[0.95rem] leading-7 text-muted">
                <span className="font-bold text-ink">可以先做：</span>
                {demoResult.step}
              </p>
            </div>
            <p className="mt-4 text-xs leading-6 text-muted">这是产品示例，不会保存你的选择。</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            label="Why Early Support"
            title="为什么需要更早支持"
            description="很多年轻人的压力并不是一开始就以明确的“心理问题”出现，而是先体现在睡眠、饮食、运动、任务投入、情绪表达和沟通困难中。YouthTempo 希望在问题变得更难承受之前，提供更低门槛、更容易开始的支持方式。"
          />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            label="Who We Support"
            title="青春期和成年早期，是更早支持的重要窗口。"
            description="YouthTempo 关注年轻人自身，也关注他们身边的家庭和学校支持系统。"
          />
          <div className="grid gap-6 md:grid-cols-3">
            {audienceCards.map((item) => (
              <InfoCard key={item.title} title={item.title} label={item.label}>
                {item.text}
              </InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            label="Support Pathway Starting from Daily Rhythm"
            title="从日常节律开始的支持路径"
            description="YouthTempo 从 SWEET 节律记录开始，帮助年轻人看见睡眠、醒来、饮食、运动和任务投入之间的关系，并在需要时进入情绪表达、睡前整理或支持路径。"
          />
          <div className="grid gap-6 md:grid-cols-3">
            {supportLayers.map((item) => (
              <InfoCard key={item.title} title={item.title} label={item.label}>
                {item.text}
              </InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="section">
        <div className="container grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="eyebrow">项目愿景</p>
            <h2 className="mt-3 max-w-3xl text-[1.8rem] font-bold leading-[1.25] text-ink sm:text-[2.35rem]">
              让支持在年轻人独自承受之前，更容易被看见，也更容易获得。
            </h2>
          </div>
          <InfoCard title="项目重点" label="Project focus">
            <ol className="space-y-4 font-bold text-ink/80">
              <li>1. 危机之前的早期支持</li>
              <li>2. 以日常节律作为支持基础</li>
              <li>3. AI 辅助，连接真实人支持</li>
            </ol>
          </InfoCard>
        </div>
      </section>
    </>
  );
}
