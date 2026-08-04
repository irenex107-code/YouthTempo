import Link from "next/link";
import { InfoCard } from "@/components/Cards";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { accountDataRetention } from "@/lib/accountDataPolicy";
import { schoolExitRules } from "@/lib/schoolExitPolicy";

const principles = [
  ["不贴标签", "平台记录的是生活节律和支持需求，不把年轻人简单归类为“有问题”或“没问题”。"],
  ["只保存需要的内容", "只保存完成记录和提供服务所需要的信息，不收集无关隐私。"],
  ["安全优先", "当用户表达明显危险或无法保证安全时，会优先提醒联系可信任的大人、学校或紧急资源。"],
  ["自己可以管理", "登录后可以查看、下载或删除自己的内容；不同身份只能看到获得授权的记录。"],
];

const accountPlan = [
  ["邮箱登录", "使用邮箱验证码登录，不需要设置或记住密码。"],
  ["保存记录", "登录后主动保存的 SWEET 记录会进入个人历史记录。"],
  ["学校访问", "学校负责人可查看本校学生记录；支持老师只查看由学校分配给自己的学生。"],
  ["删除记录", "学生可以在“账号”中删除自己保存的 SWEET 记录。"],
  ["导出与注销", "登录后可即时下载自己的数据副本，或永久注销账号。平台不保存导出文件。"],
];

const retentionRules = [
  ["账号存续期间", accountDataRetention.activeAccount],
  ["注销立即执行", accountDataRetention.accountDeletion],
  ["安全处理记录 · 最长 24 个月", accountDataRetention.safetyAudit],
  ["备份副本", accountDataRetention.backups],
];

const schoolExitItems = [
  ["学校权限立即停止", schoolExitRules.access],
  ["个人账号继续保留", schoolExitRules.personalData],
  ["解除学校关系", schoolExitRules.relationships],
  ["删除学校协作数据", schoolExitRules.schoolNotes],
];

const consentSteps = [
  ["学生先确认", "学生阅读数据范围、用途、可见角色和撤回方式，只选择年龄范围，不填写具体生日。"],
  ["监护人再确认", "14–17 岁学生参加学校试点时，由学校已确认关联的监护人在自己的账户中完成确认。"],
  ["生成小结前再确认", "生成小结前会再次说明本次回答可能包含敏感生活与健康信息，由用户主动勾选。"],
  ["随时可以撤回", "学生或监护人可在账户页撤回；撤回后不能继续保存新记录、发送留言或在社区发布。"],
];

const dataTypes = [
  ["SWEET 节律记录", "睡眠、起床、饮食、运动、任务参与等日常节律信息。"],
  ["账号资料", "邮箱、显示名称和用户选择的身份，用于登录和区分支持角色。"],
  ["学校关系", "学校、学生、支持老师及师生分配关系，用于限制记录的可见范围。"],
  ["整理后的小结", "根据用户主动填写的内容生成的小结、沟通句式和下一步提示。"],
];

export default function PrivacySafetyPage() {
  return (
    <>
      <PageHero
        title="隐私与安全"
        subtitle="只保存提供服务所需要的信息，并按用户身份限制记录的可见范围。"
      />

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            title="你可以怎么保护自己的信息"
            description="这里说明会保存什么、谁能看到，以及需要帮助或想删除数据时可以怎么做。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
            {principles.map(([title, text]) => (
              <InfoCard key={title} title={title}>{text}</InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section id="community-safety" className="section">
        <div className="container">
          <SectionHeader
            title="未成年人社区安全与举报处理"
            description="社区规则适用于帖子和回应。举报人身份不会告诉内容作者；越可能伤害到人的情况，会越早查看。"
          />
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            <InfoCard title="紧急优先 · 目标 2 小时" label="首次复核">
              明确的即时危险、鼓励自伤自杀、涉未成年人色情或性侵害进入紧急队列。有人正处于危险时，请不要等待平台处理，立即联系可信任的成年人并拨打 110 或 120。
            </InfoCard>
            <InfoCard title="优先处理 · 目标 24 小时" label="首次复核">
              欺凌、辱骂、威胁、泄露个人信息及其他明显危险或不适宜内容优先复核，并视情况隐藏内容、限制账号或保留必要记录。
            </InfoCard>
            <InfoCard title="常规处理 · 目标 72 小时" label="首次复核">
              诈骗、广告、刷屏及其他规则问题进入常规队列。复杂情况完成调查可能超过首次复核目标，状态会在社区的“我的举报进度”中更新。
            </InfoCard>
          </div>
          <div className="mt-6 rounded-2xl border border-sage/20 bg-mint/35 px-5 py-4 text-sm leading-7 text-muted">
            上述 2/24/72 小时是我们争取完成首次查看的时间，并不是法律规定的统一时限。有人正处于危险时，请不要等待社区处理。社区规则依据
            <a className="ml-1 font-bold text-sage-dark underline decoration-sage/40 underline-offset-4" href="https://www.gov.cn/zhengce/content/202310/content_6911288.htm" target="_blank" rel="noreferrer">《未成年人网络保护条例》</a>。
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            title="用户登录与数据保存"
            description="个人用户查看自己的记录；学校角色按照学校归属和师生分配关系查看记录；家长仅能查看由学校确认关联的孩子记录。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {accountPlan.map(([title, text]) => (
              <InfoCard key={title} title={title}>{text}</InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section id="student-consent" className="section section-muted scroll-mt-24">
        <div className="container">
          <SectionHeader
            title="未成年人及监护人知情同意"
            description="YouthTempo 当前试点面向 14–18 岁在校青少年。学生本人需要清楚知道数据如何使用；14–17 岁学校试点学生还需要已核验监护人确认。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {consentSteps.map(([title, text]) => <InfoCard key={title} title={title}>{text}</InfoCard>)}
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-sage/20 bg-white/80 px-5 py-5 text-sm leading-7 text-muted">
              <p className="font-bold text-ink">同意覆盖什么</p>
              <p className="mt-2">账号资料、SWEET 日常节律回答、AI 生成小结、“想说的话”、社区发布内容，以及为限定学校、老师和监护人可见范围所需的关联信息。不会要求填写身份证号或具体出生日期。</p>
            </div>
            <div className="rounded-2xl border border-sage/20 bg-white/80 px-5 py-5 text-sm leading-7 text-muted">
              <p className="font-bold text-ink">撤回后会怎样</p>
              <p className="mt-2">撤回后不能继续保存新记录、发送留言或在社区发布。已有内容仍可查看、下载或逐条删除，也可以注销账号并删除关联数据。</p>
            </div>
          </div>
          <p className="mt-6 rounded-2xl border border-sage/20 bg-mint/35 px-5 py-4 text-sm leading-7 text-muted">
            法律要求基于同意处理个人信息时做到充分知情、自愿明确、便捷撤回；医疗健康等敏感个人信息需要单独同意，不满 14 周岁未成年人的个人信息需要监护人同意。YouthTempo 对 14–17 岁学校试点同时要求学生与监护人确认，是我们增加的一层保护。查看
            <a className="ml-1 font-bold text-sage-dark underline underline-offset-4" href="https://www.npc.gov.cn/WZWSREL25wYy9jMi9jMzA4MzQvMjAyMTA4L3QyMDIxMDgyMF8zMTMwODguaHRtbD9yZWY9aW1i" target="_blank" rel="noreferrer">《个人信息保护法》</a>。
          </p>
        </div>
      </section>

      <section id="account-data" className="section scroll-mt-24">
        <div className="container">
          <SectionHeader
            title="数据导出、注销与保存期限"
            description="用户可以在账户设置中直接行使这些权利，不需要先联系学校或平台说明理由。导出只包含当前账号的数据，不会额外打包关联孩子、学生或其他用户的私密记录。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {retentionRules.map(([title, text]) => <InfoCard key={title} title={title}>{text}</InfoCard>)}
          </div>
          <div className="mt-6">
            <div className="rounded-2xl border border-sage/20 bg-mint/35 px-5 py-5 text-sm leading-7 text-muted">
              <p className="font-bold text-ink">注销会删除什么</p>
              <p className="mt-2">账号资料、SWEET 记录、留言、学校与监护关系、知情同意记录、微信绑定、个人社区内容和举报会随账号删除。涉及该账号的社区审核动作仅保留去标识化的安全记录。</p>
            </div>
          </div>
          <p className="mt-6 rounded-2xl border border-sage/20 bg-mint/35 px-5 py-4 text-sm leading-7 text-muted">
            《个人信息保护法》规定个人有权查阅、复制个人信息，并在处理目的已实现、停止提供服务、保存期限届满或撤回同意等情形请求删除；《网络数据安全管理条例》要求提供便捷的复制、删除、限制处理、注销账号和撤回同意方法。查看
            <a className="ml-1 font-bold text-sage-dark underline underline-offset-4" href="https://www.npc.gov.cn/WZWSREL25wYy9jMzA4MzQvMjAyMTA4L3QyMDIxMDgyMF8zMTMwODguaHRtbD9yZWY9aW1i" target="_blank" rel="noreferrer">《个人信息保护法》</a>
            <span>和</span>
            <a className="ml-1 font-bold text-sage-dark underline underline-offset-4" href="https://www.cac.gov.cn/2024-09/30/c_1729384452307680.htm" target="_blank" rel="noreferrer">《网络数据安全管理条例》</a>。
          </p>
        </div>
      </section>

      <section id="school-exit" className="section section-muted scroll-mt-24">
        <div className="container">
          <SectionHeader
            title="学校退出试点后的数据处理"
            description="学校退出后，学校不能再查看相关学生信息；学生和家长的个人账号不会因此被注销。"
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {schoolExitItems.map(([title, text]) => <InfoCard key={title} title={title}>{text}</InfoCard>)}
          </div>
          <p className="mt-6 rounded-2xl border border-sage/20 bg-white/80 px-5 py-4 text-sm leading-7 text-muted">
            学校退出后，学校负责人和老师不能再通过原有学校关系查看学生信息。个人仍可依法查阅、复制、删除或注销自己的数据。详细权利可查看
            <a className="ml-1 font-bold text-sage-dark underline underline-offset-4" href="https://www.npc.gov.cn/WZWSREL25wYy9jMzA4MzQvMjAyMTA4L3QyMDIxMDgyMF8zMTMwODguaHRtbD9yZWY9aW1i" target="_blank" rel="noreferrer">《个人信息保护法》</a>
            <span>和</span>
            <a className="ml-1 font-bold text-sage-dark underline underline-offset-4" href="https://www.cac.gov.cn/2024-09/30/c_1729384452307680.htm" target="_blank" rel="noreferrer">《网络数据安全管理条例》</a>。
          </p>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="eyebrow">数据范围</p>
            <h2 className="mt-3 text-[1.8rem] font-bold leading-[1.25] text-ink sm:text-[2.2rem]">哪些数据可能被保存？</h2>
            <p className="mt-4 text-base leading-8 text-muted">
              只保存用户主动提交的记录、账号资料和提供学校支持所需的关联信息。这些内容不会用来给人贴标签或排名。
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
            YouthTempo 不能替代紧急救助或专业诊疗。如果用户处在即时危险中，应尽快联系可信任的大人、学校负责人、当地医疗或紧急服务。
          </InfoCard>
          <div className="card">
            <h3 className="text-xl font-bold text-ink">有隐私或安全问题？</h3>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">如果你正在通过学校使用 YouthTempo，或想了解数据如何使用，可以通过联系我们页面说明具体问题。</p>
            <Link href="/contact" className="button-secondary mt-6">联系我们</Link>
          </div>
        </div>
      </section>
    </>
  );
}
