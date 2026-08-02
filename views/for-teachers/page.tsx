import Link from "next/link";
import { FeatureIllustration, IllustrationPanel } from "@/components/IllustrationPanel";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";

export default function ForTeachersPage() {
  return (
    <>
      <PageHero
        label="给老师"
        title="老师入口"
        subtitle="YouthTempo 帮助老师通过 SWEET 了解所负责学生近期的生活节律，并以更安全、不贴标签的方式开始沟通。"
        action={
          <>
            <Link href="/account" className="button-primary">进入老师工作台</Link>
            <Link href="/sweet-model" className="button-secondary">了解 SWEET</Link>
          </>
        }
        aside={
          <IllustrationPanel
            src="/illustrations/system/role-teacher.webp"
            alt="手持笔记本、准备倾听学生的老师插画"
            priority
          />
        }
      />

      <section className="section">
        <div className="container">
          <SectionHeader title="老师可以在这里做什么" />
          <div className="grid gap-5 md:grid-cols-3">
            {[
              { title: "看概览", description: "查看负责学生近 7 天的 SWEET 完成情况与最近变化，不必先翻阅每一条记录。", illustration: "/illustrations/system/teacher-overview-v2.webp", alt: "女老师查看所负责学生的总体变化概览" },
              { title: "看学生", description: "进入单个学生页面后，再查看阶段摘要和必要的原始记录。", illustration: "/illustrations/system/teacher-student-view-v3.webp", alt: "男老师和女学生按顺序一起查看 SWEET 五项生活节律" },
              { title: "听学生说", description: "查看学生不容易当面说出口、选择写给老师的话。", illustration: "/illustrations/system/feature-mailbox.webp", alt: "查看学生写来的悄悄话" },
            ].map((item) => (
              <article key={item.title} className="card flex h-full flex-col border-t-4 border-t-sage/50">
                <FeatureIllustration src={item.illustration} alt={item.alt} compact />
                <h2 className="mt-5 text-xl font-bold text-ink">{item.title}</h2>
                <p className="mt-3 text-sm leading-7 text-muted">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container max-w-4xl">
          <SectionHeader title="记录是沟通线索，不是给学生下结论" />
          <div className="card">
            <p className="text-base leading-8 text-muted">
              当睡眠、饮食、活动或任务投入出现持续变化时，可以先问一句：“最近是不是有什么事情让你比较累？”
              先听学生怎么说，再一起确定是否需要更多支持。
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/account" className="button-primary">查看负责学生</Link>
              <Link href="/messages" className="button-secondary">查看收到的话</Link>
              <Link href="/referral" className="button-secondary">查看支持路径</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
