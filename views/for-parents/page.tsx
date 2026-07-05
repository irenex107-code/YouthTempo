import Link from "next/link";
import { InfoCard } from "@/components/Cards";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";

const observations = [
  ["睡眠变化", "Sleep", "入睡变晚、醒来困难、周末补觉明显增多，可能说明孩子正在消耗更多精力。"],
  ["醒来后的状态", "Wake", "早晨持续疲惫、烦躁或回避开始一天，可以作为理解状态的入口。"],
  ["饮食和运动规律", "Eat / Exercise", "吃饭时间混乱、活动减少，不一定是“懒”，也可能是节律变得不稳定。"],
  ["学习任务启动困难", "Task Engagement", "不是只看成绩，而是看孩子是否越来越难开始、维持或完成基本任务。"],
  ["情绪表达变少或冲突变多", "Emotional Expression", "沉默、回避、易怒或冲突增加，都可以先理解为需要被看见的信号。"],
];
const rhythmObservations = observations.slice(0, 3);
const expressionObservations = observations.slice(3);

const phrases = [
  "我想先理解你最近的状态。",
  "我们可以一起看看哪一部分最累。",
  "你不用马上解释清楚，我们可以慢慢说。",
  "我不会马上评价你，我们先一起想一个小步骤。",
];
const parentStarts = [
  ["先观察节律", "从睡眠、醒来、饮食、运动和任务投入看见孩子最近的状态变化。"],
  ["先减少冲突", "用更低压力的方式开启对话，而不是马上评价或催促。"],
  ["先理解表达困难", "有些孩子不是不想说，而是不知道怎么说。"],
  ["需要时连接支持", "当状态持续影响生活和学习时，可以结合家庭、学校和专业资源。"],
];

export default function ForParentsPage() {
  return (
    <>
      <PageHero
        label="For Parents"
        title="家长入口"
        subtitle="更早理解孩子的节奏，比更晚处理危机更重要。青序计划帮助家长从睡眠、饮食、身体活动、任务投入和情绪表达中，看见孩子可能需要的支持。"
      />

      <section className="section section-muted">
        <div className="container grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <InfoCard title="不是给孩子贴标签" label="No labeling">
            平台不是为了判断孩子“有没有问题”，而是帮助家庭更早注意到日常节律、压力变化和支持需求。先看见状态，才更容易减少误解和冲突。
          </InfoCard>
          <InfoCard title="从节律开始理解，而不是立刻追问原因" label="Daily rhythm first">
            对很多孩子来说，直接回答“你到底怎么了”很难。睡眠、醒来、吃饭节奏、身体活动和任务投入，常常是更低冲突、更容易开始的观察方式。
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
            {parentStarts.map(([title, text]) => (
              <InfoCard key={title} title={title}>
                {text}
              </InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            title="家长可以观察什么？"
            description="这些变化不一定意味着严重问题，但如果持续出现，就值得被温和、具体地看见。"
          />
          <div className="grid gap-8">
            <div>
              <h3 className="text-xl font-bold text-ink">日常节律变化</h3>
              <div className="mt-5 grid gap-6 md:grid-cols-3">
                {rhythmObservations.map(([title, label, text]) => (
                  <InfoCard key={title} title={title} label={label}>
                    {text}
                  </InfoCard>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xl font-bold text-ink">学习与表达变化</h3>
              <div className="mt-5 grid gap-6 md:grid-cols-2">
                {expressionObservations.map(([title, label, text]) => (
                  <InfoCard key={title} title={title} label={label}>
                    {text}
                  </InfoCard>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            title="可以先这样开口"
            description="目标不是马上让孩子解释清楚，而是让对话可以继续。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {phrases.map((phrase) => (
              <InfoCard key={phrase} title={`“${phrase}”`} label="Conversation starter">
                这类句式把重点放在理解状态，而不是立刻评价、纠正或要求改变。
              </InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container grid gap-6 lg:grid-cols-[1fr_0.7fr]">
          <InfoCard title="什么时候寻求进一步帮助" label="Next support">
            如果孩子的压力持续存在，或睡眠、学习、人际和日常生活明显受到影响，家庭可以考虑学校心理老师、专业咨询师，必要时连接医疗或紧急资源。这个过程不需要责备任何人，重点是让孩子获得更合适的支持。
          </InfoCard>
          <div className="card">
            <h3 className="text-xl font-bold text-ink">家长可以先做的一件事</h3>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">
              选择一个具体变化开始谈，比如睡眠、早晨状态或任务启动，而不是一次讨论所有问题。
            </p>
          </div>
          <div className="card lg:col-span-2">
            <h3 className="text-xl font-bold text-ink">家校资源</h3>
            <p className="mt-2 text-sm font-bold text-sage">Parent & School Resources</p>
            <p className="mt-4 max-w-3xl text-[0.95rem] leading-7 text-muted">
              给家长和学校的支持材料，帮助更早理解青少年的节律、情绪表达和支持需求。
            </p>
            <Link href="/resources" className="button-secondary mt-6">
              查看家校资源
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
