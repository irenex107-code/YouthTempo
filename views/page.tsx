import Link from "next/link";
import { useState } from "react";
import { InfoCard } from "@/components/Cards";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";

const audienceCards = [
  {
    title: "我是青少年",
    label: "记录与表达",
    text: "看看今天的生活节律，整理说不清的感受；需要时，也可以把想说的话写给自己或信任的大人。",
    href: "/for-teens",
    action: "进入青少年入口",
  },
  {
    title: "我是家长",
    label: "理解与陪伴",
    text: "通过孩子的 SWEET 记录了解近况，用更少指责、更容易开口的方式靠近孩子。",
    href: "/for-parents",
    action: "进入家长入口",
  },
  {
    title: "我是老师",
    label: "看见与支持",
    text: "先看负责学生的总体变化，在需要时了解具体情况，并连接家庭或专业支持。",
    href: "/for-teachers",
    action: "进入老师入口",
  },
];

const supportLayers = [
  {
    title: "第一层：SWEET 节律系统",
    label: "日常节律",
    text: "从 Sleep、Wake、Eat、Exercise、Task 五个维度看见日常状态的变化。",
  },
  {
    title: "第二层：表达与整理工具",
    label: "表达与整理",
    text: "当状态出现波动时，通过心情拼图和今晚先放下，把模糊压力慢慢理清。",
  },
  {
    title: "第三层：支持路径",
    label: "支持连接",
    text: "当自助整理不够时，引导用户连接可信任的大人、学校支持或医疗与专业支持。",
  },
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
      <PageHero
        label="青少年日常支持平台"
        title="成长不是抢跑，而是找到自己的节奏。"
        subtitle="YouthTempo 从日常节律开始，帮助年轻人在压力变得更难承受之前，看见自己的状态、表达感受，并更容易找到可以信任的支持。"
        action={
          <>
            <Link href="/check-in" className="button-primary">开始 SWEET 节律记录</Link>
            <Link href="/sweet-model" className="button-secondary">了解 SWEET</Link>
          </>
        }
        aside={
          <IllustrationPanel
            src="/illustrations/system/hero-home-journey.png"
            alt="青少年按照自己的节奏向前，并获得家长、老师和专业支持者陪伴的插画"
            priority
          />
        }
      />

      <section className="section section-muted">
        <div className="container grid items-center gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-12">
          <div>
            <p className="eyebrow">SWEET 记录示例</p>
            <h2 className="mt-3 max-w-2xl text-[1.8rem] font-bold leading-[1.25] text-ink sm:text-[2.35rem]">
              选一个状态，看看它会怎样被整理
            </h2>
            <p className="mt-4 max-w-2xl text-[0.95rem] leading-7 text-muted">
              下面只是体验，不会保存。你先选择今天早晨最接近的状态，YouthTempo 会整理成一句不评判的小结，再给出一个容易开始的下一步。
            </p>
            <ol className="mt-6 grid gap-3 text-sm font-bold text-ink/80 sm:grid-cols-3 lg:grid-cols-1">
              <li className="rounded-2xl bg-white/75 px-4 py-3"><span className="mr-2 text-sage">1</span>选择最接近的状态</li>
              <li className="rounded-2xl bg-white/75 px-4 py-3"><span className="mr-2 text-sage">2</span>看见状态被说清楚</li>
              <li className="rounded-2xl bg-white/75 px-4 py-3"><span className="mr-2 text-sage">3</span>只选一个小行动</li>
            </ol>
          </div>

          <div className="card">
            <p className="text-xs font-extrabold text-sage-dark">第 1 步 · 选择状态</p>
            <p className="mt-2 text-base font-bold text-ink">今天早晨开始一天时，你感觉怎么样？</p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="选择今天早晨的状态">
              {demoOptions.map((item) => {
                const selected = demoChoice === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`min-h-12 rounded-2xl border px-4 py-3 text-sm font-bold transition ${
                      selected
                        ? "border-sage bg-mist text-sage-dark"
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
              <p className="text-xs font-extrabold text-sage-dark">第 2 步 · 看见状态</p>
              <p className="mt-2 text-base font-bold leading-7 text-ink">{demoResult.summary}</p>
              <div className="mt-4 rounded-2xl bg-cream-deep/65 p-4">
                <p className="text-xs font-extrabold text-sage-dark">第 3 步 · 先做一点</p>
                <p className="mt-2 text-[0.95rem] font-bold leading-7 text-ink/80">{demoResult.step}</p>
              </div>
            </div>
            <Link href="/check-in" className="button-primary mt-5 w-full sm:w-auto">开始完整 SWEET 记录</Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            label="为什么从日常开始"
            title="为什么需要更早支持"
            description="很多年轻人的压力并不是一开始就以明确的“心理问题”出现，而是先体现在睡眠、饮食、运动、任务投入、情绪表达和沟通困难中。YouthTempo 希望在问题变得更难承受之前，提供更低门槛、更容易开始的支持方式。"
          />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            label="找到适合你的入口"
            title="从你现在所在的位置开始"
            description="青少年可以记录和表达，家长可以理解和陪伴，老师可以看见变化并在需要时连接支持。"
          />
          <div className="grid gap-6 md:grid-cols-3">
            {audienceCards.map((item) => (
              <Link key={item.title} href={item.href} className="card group flex h-full flex-col transition hover:-translate-y-1 hover:border-sage/30 hover:shadow-lift focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sage/25">
                <p className="eyebrow">{item.label}</p>
                <h3 className="mt-3 text-xl font-bold text-ink">{item.title}</h3>
                <p className="mt-4 flex-1 text-[0.95rem] leading-7 text-muted">{item.text}</p>
                <span className="mt-6 text-sm font-bold text-sage-dark group-hover:text-sage">{item.action} →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            label="从记录到支持"
            title="从日常节律开始的支持路径"
            description="YouthTempo 从 SWEET 节律记录开始，帮助年轻人看见睡眠、醒来、饮食、运动和任务投入之间的关系，并在需要时打开心情拼图、今晚先放下或判断下一步找谁。"
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
            <p className="eyebrow">我们的原则</p>
            <h2 className="mt-3 max-w-3xl text-[1.8rem] font-bold leading-[1.25] text-ink sm:text-[2.35rem]">
              先理解正在发生什么，再一起找到合适的支持。
            </h2>
          </div>
          <InfoCard title="使用 YouthTempo 时" label="你可以放心">
            <ol className="space-y-4 font-bold text-ink/80">
              <li>1. 不会用一次记录给你下结论</li>
              <li>2. AI 只帮助整理，不代替真人判断</li>
              <li>3. 需要时会提示你联系可信任的人</li>
            </ol>
          </InfoCard>
        </div>
      </section>
    </>
  );
}
