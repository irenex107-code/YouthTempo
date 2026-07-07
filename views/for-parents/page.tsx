import Link from "next/link";
import { InfoCard } from "@/components/Cards";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";

const sweetObservations = [
  ["Sleep 睡眠", "Sleep", "最近睡得是否稳定？比如入睡时间、夜里醒来、早晨疲惫感，是否和以前明显不同。"],
  ["Wake up on time 起床", "Wake up on time", "早晨是否很难启动？起床、洗漱、出门或开始一天时，是否变得更吃力。"],
  ["Eat healthily 饮食", "Eat healthily", "吃饭是否规律？精力是否有明显波动，是否常常没胃口、跳餐或靠零食撑过去。"],
  ["Exercise 运动", "Exercise", "身体活动是否明显减少？孩子是否越来越少出门、运动或参与原本会做的活动。"],
  ["Task engagement 任务参与", "Task engagement", "学习或生活任务是否很难开始？重点不是只看结果，而是看启动和维持是否变难。"],
];

const aidetSteps = [
  ["Acknowledge / 先看见孩子的感受", "我知道你最近可能真的很累，也不是故意拖延。"],
  ["Introduce / 说明自己的来意", "我不是来骂你，我只是想了解你最近状态。"],
  ["Duration / 说明只聊一小会儿", "我们先聊10分钟，不需要马上解决所有问题。"],
  [
    "Explanation / 解释为什么关心这些生活节律",
    "睡眠、起床、吃饭、运动会影响情绪和注意力，我想看看有没有什么地方可以先帮你轻松一点。",
  ],
  ["Thank you / 感谢孩子愿意表达", "谢谢你愿意跟我说这些，我知道这不一定容易。"],
];

const phrases = [
  "我想先理解你最近的状态。",
  "我们可以一起看看哪一部分最累。",
  "你不用马上解释清楚，我们可以慢慢说。",
  "我不会马上评价你，我们先一起想一个小步骤。",
  "我注意到你最近早上很难起来，我想先听听你自己的感觉。",
  "我们先不讨论对错，只看看哪一个生活节律最需要被照顾。",
];
const parentStarts = [
  ["先观察 SWEET", "从睡眠、按时起床、健康饮食、运动和任务参与，看见孩子最近的生活节律变化。"],
  ["先降低防御", "把重点放在理解孩子的状态，而不是马上评价、追问原因或要求立刻改变。"],
  ["用 AIDET 开口", "用看见感受、说明来意、约定时间、解释原因和表达感谢的方式，让沟通更安全。"],
  ["需要时连接支持", "当状态持续影响生活和学习时，可以结合家庭、学校和专业资源。"],
];

export default function ForParentsPage() {
  return (
    <>
      <PageHero
        label="For Parents"
        title="家长入口"
        subtitle="更早理解孩子的节奏，比更晚处理危机更重要。SWEET 帮助家长看见孩子的生活节律，AIDET 帮助家长用更安全、不指责的方式开口沟通。SWEET shows what to notice. AIDET guides how to talk."
      />

      <section className="section section-muted">
        <div className="container grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <InfoCard title="不是给孩子贴标签" label="No labeling">
            平台不是为了判断孩子“有没有问题”，而是帮助家庭更早注意到日常节律、压力变化和支持需求。先看见状态，才更容易减少误解和冲突。
          </InfoCard>
          <InfoCard title="从节律开始理解，而不是立刻追问原因" label="Daily rhythm first">
            对很多孩子来说，直接回答“你到底怎么了”很难。SWEET 提供的是观察内容，AIDET 提供的是沟通方式，帮助家长先从更具体、更低压力的地方靠近孩子。
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
            title="SWEET：家长可以观察什么"
            description="SWEET 是内容框架，帮助家长知道可以观察哪些生活节律。这些变化不一定意味着严重问题，但如果持续出现，就值得被温和、具体地看见。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
            {sweetObservations.map(([title, label, text]) => (
              <InfoCard key={title} title={title} label={label}>
                {text}
              </InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            title="AIDET：家长可以怎么开口谈"
            description="AIDET 是亲子沟通框架，帮助家长围绕这些生活节律，用更不指责、更有安全感的方式开口。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
            {aidetSteps.map(([title, example]) => (
              <InfoCard key={title} title={title} label="AIDET">
                <p className="font-bold text-ink/80">“{example}”</p>
              </InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            title="可以直接使用的低冲突句式"
            description="目标不是马上让孩子解释清楚，而是让对话可以继续。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
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
              选择一个 SWEET 里的具体变化开始谈，比如睡眠、起床或任务参与，再用 AIDET 的方式说明你只是想先理解孩子的状态。
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
