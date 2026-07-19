import Link from "next/link";
import { InfoCard } from "@/components/Cards";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";

const contactReasons = [
  ["学校试点合作", "如果你来自学校、社团或心理健康相关项目，可以联系 YouthTempo 讨论小范围试用。"],
  ["家长与学生反馈", "如果你在使用中发现内容不清楚、不够友好或有需要补充的地方，可以把具体页面和感受告诉我们。"],
  ["隐私与数据问题", "如果你想了解登录、数据保存、记录删除或试点授权方式，可以优先说明你的角色和问题。"],
  ["校园推广团队", "如果你希望参与校园推广、用户测试或反馈收集，可以留下学校、年级和可参与方式。"],
];

const messageTips = [
  "你是谁：学生、家长、老师、学校负责人或合作伙伴。",
  "你想咨询什么：页面内容、试点合作、隐私数据、校园推广或产品反馈。",
  "你希望我们如何回复：邮件、微信或后续会议。",
];

export default function ContactPage() {
  return (
    <>
      <PageHero
        label="Contact"
        title="联系我们"
        subtitle="YouthTempo 仍在原型和试点准备阶段。欢迎学校、家长、学生和合作伙伴提出反馈，让这个工具更清楚、更安全、更能解决真实问题。"
      />

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            title="可以因为什么联系我们？"
            description="为了让沟通更有效，可以先选择最接近的一类问题。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {contactReasons.map(([title, text]) => (
              <InfoCard key={title} title={title}>
                {text}
              </InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container grid gap-8 lg:grid-cols-[1fr_0.85fr]">
          <div className="card">
            <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">联系信息</h2>
            <p className="mt-3 text-sm font-bold text-sage">YouthTempo Project</p>
            <p className="mt-5 text-[0.95rem] leading-7 text-muted">
              当前原型阶段可先通过项目负责人 Irene 统一收集反馈。正式试点前，可以在这里补充学校合作邮箱、项目微信或报名表链接。
            </p>
            <div className="mt-6 grid gap-3 text-sm font-bold text-ink/80">
              <p className="rounded-2xl bg-cream px-4 py-3">负责人：Irene</p>
              <p className="rounded-2xl bg-cream px-4 py-3">用途：试点合作、产品反馈、隐私与数据问题</p>
              <p className="rounded-2xl bg-cream px-4 py-3">状态：原型阶段，联系入口会随试点继续补充</p>
            </div>
          </div>

          <div className="card">
            <h2 className="text-[1.7rem] font-bold leading-[1.25] text-ink">发送反馈时可以包含</h2>
            <div className="mt-6 grid gap-3">
              {messageTips.map((item) => (
                <p key={item} className="rounded-2xl border border-ink/10 bg-white/70 p-4 text-sm font-bold leading-7 text-muted">
                  {item}
                </p>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container grid gap-6 lg:grid-cols-[1fr_0.7fr]">
          <InfoCard title="关于数据与登录" label="Privacy & account">
            如果你的问题和用户登录、数据保存、记录删除或学校试点授权有关，可以先查看隐私与安全页面。
          </InfoCard>
          <div className="card">
            <h3 className="text-xl font-bold text-ink">查看隐私与安全说明</h3>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">
              我们会把账号、数据保存和试点反馈收集尽量设计得清楚、克制、可解释。
            </p>
            <Link href="/privacy-safety" className="button-secondary mt-6">
              隐私与安全
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
