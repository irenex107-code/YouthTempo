import Link from "next/link";
import { PageHero } from "@/components/PageHero";
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
    title: "给家长",
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
    title: "给学校",
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
  {
    title: "给学生",
    items: [
      {
        title: "看见今天的节律",
        text: "用一分钟记录睡眠、起床、饮食、运动和任务参与。",
        href: "/check-in",
        action: "开始 SWEET",
      },
      {
        title: "整理说不清的感受",
        text: "不用一次说清楚，从几个接近当下的情绪词开始。",
        href: "/mood-journal",
        action: "开始表达",
      },
      {
        title: "把担心放到明天",
        text: "睡前分清现在能做的、暂时控制不了的和还不确定的部分。",
        href: "/worry-time",
        action: "睡前整理",
      },
    ],
  },
];

export default function ResourcesPage() {
  return (
    <>
      <PageHero
        title="家校资源"
        subtitle="按角色找到最需要的一条建议或工具。"
      />
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
    </>
  );
}
