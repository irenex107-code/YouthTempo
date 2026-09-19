# 会前版本部署准备手册（未执行）

功能分支 `codex/teacher-review-product-realignment`；目标是下一轮独立审批后的 PR 与候选部署。本轮不能 merge、部署、改正式变量、执行正式 Migration 或修复真实关系。具体提交 hash 在分主题提交完成后从 `git log` 填入 PR，禁止把本手册当成生产执行授权。

2026-09-19 远端状态：本地分主题提交已形成，`git push` 因 GitHub 443 连接失败而未成功；不能创建 PR 或开始部署。先恢复网络，再运行 `git push -u origin codex/teacher-review-product-realignment` 并核对远端 HEAD 与本地一致。

## 环境与开关

| 变量 | 初始值 | 用途 |
|---|---|---|
| `FORMAL_CONSULTATION_PUBLIC_ENABLED` | 未设置或 `false` | 成年人公开正式咨询，发布时继续关闭 |
| `FORMAL_CONSULTATION_INTERNAL_ENABLED` | 未设置或 `false` | 内部许可测试，总开关 |
| `FORMAL_CONSULTATION_TEST_USER_IDS` | 空 | 经批准的隔离测试账号 UUID，避免邮箱名单 |
| `PEER_SPACE_ACCESS_API_ENABLED` | 未设置或 `false` | 成年人邀请/规则与聊天室资格 API |
| `PEER_SPACE_STAFF_API_ENABLED` | 未设置或 `false` | 独立工作人员排班/房间状态 API |
| `PEER_SPACE_AI_REVIEW_ENABLED` | 未设置或 `false` | 可选 AI 辅助分类；关闭时确定性风险识别仍运行 |

不得把服务密钥或测试账号放入仓库。`PEER_SPACE_UI_PREVIEW_ENABLED` 是旧开发预览开关，不授权真实聊天室。聊天室消息用每五秒、每次重新校验授权的 API 短轮询，不启用 Supabase Realtime publication。服务端密钥沿用既有运行环境，私有 Storage bucket 由迁移建立；AI 辅助可关闭，人工审核和确定性规则仍需可用。

## PR 与部署顺序

1. 从本分支向 `main` 建 draft PR，附上本手册、测试结果与明确未完成项；由代码、产品、学校和隐私负责人分别审核。
2. 在**独立 E2E 项目**先按下面顺序执行迁移与 fixture，运行浏览器、直接 Data API、RLS、旧 session、Storage 和删除测试。本机隔离库已有合成角色、Storage 与生命周期证据，但历史 active 监护关系的迁移前旧 session 及最新授权迁移双路径重跑仍开放。
3. 明确正式数据库变更批准和维护窗口后，先只读查询 `scripts/guardian-relationship-dry-run.sql`，记录预计影响行数和经授权的处理对象；不得将真实 ID、邮箱或心理内容写入 PR。
4. 获得正式数据库单独授权后备份并按序应用迁移。安全迁移先于新版 API 上线，否则旧 RLS 仍可能允许历史家长关系读取，新 API 也会引用不存在的表。
5. 对历史关系如需实际解除，取得**另一项明确数据修复授权**，逐行核对并使用 `scripts/guardian-relationship-repair.template.sql` 的事务流程。撤回监护依据同意会使该学生需要重新完成适用的本人同意；学校须事先通知并安排后续支持。
6. 迁移验收通过后 merge PR；`main` Verify 通过才由既有受限 SSH/CD 自动部署到腾讯云 Lighthouse。不得绕过候选容器健康检查或失败回滚。
7. 部署时所有新服务开关保持关闭，核验公众只看到正式咨询“暂未开放”；经独立授权与排班准备后才逐项打开内部测试/聊天室开关。

## Migration 顺序与数据影响

隔离全新安装发现 consolidated baseline 与已共享的 `20260804045916_add_pilot_feedback.sql` 重复创建 `pilot_feedback_server_only`。新增 `20260804045915_pilot_feedback_replay_guard.sql`（先把既有拒绝策略临时改名，始终不开放读取）及 `20260919190531_restore_pilot_feedback_server_policy.sql`（恢复规范拒绝策略并清理临时名）；不改旧数据。前者版本早于正式已知迁移头，未来正式审核必须先核对迁移历史与 `--include-all` dry-run，确保它在最终修复之前执行。若中途失败，保留拒绝策略并在隔离环境复核补偿，不恢复浏览器访问。此处只记录待审风险，不授权执行正式迁移。

随后处理此前未合并的 `20260912161714_allow_individual_professional_applicants.sql`（机构可选）及 `20260917*` 解忧室访问、值班基础和 `20260919065043_add_peer_space_room_state_controls.sql`，然后：

| 顺序 | 文件 | 主要影响 | 历史行 |
|---|---|---|---|
| 1 | `20260919134538_pilot_guardian_data_boundary.sql` | SWEET RLS 移除监护人读取、阻止新 active 关系 | 不改旧行；旧 active 预计数须只读查询 |
| 2 | `20260919135223_add_tempo_garden_self_tracking.sql` | 私有轻量记录、提醒偏好与 RLS | 新表 0 行 |
| 3 | `20260919140205_add_adult_peer_space_moderated_chat.sql` | 跨校主题房间种子、消息/控制/举报/审核、触发器与 RLS | 最多两条新主题 room；不改旧消息 |
| 4 | `20260919141714_add_micro_pilot_experience_feedback.sql` | 私有七天冷却反馈表与 RLS | 新表 0 行 |
| 5 | `20260919142117_add_dark_launched_support_continuity.sql` | 四类申请、私有材料 bucket、支持事项/分配/审计/评价与 RLS | 新表 0 行；bucket 1 个 |

预计旧 active 监护关系**不能用先前快照的 1 行当作当前事实**；实际影响行数必须从只读查询现场记录。迁移 1 不物理删除历史关系，不自动撤回旧 consent。支持存储与新表均仅服务端操作。`supabase/schema.sql` 应与顺序执行后的结构一致。

## 隔离 dry-run 与回滚

在独立项目核对所有迁移版本和前后 schema，执行 `supabase db lint`、RLS advisor、角色矩阵与真实 SQL。2026-09-20 本地空库 54/54 与从 `20260827200713` 升级的 11 份待执行迁移通过，最终 schema 一致；随后因合成登录验证发现基础表缺少 `service_role` 和客户端必要 grant，新增 `20260919200001_grant_core_table_access.sql` 并在现有隔离库应用。当前 55 份迁移记录、55 张 `public` 表 RLS、显式授权、私有 bucket、关闭的种子房、安全 advisor 和 DB lint 均通过；**第 55 份加入后的空库与基线升级双路径尚待重跑**。16 个本机合成 Auth 账号已完成直接 RLS 4 允许/32 拒绝、四类人员范围、聊天室、Storage、支持事项、反馈并发和成年人注销测试；历史 active guardian 旧 session 与注销仍未通过，不能据此准备正式变更。生产 dry-run 仅做只读计数和 `BEGIN ... ROLLBACK` 事务预演，真实 `COMMIT` 要另行批准。迁移前保留数据库备份与应用镜像；DDL 的回滚必须由 DBA 评估依赖和数据保留，不能简单删表。历史关系修复在事务未提交前用 `ROLLBACK`；提交后不得自动恢复监护读取，应通过新批准的政策、同意和补偿迁移处理。应用异常按现有 `scripts/deploy-lighthouse.sh` 回退旧镜像，同时保持新开关关闭；若 RLS 安全迁移已生效，不能为了应用回退恢复家长访问。

## 上线后最小核验与人工条件

- 访客、未成年人、受邀/未受邀成年人、guardian、四类支持人员、审核员、平台管理员分别验证允许/拒绝路径；旧 session 及直接 Data API 必测。
- 双语桌面、iPhone Safari、Android Chrome、微信内置浏览器；真实 OTP/邮件送达，隐私 Storage 签名链接、删除/导出、紧急文字与人工队列。
- 房间主班、独立备班、责任时段、外部告警及离线升级路径由运营给出具名、带日期证据。没有这些不能开放聊天室。
- 正式咨询是否开放、专业人员考评、监督、暂停/退出标准及家长未来分享由张老师与指定签署人决定；本次代码没有公开排行、自动淘汰或支付。
- 试点总状态继续 **READY WITH CONDITIONS**，其余 `ROADMAP.md` PILOT BLOCKER 不会因本功能分支构建通过而关闭。
