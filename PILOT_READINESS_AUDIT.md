# YouthTempo Pilot Readiness Audit

审计日期：2026-08-07  
结论：**READY WITH CONDITIONS**

## 基线

- 审计起点：`main` / `5e993f124e13f4344ff0922bef5e0cafc242954a`，当时本地落后 `origin/main` 1 个提交。
- 审计前工作区已有用户修改：`README.md` 与未跟踪的 `AGENTS.md`；本次保留并纳入最终文档更新。
- Node `24.18.0`，pnpm `11.16.0`；项目声明 Node `>=20.9 <27`、pnpm `11.9.0`。
- Next.js `16.2.12` Pages Router、React `19.2.8`、TypeScript 5、Supabase JS `2.50.0`。
- 40 个 migration、25 张业务表；schema 中 Data API 业务表均启用 RLS。
- 正式部署目标：腾讯云 CloudBase Run standalone Docker；Vercel 不是正式站。

## 发现与修复

| 级别 | 发现 | 处理 |
|---|---|---|
| P0 | 多个 API 的 500 分支可能把数据库/提供商 `Error.message` 返回客户端 | 已统一为用户安全通用错误，同时保留脱敏服务端监控；新增静态防回归测试 |
| P1 | Messages、反馈、举报、专业认证缺少共享原子限流 | 已补齐按用户/动作限流和安全的 429/503 响应 |
| P1 | AIDET 家长工具命名未落实最终产品决定 | 已更名 SWEET Talk，并明确“基于 AIDET、不是第六维” |
| P1 | 真实社区测试依赖 fixture 残留状态 | 关键测试脚本现先重置两所虚拟学校 fixture |
| P1 | 用户内容/私密入口缺少明确搜索引擎策略 | 已加页面 `noindex` 及 `robots.txt`；canonical/sitemap 等待正式域名 |
| P1 | AI 指令未显式声明用户输入不是系统指令 | 已增加中英文提示注入边界并测试 |
| P1 | `lint` 仍是占位脚本 | 未修复；列入试点后维护项，当前由 TypeScript、build 和测试覆盖 |
| P2 | 首屏插图有 LCP eager 提示 | 未修复；不影响功能，列入试点后优化 |
| P2 | 危机词规则对第三人称引用/学术讨论可能保守误报 | 未弱化安全规则；列入安全负责人参与的后续调优 |

## 权限与数据结论

- 身份由 Supabase bearer token 服务端校验；角色、学校、分配、监护关系、同意与专业验证均从数据库加载，客户端字段不作为授权依据。
- 学生仅操作本人记录；老师仅看分配学生；学校负责人仅看本校；平台管理员走可信管理名单；专业支持者须通过且未过期。
- 监护人当前只能在 active、学校核验关系下查看关联孩子，但可见的是完整 SWEET 记录与小结，不是仅摘要。该边界技术上已执行，政策仍须负责人签署。
- 社区按角色/学校/审核状态过滤；高风险内容进入 `safety_review`，普通用户不能自行发布待审核内容。
- 账号注销、同意撤回、成员撤销、学校退出均有实际生命周期测试。真实备份副本中的删除重放仍待隔离恢复演练验证。

## 已执行验证

- `pnpm audit --audit-level high`：无已知漏洞。
- `pnpm typecheck`：通过。
- `pnpm build`：通过，63 routes。
- `pnpm test:e2e`（最终完整回归）：275 passed，47 skipped by design（无 `.env.local` 注入的真实凭据生命周期用例按设计跳过；这些用例另以带环境脚本运行，结果见下项）。
- 权限/越权/撤销：16 passed，2 mobile duplicates skipped。
- SWEET 真实 AI 保存生命周期：1 passed，1 mobile duplicate skipped。
- 社区可见性与审核：fixture 重置后 2 passed，2 mobile duplicates skipped。
- 账号/同意/反馈/专业认证/角色保护/学校退出/小程序生命周期：7 passed，7 mobile duplicates skipped。
- 新增加固、320–1440 px 响应式、基础无障碍、Sleep→Wake 回归：7 passed。
- 移动 Chrome、WebKit/Safari 内核、微信 WebView UA：13 passed，2 项非微信项目按设计跳过。

## 未能自动证明的事项

- QQ、163、Outlook 当次外部邮件投递，自有 SMTP 与 DNS 信誉。
- 真实 iPhone/Android/微信内置浏览器、真实微信小程序 AppID 与审核。
- 外部告警接收端和 CloudBase 受控故障告警闭环。
- 正式数据的加密异地备份及隔离恢复；本机当前未发现 Docker、`psql`、`pg_restore`。
- ICP、正式域名、Vercel 账户集成断开属于平台/账户侧人工操作。

只有 `ROADMAP.md` 的 PILOT BLOCKERS 全部关闭后，才可将结论提升为 **READY**。
