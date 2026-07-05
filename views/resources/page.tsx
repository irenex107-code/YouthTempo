import { InfoCard } from "@/components/Cards";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";

const groups = [
  {
    title: "给家长的资源",
    items: ["睡眠如何影响情绪稳定", "当孩子说“我没事”时，家长可以怎么回应", "如何支持孩子，而不是只催促孩子"]
  },
  {
    title: "给学校的资源",
    items: ["如何在危机前发现学生的支持需求", "建立低污名的心理健康支持环境", "学业压力之外，学校还可以观察什么"]
  },
  {
    title: "给学生的工具",
    items: ["情绪词卡", "睡前整理", "SWEET 节律小结", "压力来源记录"]
  }
];
const network = [
  ["家庭", "提供日常理解、陪伴和低冲突沟通。"],
  ["学校", "更早发现学习、情绪和适应变化，提供校内支持。"],
  ["专业咨询", "在持续压力、低落或适应困难时提供进一步支持。"],
  ["及时支持资源", "在需要更多帮助时，提供更可靠、更具体的支持连接。"],
];

export default function ResourcesPage() {
  return (
    <>
      <PageHero
        label="Parent & School Resources"
        title="家校资源"
        subtitle="用更温和、可理解的方式，帮助年轻人在问题变严重之前获得支持。"
      />
      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            label="Family-School-Professional Support Network"
            title="家校医协作支持网络"
            description="不同支持来源可以承担不同角色，帮助年轻人在日常生活、学校环境和进一步资源之间获得连续支持。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {network.map(([title, role]) => (
              <InfoCard key={title} title={title}>
                {role}
              </InfoCard>
            ))}
          </div>
        </div>
      </section>
      {groups.map((group, index) => (
        <section key={group.title} className={`section ${index % 2 === 0 ? "section-muted" : ""}`}>
          <div className="container">
            <SectionHeader title={group.title} />
            <div className="grid gap-6 md:grid-cols-3">
              {group.items.map((item) => (
                <InfoCard key={item} title={item}>
                  家校资源用于帮助家长和学校理解青少年的日常节律、沟通困难和支持需求，让支持更早、更低冲突地发生。
                </InfoCard>
              ))}
            </div>
          </div>
        </section>
      ))}
    </>
  );
}
