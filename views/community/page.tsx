import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";

const partners = [
  {
    title: "家庭",
    role: "看见日常变化，提供稳定陪伴",
    text: "家长关注持续的节律变化，先听孩子怎么说，不根据一次记录下结论。",
    action: "查看家校陪伴指南",
    href: "/resources",
  },
  {
    title: "学校",
    role: "连接日常观察与校内支持",
    text: "老师从学习、出勤和校园生活中了解变化，必要时与家庭共同商量支持安排。",
    action: "进入老师入口",
    href: "/for-teachers",
  },
  {
    title: "医疗与专业支持",
    role: "在需要时提供进一步判断与支持",
    text: "当状态持续影响生活、学习或安全时，由专业人员提供更合适的评估和服务。",
    action: "判断下一步找谁",
    href: "/referral",
  },
];

const handoffSteps = [
  ["先取得同意", "除明确安全危险外，先让青少年知道为什么需要连接下一位支持者。"],
  ["只传递必要信息", "说明持续多久、影响什么、已经尝试过什么，不转发无关隐私。"],
  ["明确由谁跟进", "每次衔接都确认下一位联系人、行动和大致时间，避免让家庭反复讲述。"],
  ["回到日常支持", "专业支持之外，家庭和学校继续提供稳定、可执行的日常陪伴。"],
];

export default function CommunityPage() {
  return (
    <>
      <PageHero
        title="家校医社区"
        subtitle="YouthTempo 帮助家庭、学校与医疗和专业支持者看见同一条支持路径，在尊重隐私和青少年感受的前提下更顺畅地协作。"
        action={
          <>
            <Link href="/resources" className="button-primary">查看家校陪伴指南</Link>
            <Link href="/referral" className="button-secondary">判断下一步找谁</Link>
          </>
        }
      />

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            title="每一方做自己最擅长的事"
            description="社区不是共享所有信息，而是在需要时把合适的人连接起来。"
          />
          <div className="grid gap-5 md:grid-cols-3">
            {partners.map((partner) => (
              <article key={partner.title} className="card flex flex-col">
                <p className="eyebrow">{partner.title}</p>
                <h2 className="mt-2 text-xl font-bold leading-snug text-ink">{partner.role}</h2>
                <p className="mt-3 flex-1 text-sm leading-7 text-muted">{partner.text}</p>
                <Link href={partner.href} className="button-secondary mt-5 w-fit px-4 py-2 text-xs">
                  {partner.action}
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            title="一次清楚、温和的衔接"
            description="减少重复解释和责任空档，让青少年知道接下来会发生什么。"
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {handoffSteps.map(([title, text], index) => (
              <article key={title} className="card">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-mist text-sm font-extrabold text-sage-dark">
                  {index + 1}
                </span>
                <h2 className="mt-5 text-lg font-bold text-ink">{title}</h2>
                <p className="mt-3 text-sm leading-7 text-muted">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container rounded-2xl border border-sage/25 bg-white/85 p-5 shadow-soft sm:p-7">
          <h2 className="text-xl font-bold text-ink">社区页面目前提供协作框架，不公开个案或成员名单</h2>
          <p className="mt-3 max-w-4xl text-sm leading-7 text-muted">
            学生记录仍按学校确认的身份和负责关系开放。未来接入具体医疗或专业机构时，再增加经过授权的机构目录、转介状态和信息共享范围。
          </p>
        </div>
      </section>
    </>
  );
}
