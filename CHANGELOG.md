# Changelog

## 2026-11-27 · Student check-ins and access

- The homepage links to “Choose my age group”. On the next page, students aged 14–17 and young adults aged 18–25 can choose their own path. Students can complete participation consent on the check-in page, save their answers with an optional AI summary, and open their account history from the save confirmation. Signed-in users can sign out from the header or their account. [Age selection](https://youthtempo.com/en/for-young-people) · [Sign out](https://github.com/irenex107-code/YouthTempo/pull/17) · [Saved history](https://github.com/irenex107-code/YouthTempo/pull/18)
- The bilingual support pages distinguish the people a student can speak to in person from the recipients available in the inbox. Guardian accounts cannot read a student's private SWEET. [Bilingual copy](https://github.com/irenex107-code/YouthTempo/pull/19) · [Production deployment](https://github.com/irenex107-code/YouthTempo/actions/runs/45899988528)
- The homepage titles and descriptions name both audiences. The README and pilot documents explain the optional AI summary and who can see a private SWEET or a message sent to a teacher. [Public documentation update](https://github.com/irenex107-code/YouthTempo/pull/20)

## 2026-11-25 · Public showcase and limited S02 / P01-15 release

- The bilingual public site shows both age paths (14–17 and 18–25), a fictional SWEET example, and a direct support link. The example explains how the garden counts recorded dates in Beijing time.
- Private SWEET records are available to their owner. Teachers can read or newly export student messages addressed to them while the applicable consent, teacher role, school membership and assignment are active. School reports remain closed.
- The admissions showcase passed guest checks. The formal teacher-handoff role retest is NOT_RUN and requests already in flight at revocation remain OPEN. [Deployment](https://github.com/irenex107-code/YouthTempo/actions/runs/45642189507)

## 2026-08-01 · Pilot readiness consolidation

- 第一期目标收窄为 14–18 岁在校青少年及其家庭、老师和学校。
- 腾讯云 CloudBase Run 明确为唯一正式部署目标。
- 建立统一路线图和试点验收标准。
- 开始加入 Playwright 端到端测试。

## 2026-07-31 · Community interaction upgrade

- 家校医社区支持发帖、评论和分角色可见/可评论范围。
- 帖子和评论增加作者及管理员删除能力。
- 增加举报、安全内容拦截和专业支持者认证。
- 重构社区卡片、互动区域、发布区和移动端层级。

## 2026-07-28–30 · Role workspaces and support flows

- 建立家长、老师、学校负责人和平台管理员工作区。
- 支持老师—学生、家长—孩子关系分配及人员删除。
- 学校管理台增加按老师查看学生、近四周记录和待了解变化。
- 家长和学校可按权限查看学生原始记录与 AI 摘要。
- 新增悄悄话信箱、匿名老师来信和安全拦截。
- SWEET 支持 AI 一键小结、云端保存、历史查看和删除。
- 新增浏览器语音输入和最多八轮的“陪我捋一捋”。

## 2026-07 · Infrastructure

- 完成腾讯云 CloudBase Run 部署。
- 完成 Supabase 邮箱 OTP、角色模型、学校关系和版本化迁移。
- GitHub Actions 自动运行 TypeScript 和生产构建验证。
