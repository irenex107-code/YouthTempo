import { InfoCard } from "@/components/Cards";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { sweetModules } from "@/data/site";

export default function SweetModelPage() {
  return (
    <>
      <PageHero
        label="SWEET Framework"
        title="SWEET 模型"
        subtitle="从生活节律开始，建立更早、更低门槛的情绪支持。"
        aside={<InfoCard title="睡眠、醒来、饮食、运动、任务投入" label="Sleep, Wake, Eat, Exercise, Task Engagement">SWEET 不是给年轻人贴标签，而是从更容易观察的日常节律开始，帮助支持更早发生。</InfoCard>}
      />
      <section className="section section-muted">
        <div className="container">
          <SectionHeader title="五个日常节律模块" description="这些模块共同帮助年轻人、家长和学校更清楚地理解状态变化，而不是只在问题变严重后才行动。" />
          <div className="grid gap-6 md:grid-cols-2">
            {sweetModules.map((item) => (
              <InfoCard key={item.key} title={item.title} label={item.label}>
                <p>{item.summary}</p>
                <p className="mt-4 font-bold text-ink/80">产品示例：{item.example}</p>
              </InfoCard>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
