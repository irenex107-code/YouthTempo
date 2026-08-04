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
        subtitle="先看看负责学生最近有没有持续变化，需要时再了解具体情况，和学生一起决定是否要联系家庭或更多支持。"
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
              { title: "先看最近一周", description: "先了解哪些学生最近有记录、哪些日常状态出现了持续变化。", illustration: "/illustrations/system/teacher-overview-v2.webp", alt: "女老师查看所负责学生的总体变化概览" },
              { title: "再了解具体情况", description: "需要时查看学生最近的小结和本人记录，带着具体变化开始沟通。", illustration: "/illustrations/system/teacher-student-view-v3.webp", alt: "男老师和女学生按顺序一起查看 SWEET 五项生活节律" },
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
          <SectionHeader title="把记录当作一次谈话的开头" />
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

      <section className="section pt-8 sm:pt-12">
        <div className="container rounded-[1.75rem] border border-sage/20 bg-white p-5 shadow-soft sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div><h2 className="text-lg font-bold text-ink">哪些地方还不够顺手？</h2><p className="mt-2 text-sm leading-7 text-muted">花两分钟说说实际使用感受，帮助我们调整试点。</p></div>
          <Link href="/feedback" className="button-secondary mt-4 w-full sm:mt-0 sm:w-auto">填写老师反馈</Link>
        </div>
      </section>
    </>
  );
}
