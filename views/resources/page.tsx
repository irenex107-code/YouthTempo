import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { SectionHeader } from "@/components/SectionHeader";

type ResourceItem = {
  title: string;
  text: string;
  href?: string;
  action?: string;
};

type ResourceGroup = {
  title: string;
  items: ResourceItem[];
};

const resourceGroups: ResourceGroup[] = [
  {
    title: "家长：怎么观察和开口",
    items: [
      {
        title: "先看节律变化",
        text: "留意睡眠、起床、饮食、运动和任务参与是否持续变难，不急着给变化下结论。",
        href: "/for-parents",
        action: "查看家长指引",
      },
      {
        title: "降低沟通冲突",
        text: "先说观察和关心，再给孩子一点表达时间，避免连续追问、比较或马上讲道理。",
        href: "/for-parents",
        action: "查看沟通句式",
      },
      {
        title: "知道何时求助",
        text: "当状态持续影响学习、关系或日常生活时，和学校或专业支持资源一起讨论下一步。",
        href: "/referral",
        action: "查看支持路径",
      },
    ],
  },
  {
    title: "老师与学校：怎么回应和跟进",
    items: [
      {
        title: "关注持续变化",
        text: "记录变化出现多久、影响哪些日常功能，以及学生是否有可以信任的支持者。",
      },
      {
        title: "从支持开始回应",
        text: "先确认学生当下最需要什么，再讨论学习安排、家庭沟通或进一步支持。",
      },
      {
        title: "保持清晰边界",
        text: "记录只用于支持和跟进，不用于排名、惩罚、诊断或给学生贴标签。",
      },
    ],
  },
];

export default function ResourcesPage() {
  return (
    <>
      <PageHero
        title="家校陪伴指南"
        subtitle="给家长和老师的陪伴方法：看什么、怎么开口、怎样回应，以及什么时候需要进一步支持。这里不是学生求助入口。"
        aside={
          <IllustrationPanel
            src="/illustrations/system/feature-resources.webp"
            alt="家长和老师一起查看陪伴指南的插画"
            priority
          />
        }
      />
      <section className="section section-muted pb-0">
        <div className="container grid gap-4 md:grid-cols-2">
          <div className="card">
            <p className="eyebrow">日常陪伴</p>
            <h2 className="mt-2 text-xl font-bold text-ink">想学习怎么理解和支持孩子</h2>
            <p className="mt-3 text-sm leading-7 text-muted">继续查看下面按家长、老师整理的方法和沟通建议。</p>
          </div>
          <div className="card">
            <p className="eyebrow">当前需要帮助</p>
            <h2 className="mt-2 text-xl font-bold text-ink">现在不知道下一步该找谁</h2>
            <p className="mt-3 text-sm leading-7 text-muted">转到支持路径，根据持续时间和影响程度获得下一步建议。</p>
            <Link href="/referral" className="button-primary mt-5 px-4 py-2 text-xs">判断下一步</Link>
          </div>
        </div>
      </section>
      {resourceGroups.map((group, index) => (
        <section key={group.title} className={`section ${index % 2 === 0 ? "section-muted" : ""}`}>
          <div className="container">
            <SectionHeader title={group.title} />
            <div className="grid gap-4 md:grid-cols-3">
              {group.items.map((item) => (
                <article key={item.title} className="card flex flex-col">
                  <h3 className="text-lg font-bold leading-snug text-ink">{item.title}</h3>
                  <p className="mt-3 flex-1 text-[0.95rem] leading-7 text-muted">{item.text}</p>
                  {item.href && item.action ? (
                    <Link href={item.href} className="button-secondary mt-5 w-fit px-4 py-2 text-xs">
                      {item.action}
                    </Link>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </section>
      ))}
      <section className="section section-muted">
        <div className="container rounded-2xl border border-sage/25 bg-white/85 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div>
            <h2 className="text-xl font-bold text-ink">已经明显影响生活或学习？</h2>
            <p className="mt-2 text-sm leading-7 text-muted">家校方法不能代替及时支持。可以根据当前状态判断下一步找谁。</p>
          </div>
          <Link href="/referral" className="button-primary mt-4 w-full sm:mt-0 sm:w-auto">进入支持路径</Link>
        </div>
      </section>
    </>
  );
}
