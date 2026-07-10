import Link from "next/link";
import { InfoCard } from "@/components/Cards";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";

const principles = [
  ["不贴标签", "平台记录的是生活节律和支持需求，不把年轻人简单归类为“有问题”或“没问题”。"],
  ["最少必要", "只收集完成记录、生成回应和改进服务所需要的信息，避免收集无关隐私。"],
  ["安全优先", "当用户表达明显危险或无法保证安全时，系统会优先引导连接可信任的大人、学校或紧急资源。"],
  ["透明可控", "账户、历史记录和授权关系都应该能被用户看见，并能在需要时撤销或删除。"],
];

const accountPlan = [
  ["邮箱登录", "用户可以通过邮箱登录账户。试点阶段使用无密码登录链接，降低记忆密码和账户管理压力。"],
  ["云端数据保存", "用户主动保存的 SWEET 节律记录会进入数据库，帮助用户回看趋势，而不是用于诊断或贴标签。"],
  ["授权管理", "用户可以创建和撤销家长、学校支持者或试点反馈相关授权，授权关系会被单独记录。"],
  ["删除与退出", "用户可以删除自己的 SWEET 历史记录；正式试点时还应补充导出和退出流程。"],
];

const dataTypes = [
  ["SWEET 节律记录", "睡眠、起床、饮食、运动、任务参与等日常节律信息。"],
  ["账户资料", "邮箱、显示名称和用户选择的身份，用于登录和区分支持角色。"],
  ["授权关系", "被授权邮箱、授权类型、状态和撤销时间，用于管理谁可以参与支持。"],
  ["AI 生成回应", "系统根据用户输入生成的整理建议、沟通句式和下一步提示。"],
];

export default function PrivacySafetyPage() {
  return (
    <>
      <PageHero
        label="Privacy & Safety"
        title="隐私与安全"
        subtitle="青序计划关注的是更早支持，而不是给年轻人贴标签。当前版本开始接入账户系统、云端数据库和授权管理；数据权限会遵循最少必要和用户可控原则。"
      />

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            title="我们如何看待安全"
            description="心理健康相关产品首先要让用户感到安全。这里的安全包括情绪安全、信息安全，也包括在必要时连接真实支持。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {principles.map(([title, text]) => (
              <InfoCard key={title} title={title}>{text}</InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            title="用户登录与数据保存"
            description="账户系统使用 Supabase 作为登录和数据库基础。每位用户只能读取自己的资料、SWEET 历史记录和授权记录；数据库会通过行级安全规则限制访问范围。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {accountPlan.map(([title, text]) => (
              <InfoCard key={title} title={title}>{text}</InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="eyebrow">Data Scope</p>
            <h2 className="mt-3 text-[1.8rem] font-bold leading-[1.25] text-ink sm:text-[2.2rem]">哪些数据可能被保存？</h2>
            <p className="mt-4 text-base leading-8 text-muted">
              数据保存的目标是帮助用户和支持者更早看见节律变化，而不是建立标签、排名或判断。保存范围包括用户主动提交的 SWEET 记录、账户资料和授权关系。
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {dataTypes.map(([title, text]) => (
              <InfoCard key={title} title={title}>{text}</InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container grid gap-6 lg:grid-cols-[1fr_0.7fr]">
          <InfoCard title="危机与紧急情况" label="Safety first">
            青序计划不能替代紧急救助或专业诊疗。如果用户处在即时危险中，应尽快联系可信任的大人、学校负责人、当地医疗或紧急服务。
          </InfoCard>
          <div className="card">
            <h3 className="text-xl font-bold text-ink">有隐私或安全问题？</h3>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">如果你正在参与试点，或想了解数据如何使用，可以通过联系我们页面说明具体问题。</p>
            <Link href="/contact" className="button-secondary mt-6">联系我们</Link>
          </div>
        </div>
      </section>
    </>
  );
}
