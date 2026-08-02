import { InfoCard } from "@/components/Cards";
import { IllustrationPanel } from "@/components/IllustrationPanel";
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
        aside={
          <IllustrationPanel
            src="/illustrations/system/feature-sweet-rhythm-v2.webp"
            alt="睡眠、醒来、饮食、运动和任务投入组成的日常节律循环插画"
            priority
          />
        }
      />
      <section className="section section-muted">
        <div className="container">
          <SectionHeader title="五个日常节律模块" description="这些模块共同帮助年轻人、家长和学校更清楚地理解状态变化，而不是只在问题变严重后才行动。" />
          <div className="grid gap-6 md:grid-cols-2">
            {sweetModules.map((item) => (
              <InfoCard key={item.key} title={item.title} label={item.label} showLabel>
                <p>{item.summary}</p>
                <p className="mt-4 font-bold text-ink/80">你可以这样观察：{item.example}</p>
              </InfoCard>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
