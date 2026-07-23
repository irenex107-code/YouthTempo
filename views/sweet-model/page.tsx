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
        subtitle="YouthTempo 从生活节律开始，为年轻人提供更早、更容易获得的支持。"
        aside={<InfoCard title="睡眠、醒来、饮食、运动、任务投入" label="Sleep, Wake, Eat, Exercise, Task Engagement" showLabel>SWEET 不用来判断一个年轻人“有没有问题”，而是帮助我们从日常变化中，更早发现他是否需要支持。</InfoCard>}
      />
      <section className="section section-muted">
        <div className="container">
          <SectionHeader title="五个日常节律模块" description="这些模块共同帮助年轻人、家长和学校更清楚地理解状态变化，而不是只在问题变严重后才行动。" />
          <div className="grid gap-6 md:grid-cols-2">
            {sweetModules.map((item) => (
              <InfoCard key={item.key} title={item.title} label={item.label} showLabel>
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
