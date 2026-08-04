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
    label: "先了解近况",
    text: "看看孩子最近的睡眠、吃饭、运动和学习状态，再找一个更容易开口的方式聊聊。",
    href: "/for-parents",
    action: "进入家长入口",
  },
  {
    title: "我是老师",
    label: "留意变化",
    text: "先看负责学生的总体变化，在需要时了解具体情况，并连接家庭或专业支持。",
    href: "/for-teachers",
    action: "进入老师入口",
  },
];

const supportSteps = [
  {
    title: "先记下最近的日常",
    label: "睡眠、吃饭、运动和学习",
    text: "不用一次说清所有事，从最近几天最明显的变化开始就可以。",
  },
  {
    title: "再把感受说清一点",
    label: "心情和压力",
    text: "可以选几个接近的情绪词，也可以把反复担心的事先写下来。",
  },
  {
    title: "需要时找人一起想办法",
    label: "家人、老师或专业帮助",
    text: "如果一个人很难撑住，可以把近况告诉信任的人，再决定下一步找谁。",
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
    summary: "今天早晨开始一天有点费力。先记下来，不用急着责怪自己。",
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
        title="最近过得怎么样？"
        subtitle="从睡眠、吃饭、运动、学习和心情开始，把最近的状态记下来。需要的时候，也更容易和信任的人说清楚。"
        action={
          <>
            <Link href="/check-in" className="button-primary">开始 SWEET 节律记录</Link>
            <Link href="/sweet-model" className="button-secondary">了解 SWEET</Link>
          </>
        }
        aside={
          <IllustrationPanel
            src="/illustrations/system/hero-home-journey.webp"
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
              选一个最接近的状态，看看整理后的样子
            </h2>
            <p className="mt-4 max-w-2xl text-[0.95rem] leading-7 text-muted">
              这里可以直接体验，不会保存。选好后，你会看到一句简单的小结和一个可以马上试试的小步骤。
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
            title="很多变化，最先出现在日常里"
            description="睡不好、吃不下、不想动、学习很难开始，常常比一句“我压力很大”更早出现。先把这些变化记下来，就更容易知道自己需要休息、聊一聊，还是找人帮忙。"
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
            title="按生活里的顺序，一步一步来"
            description="先看看最近的生活，再整理当下的感受。一个人处理不动时，就找信任的人一起想办法。"
          />
          <div className="grid gap-6 md:grid-cols-3">
            {supportSteps.map((item) => (
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
              记录是为了把近况说清楚，不是给谁下结论。
            </h2>
          </div>
          <InfoCard title="使用 YouthTempo 时" label="你可以放心">
            <ol className="space-y-4 font-bold text-ink/80">
              <li>1. 不会用一次记录给你下结论</li>
              <li>2. 小结只整理你写下的内容</li>
              <li>3. 需要时会提示你联系可信任的人</li>
            </ol>
          </InfoCard>
        </div>
      </section>
    </>
  );
}
