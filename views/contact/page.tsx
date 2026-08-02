import Link from "next/link";
import { InfoCard } from "@/components/Cards";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";

const contactReasons = [
  ["学校合作", "如果你来自学校、社团或心理健康相关项目，可以联系 YouthTempo 了解合作与使用方式。"],
  ["家长与学生反馈", "如果你在使用中发现内容不清楚、不够友好或有需要补充的地方，可以把具体页面和感受告诉我们。"],
  ["隐私与数据问题", "如果你想了解登录、数据保存、记录删除或学校权限配置，可以优先说明你的角色和问题。"],
  ["校园推广团队", "如果你希望参与校园推广、用户测试或反馈收集，可以留下学校、年级和可参与方式。"],
];

const messageTips = [
  "你是谁：学生、家长、老师、学校负责人或合作伙伴。",
  "你想咨询什么：页面内容、学校合作、隐私数据、校园推广或产品反馈。",
  "你希望我们如何回复：邮件、微信或后续会议。",
];

export default function ContactPage() {
  return (
    <>
      <PageHero
        title="联系我们"
        subtitle="学校合作、产品反馈或隐私问题，可以联系 YouthTempo 项目负责人。"
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
            <p className="mt-3 text-sm font-bold text-sage">YouthTempo 项目</p>
            <p className="mt-5 text-[0.95rem] leading-7 text-muted">请通过邀请你使用 YouthTempo 的学校联系人或项目负责人 Irene 取得联系。</p>
            <div className="mt-6 grid gap-3 text-sm font-bold text-ink/80">
              <p className="rounded-2xl bg-cream px-4 py-3">负责人：Irene</p>
              <p className="rounded-2xl bg-cream px-4 py-3">用途：学校合作、产品反馈、隐私与数据问题</p>
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
            如果你的问题和用户登录、数据保存、记录删除或学校权限配置有关，可以先查看隐私与安全页面。
          </InfoCard>
          <div className="card">
            <h3 className="text-xl font-bold text-ink">查看隐私与安全说明</h3>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">
              我们会把账号、数据保存和反馈收集尽量设计得清楚、克制、可解释。
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
