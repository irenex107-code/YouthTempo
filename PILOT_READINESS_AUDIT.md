# YouthTempo Pilot Readiness Audit

审计日期：2026-08-07；AI P0 增量复核：2026-08-18
结论：**READY WITH CONDITIONS**

## 基线

- 审计起点：`main` / `5e993f124e13f4344ff0922bef5e0cafc242954a`，当时本地落后 `origin/main` 1 个提交。
- 审计前工作区已有用户修改：`README.md` 与未跟踪的 `AGENTS.md`；本次保留并纳入最终文档更新。
- Node `24.18.0`，pnpm `11.16.0`；项目声明 Node `>=20.9 <27`、pnpm `11.9.0`。
- Next.js `16.2.12` Pages Router、React `19.2.8`、TypeScript 5、Supabase JS `2.50.0`。
- 40 个 migration、25 张业务表；schema 中 Data API 业务表均启用 RLS。
- 当前正式部署目标：香港腾讯云 Lighthouse 上的 standalone Docker，经 Nginx 提供 `https://youthtempo.com`；Vercel 与原 CloudBase 均不是正式站。

## 发现与修复

| 级别 | 发现 | 处理 |
|---|---|---|
| P0 | 多个 API 的 500 分支可能把数据库/提供商 `Error.message` 返回客户端 | 已统一为用户安全通用错误，同时保留脱敏服务端监控；新增静态防回归测试 |
| P1 | Messages、反馈、举报、专业认证缺少共享原子限流 | 已补齐按用户/动作限流和安全的 429/503 响应 |
| P1 | AIDET 家长工具命名未落实最终产品决定 | 已更名 SWEET Talk，并明确“基于 AIDET、不是第六维” |
| P1 | 真实社区测试依赖 fixture 残留状态 | 关键测试脚本现先重置两所虚拟学校 fixture |
| P1 | 用户内容/私密入口缺少明确搜索引擎策略 | 已加页面 `noindex` 及 `robots.txt`；canonical/sitemap 等待正式域名 |
| P1 | AI 指令未显式声明用户输入不是系统指令 | 已增加中英文提示注入边界并测试 |
| P0 | 原先只有 Talk 最新一条消息进入确定性危机识别，其余四个自由文本 AI 工具可能先调用 provider；Talk 的早先高风险消息也可能被后续消息冲掉 | 五个支持入口现均在 provider 调用前执行共享中英文确定性识别；Talk 扫描本次会话全部用户消息；命中后只返回固定现实支持指引。Talk 普通生成已于 2026-08-18 对首轮学校试点关闭，兼容 API 仍保留危机优先路径。专业审核和学校线下承接仍是开放条件 |
| P0 | 生成式工具缺少一致的事前确认、身份/同意绑定和持续 AI 标识 | 当前只有 Check-in、Mood Journal 两个网页工具及小程序 Check-in 调用模型，且只生成记录小结；使用 `ai-notice-2026-08-18-v2`，普通请求须通过服务端登录、有效同意与版本校验，结果持续显示“AI 辅助记录小结·非评估或诊断”。Worry Time 与 Referral 使用固定规则，Talk 已关闭。固定危机路径优先且不调用 provider；provider 数据政策与告知仍待法务、隐私、专业及学校签字 |
| P0 | 模型可直接写最终小结，来源字段、provider 与模型版本未被严格约束 | 模型现只返回最多 2/3 个来源字段 ID；服务器拒绝未知、重复、超量或额外字段，并使用经脱敏的原文片段和固定模板组成最终小结。首批试点保持受限生成开启，仍须通过 HTTPS、provider 主机与模型白名单校验，并可用环境总开关立即暂停。日期快照、供应商尽调、跨境评估与数据库 provenance 作为后续治理条件继续完成 |
| P0 | “我觉得活着没有意义”等被动轻生表达可能绕过确定性危机识别 | 已加入中英文被动轻生正例和“哲学课/作文讨论生命意义”反例；五个支持入口均在普通处理前复用同一检测器，命中后停止处理并优先连接家长、老师或其他可信任成年人。中文区分 110/120 即时危险与 12356 非即时心理支持，英文只指向当地紧急服务；词表和文案仍待专业及学校签字 |
| P1 | 站内 AI 与紧急支持文案存在旧范围描述和求助顺序不一致 | 已完成中英文公开页、工具页、隐私页、社区、消息、小程序及项目说明的专项扫描；公开说明准确区分 AI 摘要、固定规则和关闭功能，现实支持顺序统一为家庭、学校、其他可信任成年人和专业/紧急支持，不把“家庭或学校不安全”作为默认或显眼叙事 |
| P0 | Talk 的开放式 AI 对话边界、专业监督与首轮试点必要性尚未完成证明 | 已选择首轮学校试点关闭：页面不提供输入或发送，普通 API 请求返回版本化 410 状态且不调用 provider；只为旧客户端保留确定性危机优先路径。重新开放须满足 `docs/TALK_PILOT_CLOSURE.md` 的审核条件 |
| P0 | Referral 原先把结构化问卷和自由补充文字发送给模型，由模型生成支持路径 | 已改为 `referral-rules-2026-08-18` 确定性规则；普通路径只读取结构化选项，补充文字仅经过本地危机检查，不发送给 provider、不评分、不诊断。持续/明显日常影响或用户偏好只用于升级真人支持；规则仍待心理专业及学校审核 |
| P1 | `lint` 仍是占位脚本 | 未修复；列入试点后维护项，当前由 TypeScript、build 和测试覆盖 |
| P2 | 首屏插图有 LCP eager 提示 | 未修复；不影响功能，列入试点后优化 |
| P2 | 危机词规则对第三人称引用/学术讨论可能保守误报 | 未弱化安全规则；列入安全负责人参与的后续调优 |

## 权限与数据结论

- 身份由 Supabase bearer token 服务端校验；角色、学校、分配、监护关系、同意与专业验证均从数据库加载，客户端字段不作为授权依据。
- 学生仅操作本人记录；老师仅看分配学生；学校负责人仅看本校；平台管理员走可信管理名单；专业支持者须通过且未过期。
- 监护人当前只能在 active、学校核验关系下查看关联孩子，但可见的是完整 SWEET 记录与小结，不是仅摘要。该边界技术上已执行，政策仍须负责人签署。
- 社区按角色/学校/审核状态过滤；高风险内容进入 `safety_review`，普通用户不能自行发布待审核内容。
- 账号注销、同意撤回、成员撤销、学校退出均有实际生命周期测试。2026-08-11 已在真实备份的隔离副本完成一次账号删除及幂等重放，profile/SWEET 级联删除、哈希审计和第二次零命中重放均通过。
- 2026-08-11 已完成一次正式库真实数据加密导出、双副本保存、服务器端校验、Mac 端实际解密/内部哈希验证及隔离项目数据库恢复；全程未在生产库执行恢复。数据库逻辑恢复耗时 24 秒，27 张 public 表均恢复并保持 RLS，核心关系断链校验通过；恢复关系上的学生、教师、监护人和校方管理员 JWT/RLS 边界验证通过。香港服务器每日加密备份已连续成功运行两次；第二个包也已通过同一 Mac LaunchAgent 流程同步并复核 SHA-256。验证后隔离项目的 Auth、public 和 Storage 业务数据均已清空。真实邮箱 OTP/session 的隔离应用验收、跨日连续周期观察和外部失败告警仍待完成。

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
- 2026-08-18 AI P0 增量：`pnpm typecheck`、`pnpm build` 通过；危机检测、AI API guardrails、双语 AI 合约及固定安全提示界面共 32 passed（desktop/mobile Chromium）。
- 2026-08-18 AI 透明度增量（关闭 Talk 前历史批次）：版本化事前告知、当时四个 AI 生成入口服务端校验、生成内容标识、小程序和公开同意说明共 48 passed（desktop/mobile Chromium）；当前普通网页 AI 生成入口为三个。
- 2026-08-18 Referral 去 AI 增量：四类规则分支、双语输出、无 AI 告知依赖、危机优先和页面“非 AI 生成”标识共 50 passed（desktop/mobile Chromium）；最终构建结果见本次交付记录。
- 2026-08-18 Talk 首轮关闭增量：版本化 410 关闭状态、普通请求零 provider 调用、旧客户端危机优先、页面无输入、替代支持入口、青少年入口移除及中英文/窄屏回归共 76 passed（desktop/mobile Chromium）；`pnpm typecheck` 与 `pnpm build` 通过。
- 2026-08-18 AI 范围收敛与全站安全文案增量：AI/API/危机/消息社区/双语文案 82 passed（desktop/mobile Chromium）；扩展规则、Talk 关闭、i18n、内容安全与试点加固批次 92 passed，另有 2 个旧文案断言按新“家长、老师或其他可信任成年人”要求更新后 Referral 批次 10 passed。最终 `pnpm typecheck` 与 `pnpm build` 通过，构建 63 routes。
- 2026-08-18 AI 来源约束与配置收口增量：模型只选来源字段 ID、服务器严格校验与固定模板、扩展标识移除、生成总开关、provider/model allowlist 及 B–G 越界输出拒绝共 90 passed（desktop/mobile Chromium）；`pnpm typecheck` 与 `pnpm build` 通过，构建 63 routes。未调用真实 provider，供应商后台与正式环境配置仍需人工验收。

## 未能自动证明的事项

- QQ、163、Outlook 当次外部邮件投递，自有 SMTP 与 DNS 信誉。
- 真实 iPhone/Android/微信内置浏览器、真实微信小程序 AppID 与审核。
- 外部告警接收端，以及 Lighthouse、Nginx 和应用容器的受控故障告警闭环。
- 五个支持入口（含已关闭 Talk 的兼容 API）的危机固定文案、词表误报/漏报样例和校内线下承接流程仍需心理专业、安全/隐私及学校负责人共同审核签字；自动化通过不能替代该审核。
- 正式数据的隔离数据库恢复、数据库 RTO 实测、恢复关系上的 JWT/RLS 验收及删除重放已于 2026-08-11 完成；每日自动加密备份已连续成功两次，第二个包也已完成 Mac 异地同步和校验。真实邮箱 OTP/session 的隔离应用验收、跨日连续周期观察、外部失败告警和完整业务 RPO/RTO 仍待完成。
- 正式域名与香港 Lighthouse 已上线；Vercel 账户集成断开及适用备案/合规事项仍属于平台或账户侧人工操作。

只有 `ROADMAP.md` 的 PILOT BLOCKERS 全部关闭后，才可将结论提升为 **READY**。
