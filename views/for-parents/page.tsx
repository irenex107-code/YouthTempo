import Link from "next/link";
import { InfoCard } from "@/components/Cards";
import { FeatureIllustration, IllustrationPanel } from "@/components/IllustrationPanel";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";

const sweetObservations = [
  {
    letter: "S",
    title: "Sleep 睡眠",
    question: "最近睡得是否稳定？",
    text: "比如入睡时间、夜里醒来、早晨疲惫感，是否和以前明显不同。",
  },
  {
    letter: "W",
    title: "Wake up on time 起床",
    question: "早晨是否很难启动？",
    text: "起床、洗漱、出门或开始一天时，是否变得更吃力。",
  },
  {
    letter: "E",
    title: "Eat healthily 饮食",
    question: "吃饭是否规律？",
    text: "精力是否有明显波动，是否常常没胃口、跳餐或靠零食撑过去。",
  },
  {
    letter: "E",
    title: "Exercise 运动",
    question: "身体活动是否明显减少？",
    text: "孩子是否越来越少出门、运动或参与原本会做的活动。",
  },
  {
    letter: "T",
    title: "Task engagement 任务参与",
    question: "学习或生活任务是否很难开始？",
    text: "重点不是只看结果，而是看启动和维持是否变难。",
  },
];

const aidetSteps = [
  {
    step: "01",
    title: "Acknowledge",
    label: "先看见孩子的感受",
    example: "我知道你最近可能真的很累，也不是故意拖延。",
  },
  {
    step: "02",
    title: "Introduce",
    label: "说明自己的来意",
    example: "我不是来骂你，我只是想了解你最近状态。",
  },
  {
    step: "03",
    title: "Duration",
    label: "说明只聊一小会儿",
    example: "我们先聊10分钟，不需要马上解决所有问题。",
  },
  {
    step: "04",
    title: "Explanation",
    label: "解释为什么关心这些生活节律",
    example: "睡眠、起床、吃饭、运动会影响情绪和注意力，我想看看有没有什么地方可以先帮你轻松一点。",
  },
  {
    step: "05",
    title: "Thank you",
    label: "感谢孩子愿意表达",
    example: "谢谢你愿意跟我说这些，我知道这不一定容易。",
  },
];

const phrases = [
  "你最近是不是有点累？我想先听听。",
  "我们先聊十分钟，不用现在就解决。",
  "你还没想好怎么说也没关系。",
  "我先不评价，你说说最近最累的是哪一块。",
];
const parentStarts = [
  { title: "先看看最近的生活", text: "从睡眠、起床、吃饭、运动和学习开始，留意孩子最近有没有持续变化。", illustration: "/illustrations/system/parent-observe-sweet-v3.webp", alt: "爸爸和女儿按顺序一起观察 SWEET 五项生活节律" },
  { title: "先降低防御", text: "把重点放在理解孩子的状态，而不是马上评价、追问原因或要求立刻改变。", illustration: "/illustrations/system/parent-safe-listening.webp", alt: "家长放下评判并安静倾听孩子" },
  { title: "找一句容易开口的话", text: "先说你看见了什么、为什么关心，再约一个不被打扰的时间聊一会儿。", illustration: "/illustrations/system/parent-aidet-conversation.webp", alt: "家长和孩子循序渐进地进行安全对话" },
  { title: "需要时连接支持", text: "当状态持续影响生活和学习时，可以结合家庭、学校和专业资源。", illustration: "/illustrations/system/parent-connect-support.webp", alt: "家长为孩子连接学校和专业支持" },
];

export default function ForParentsPage() {
  return (
    <>
      <PageHero
        label="给家长"
        title="家长入口"
        subtitle="先看看孩子最近睡得、吃得、动得怎么样，再找一个不指责、比较容易开口的方式聊聊。"
        action={
          <>
            <Link href="/account" className="button-primary">进入家长工作台</Link>
            <Link href="/sweet-model" className="button-secondary">了解 SWEET</Link>
          </>
        }
        aside={
          <IllustrationPanel
            src="/illustrations/system/role-parent.webp"
            alt="平静倾听、准备陪伴孩子的家长插画"
            priority
          />
        }
      />

      <section className="section section-muted">
        <div className="container grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <InfoCard title="你能看到哪些内容">
            你只能查看学校已经确认关联的孩子记录，不会看到其他学生的信息。一次记录不能说明全部情况，更适合用来了解近况、开始一次对话。
          </InfoCard>
          <InfoCard title="先说具体变化，不急着追问原因">
            对很多孩子来说，直接回答“你到底怎么了”很难。可以先从最近睡不好、早上起不来或学习很难开始这些具体变化聊起。
          </InfoCard>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            title="家长可以从哪里开始？"
            description="先选择一个最具体、最不容易引发冲突的入口。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {parentStarts.map((item) => (
              <article key={item.title} className="card flex h-full flex-col">
                <FeatureIllustration src={item.illustration} alt={item.alt} compact />
                <h3 className="mt-5 text-[1.05rem] font-bold leading-snug text-ink sm:text-[1.18rem]">{item.title}</h3>
                <p className="mt-3 text-[0.95rem] leading-7 text-muted">{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted pt-8 sm:pt-12">
        <div className="container rounded-2xl border border-sage/25 bg-white/85 p-5 shadow-soft sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div>
            <h2 className="text-xl font-bold text-ink">查看孩子写来的悄悄话</h2>
            <p className="mt-2 text-sm leading-7 text-muted">孩子写给家长的内容，会集中显示在独立功能页。</p>
          </div>
          <Link href="/messages" className="button-primary mt-4 w-full sm:mt-0 sm:w-auto">查看收到的话</Link>
        </div>
      </section>

      <section className="section section-muted" data-section="sweet-observations">
        <div className="container">
          <SectionHeader
            title="SWEET：家长可以观察什么"
            description="SWEET 把日常分成五个容易观察的部分。这些变化不一定代表出了严重问题；如果持续出现，就值得找孩子聊一聊。"
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {sweetObservations.map((item) => (
              <article
                key={item.title}
                className="group flex flex-col rounded-[1.75rem] border border-ink/[0.08] bg-white/90 p-5 shadow-soft transition hover:-translate-y-1 hover:border-sage/30 hover:bg-white hover:shadow-lift lg:min-h-[19rem]"
              >
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex h-12 min-w-12 items-center justify-center rounded-2xl bg-mist px-3 text-xl font-extrabold text-sage-dark">{item.letter}</span>
                  <span className="text-xs font-extrabold tracking-[0.16em] text-sage-dark">SWEET</span>
                </div>
                <h3 className="text-[1.05rem] font-extrabold leading-snug text-ink">{item.title}</h3>
                <p className="mt-3 text-[0.95rem] font-bold leading-7 text-sage-dark">{item.question}</p>
                <div className="mt-5 flex-1 rounded-2xl bg-mist/55 p-4">
                  <p className="text-[0.92rem] leading-7 text-ink/75">{item.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" data-section="aidet-conversation">
        <div className="container">
          <SectionHeader
            title="AIDET：家长可以怎么开口谈"
            description="AIDET 把一次对话分成五步。不用照着术语念，照着顺序把关心说清楚就可以。"
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {aidetSteps.map((item) => (
              <article
                key={item.title}
                className="group flex flex-col rounded-[1.75rem] border border-ink/[0.08] bg-white/90 p-5 shadow-soft transition hover:-translate-y-1 hover:border-sage/30 hover:bg-white hover:shadow-lift lg:min-h-[19rem]"
              >
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex h-12 min-w-12 items-center justify-center rounded-2xl bg-cream-deep/75 px-3 text-sm font-extrabold text-sage-dark">{item.step}</span>
                  <span className="text-xs font-extrabold tracking-[0.16em] text-sage-dark">AIDET</span>
                </div>
                <h3 className="text-[1.05rem] font-extrabold leading-snug text-ink">{item.title}</h3>
                <p className="mt-3 text-[0.95rem] font-bold leading-7 text-sage-dark">{item.label}</p>
                <div className="mt-5 flex-1 rounded-2xl bg-cream-deep/65 p-4">
                  <p className="text-[0.92rem] font-bold leading-7 text-ink/75">“{item.example}”</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="conversation" className="section section-muted scroll-mt-24">
        <div className="container">
          <SectionHeader
            title="可以直接说的话"
            description="这些话不用照着念。选一句接近你平时说话方式的，让对话先开始。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {phrases.map((phrase) => (
              <blockquote key={phrase} className="rounded-2xl border border-ink/10 bg-white/80 p-5 text-[0.95rem] font-bold leading-7 text-ink/80 shadow-soft">
                “{phrase}”
              </blockquote>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container grid gap-6 lg:grid-cols-[1fr_0.7fr]">
          <InfoCard title="什么时候寻求进一步帮助" label="连接更多支持">
            如果孩子的压力持续存在，或睡眠、学习、人际和日常生活明显受到影响，家庭可以考虑学校心理老师、专业咨询师，必要时连接医疗或紧急资源。这个过程不需要责备任何人，重点是让孩子获得更合适的支持。
          </InfoCard>
          <div className="card">
            <h3 className="text-xl font-bold text-ink">家长可以先做的一件事</h3>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">
              选一个最具体的变化开始，比如最近睡不好、早上起不来或学习很难开始。先说明你只是想了解近况，再听孩子怎么说。
            </p>
          </div>
          <div className="card lg:col-span-2">
            <h3 className="text-xl font-bold text-ink">家校陪伴指南</h3>
            <p className="mt-4 max-w-3xl text-[0.95rem] leading-7 text-muted">
              给家长和老师的陪伴方法，帮助更早理解青少年的节律、感受和支持需要。
            </p>
            <Link href="/resources" className="button-secondary mt-6">
              查看陪伴指南
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
