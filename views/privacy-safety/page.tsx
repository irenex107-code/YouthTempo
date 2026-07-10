import Link from "next/link";
import { InfoCard } from "@/components/Cards";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";

const principles = [
  ["不贴标签", "平台记录的是生活节律和支持需求，不把年轻人简单归类为“有问题”或“没问题”。"],
  ["最少必要", "只收集完成记录、生成回应和改进服务所需要的信息，避免收集无关隐私。"],
  ["安全优先", "当用户表达明显危险或无法保证安全时，系统会优先引导连接可信任的大人、学校或紧急资源。"],
  ["透明可控", "正式版本会提供清楚的数据说明，让用户和监护人知道记录保存在哪里、如何查看和删除。"],
];

const accountPlan = [
  ["原型登录", "当前网站已提供“我的记录”原型入口，可在本机浏览器保存昵称、角色和 SWEET 记录，用于演示登录体验。"],
  ["本地数据保存", "SWEET 节律记录可以由用户主动保存到当前浏览器，帮助回看最近变化，而不是用于诊断或贴标签。"],
  ["监护与学校授权", "面向未成年人时，重要数据使用会结合监护人、学校或项目试点规则，避免未经说明的共享。"],
  ["删除与退出", "正式版本应允许用户导出、删除个人记录，或退出试点项目。"],
];

const dataTypes = [
  ["SWEET 节律记录", "睡眠、起床、饮食、运动、任务参与等日常节律信息。"],
  ["情绪表达内容", "用户主动填写的情绪词、文字整理和希望获得的支持。"],
  ["AI 生成回应", "系统根据用户输入生成的整理建议、沟通句式和下一步提示。"],
  ["使用反馈", "试点阶段可能收集页面体验、功能反馈和问题报告，用于快速迭代。"],
];

export default function PrivacySafetyPage() {
  return (
    <>
      <PageHero
        label="Privacy & Safety"
        title="隐私与安全"
        subtitle="青序计划关注的是更早支持，而不是给年轻人贴标签。当前原型支持本地保存记录；未来正式版本会把数据收集、用户登录和授权流程设计得更清楚、克制、可解释。"
      />

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            title="我们如何看待安全"
            description="心理健康相关产品首先要让用户感到安全。这里的安全包括情绪安全、信息安全，也包括在必要时连接真实支持。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {principles.map(([title, text]) => (
              <InfoCard key={title} title={title}>
                {text}
              </InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            title="用户登录与数据保存"
            description="当前网站仍是原型阶段，“我的记录”只使用浏览器本地保存，不会把个人记录上传到服务器。正式版本会把登录、云端保存和授权机制做成清楚的产品流程。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {accountPlan.map(([title, text]) => (
              <InfoCard key={title} title={title}>
                {text}
              </InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="eyebrow">Data Scope</p>
            <h2 className="mt-3 text-[1.8rem] font-bold leading-[1.25] text-ink sm:text-[2.2rem]">
              哪些数据可能被保存？
            </h2>
            <p className="mt-4 text-base leading-8 text-muted">
              数据保存的目标是帮助用户和支持者更早看见节律变化，而不是建立标签、排名或判断。当前原型保存的是用户主动点击保存后的本地记录。
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {dataTypes.map(([title, text]) => (
              <InfoCard key={title} title={title}>
                {text}
              </InfoCard>
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
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">
              如果你正在参与试点，或想了解数据如何使用，可以通过联系我们页面说明具体问题。
            </p>
            <Link href="/contact" className="button-secondary mt-6">
              联系我们
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
