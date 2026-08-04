import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { FeatureIllustration, IllustrationPanel } from "@/components/IllustrationPanel";

const tools = [
  { title: "看看最近的生活节奏", text: "从睡眠、醒来、饮食、活动和手头任务开始，不需要先想清楚所有问题。", href: "/check-in", action: "做一次 SWEET 记录", image: "/illustrations/system/feature-sweet-rhythm-v2.webp", alt: "五个日常节律组成的记录路径" },
  { title: "把心里那团东西说清一点", text: "情绪很杂时，可以先选接近的感受，再补充刚才发生了什么。", href: "/mood-journal", action: "打开心情拼图", image: "/illustrations/system/feature-mood-puzzle.webp", alt: "不同颜色组成的心情拼图" },
  { title: "睡前先把担心放下来", text: "把能做的、暂时不能做的分开，今晚不必把每件事都解决。", href: "/worry-time", action: "今晚先放下", image: "/illustrations/system/feature-worry-time.webp", alt: "在月光下暂时安放担心" },
  { title: "需要真人支持时知道找谁", text: "当状态持续影响学习、工作或生活，可以按紧急程度找到更合适的支持。", href: "/referral", action: "看看下一步找谁", image: "/illustrations/system/feature-progress-path.webp", alt: "逐步连接合适支持的路径" },
];

export default function ForYoungAdultsPage() {
  return (
    <>
      <PageHero
        label="给 18–25 岁的你"
        title="不用等一切稳定下来，才开始照顾自己的节奏。"
        subtitle="离开高中、进入大学或刚开始工作，生活常常一下子变得更自由，也更容易乱。你可以独立使用 YouthTempo，不需要学校或监护人加入。"
        action={<><Link href="/account" className="button-primary">登录并开始</Link><Link href="/check-in" className="button-secondary">先试一次 SWEET</Link></>}
        aside={<IllustrationPanel src="/illustrations/system/feature-progress-path.webp" alt="沿着自己的节奏逐步向前的成长路径" priority />}
      />

      <section className="section section-muted">
        <div className="container">
          <SectionHeader title="按你现在最需要的来" description="每次只做一件事，不用把它变成新的任务清单。" />
          <div className="grid gap-5 md:grid-cols-2">
            {tools.map((tool) => (
              <article key={tool.href} className="card flex flex-col">
                <FeatureIllustration src={tool.image} alt={tool.alt} />
                <h2 className="mt-5 text-xl font-bold text-ink">{tool.title}</h2>
                <p className="mt-3 flex-1 text-sm leading-7 text-muted">{tool.text}</p>
                <Link href={tool.href} className="button-primary mt-5 w-fit">{tool.action}</Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container grid gap-5 lg:grid-cols-3">
          <article className="card"><p className="eyebrow">独立确认</p><h2 className="mt-3 text-lg font-bold text-ink">已满 18 岁，可以自己确认</h2><p className="mt-3 text-sm leading-7 text-muted">登录后只需选择“已满 18 岁”，阅读数据说明并确认，不需要监护人同意，也不要求加入学校。</p></article>
          <article className="card"><p className="eyebrow">你的记录</p><h2 className="mt-3 text-lg font-bold text-ink">默认只有你能看到</h2><p className="mt-3 text-sm leading-7 text-muted">未加入学校时，学校和老师无法查看。你可以导出、删除单条记录，也可以注销账户。</p></article>
          <article className="card"><p className="eyebrow">使用边界</p><h2 className="mt-3 text-lg font-bold text-ink">它不是诊断或急救服务</h2><p className="mt-3 text-sm leading-7 text-muted">如果你正面临伤害自己或他人的危险，请立即联系当地急救、警方，或身边能够到场的人。</p></article>
        </div>
      </section>

      <section className="section section-muted pt-8 sm:pt-12">
        <div className="container rounded-[1.75rem] border border-sage/20 bg-white p-5 shadow-soft sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div><h2 className="text-lg font-bold text-ink">还在 14–18 岁学校试点范围内？</h2><p className="mt-2 text-sm leading-7 text-muted">青少年入口包含家长、老师和学校支持关系。</p></div>
          <Link href="/for-teens" className="button-secondary mt-4 w-full sm:mt-0 sm:w-auto">回到青少年入口</Link>
        </div>
      </section>
    </>
  );
}
