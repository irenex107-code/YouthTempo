# 小规模试点版 MVP 正式上线清单（准备稿，2026-09-20）

本清单仅供审批和执行窗口使用，不授权连接正式系统、执行迁移、改数据或部署。整体试点状态仍为 **READY WITH CONDITIONS**。第一批候选为年龄分流、非诊断性 SWEET 与个人趋势、家长公开教育、无家长数据读取、SWEET 花园、轻量记录和提醒、轻量反馈、Account 导出与注销及其双语页面。成年人聊天室、正式心理咨询、完整专业支持入口、未成年人直接预约和公开评分继续关闭。

1. **备份与窗口：需用户单独授权正式操作。** 确认正式项目标识、维护窗口、责任人、前一应用镜像及可用加密备份；不得使用恢复演练项目。备份后按 `docs/DATABASE_RECOVERY.md` 记录校验，不在清单或日志中保存连接串或学生数据。
2. **只读核对正式状态。** 查询 `supabase_migrations.schema_migrations` 的已应用版本与 `public.guardian_student_links` 中 active 数量，仅记录汇总。核对下面的待执行文件与实际正式迁移历史；如有差异，暂停并重新评审，不能照表盲目执行。执行前确认 `FORMAL_CONSULTATION_PUBLIC_ENABLED=false`、`FORMAL_CONSULTATION_INTERNAL_ENABLED=false`、`PEER_SPACE_ACCESS_API_ENABLED=false`、`PEER_SPACE_STAFF_API_ENABLED=false`；未设置也必须视为关闭。
3. **按顺序迁移：需用户单独授权正式数据库变更。** 已知正式基线是 `20260827200713_index_pilot_duty_foreign_keys.sql`。`20260804045915` 是补入的较早版本，须在只读历史核对后显式包含，且在 `20260919190531` 之前执行；迁移不能依赖普通“只执行较新时间戳”的行为。准确顺序和补偿边界如下：

   | 顺序 | Migration 文件 | 对既有数据的影响与补偿 |
   |---|---|---|
   | 1 | `20260804045915_pilot_feedback_replay_guard.sql` | 仅调整拒绝策略名称；中断时保持拒绝，随后应用第 11 项 |
   | 2 | `20260912161714_allow_individual_professional_applicants.sql` | 申请约束调整；异常时由审核后的补偿迁移修正 |
   | 3 | `20260917011148_add_peer_space_access_foundation.sql` | 新表及默认关闭的空间元数据；保留数据、关闭开关 |
   | 4 | `20260917020225_add_peer_space_staff_duty_foundation.sql` | 新权限和值班结构；保留数据、关闭开关 |
   | 5 | `20260919065043_add_peer_space_room_state_controls.sql` | 房间状态约束；保留关闭状态，异常走补偿迁移 |
   | 6 | `20260919134538_pilot_guardian_data_boundary.sql` | 改 RLS、禁止新 active 关系；**不删除历史关系**，回滚应用时也不得恢复家长读取 |
   | 7 | `20260919135223_add_tempo_garden_self_tracking.sql` | 新私有记录表；已有个人记录不得作为回滚副作用删除 |
   | 8 | `20260919140205_add_adult_peer_space_moderated_chat.sql` | 新消息和审核表；保持入口关闭 |
   | 9 | `20260919141714_add_micro_pilot_experience_feedback.sql` | 新私有反馈表与冷却约束；保留用户数据 |
   | 10 | `20260919142117_add_dark_launched_support_continuity.sql` | 新支持与材料结构；保持公开咨询关闭 |
   | 11 | `20260919190531_restore_pilot_feedback_server_policy.sql` | 规范化拒绝策略；不得以开放浏览器读取作为回滚 |
   | 12 | `20260919200001_grant_core_table_access.sql` | 明确服务端及既有 RLS 限定的客户端授权；异常时复核 RLS 后做补偿迁移 |

4. **迁移后只读核对。** 确认 55 份版本、关键表 RLS、私有材料 bucket、种子聊天室仍为 `closed`、正式咨询未开放、待审专业申请者无学生资料读取权，历史 active 关系数量未被迁移静默改动。任何不符立即停止后续步骤。
5. **确定历史关系处理对象：只读。** 使用 `scripts/guardian-relationship-dry-run.sql` 清点目标与同意依据，只记录预期影响数量；由产品、学校和隐私负责人确认目标、同意状态及通知方式。不得把“全部 active”当作默认修改范围。
6. **处理明确目标：需用户针对正式数据另行授权。** 对每条批准目标，以 `scripts/guardian-relationship-repair.template.sql` 在事务中先核对目标及非目标数量，再将目标改为 `revoked` 并处理相应同意与审计；数量不符即 `ROLLBACK`。正式提交后不自动恢复家长读取，修正只能走经批准的补偿流程。
7. **部署代码：需用户单独授权正式服务器变更。** 仅部署已审核的精确 Git 提交，全部新公开开关保持关闭；依照现有候选容器健康检查与切换回退流程执行，不修改 DNS、TLS 或其他部署目标。
8. **部署后最小检查。** 核对中英文首页、14–17 与 18–25 工作台、SWEET 保存与历史、旧 guardian session 和直接 API 拒绝、Account 注销、SWEET 花园与提醒、轻量反馈；直达聊天室 URL/API 与正式咨询 URL/API 仍不能开放。生产写入型检查须另行指定合成账号和明确授权，不能用真实学生数据代替。
9. **回滚与记录。** 应用故障按既有脚本回退前一镜像，所有新开关继续关闭；数据库变更和历史关系处理不得用简单删表或恢复旧家长 RLS 撤回。由 DBA 评估备份、依赖和保留义务后提出补偿迁移；记录执行时间、版本、最小化计数和审批，不记录心理正文、邮箱、token 或 OTP。

本机隔离证据：55 份迁移升级、迁移前 guardian 旧 session 失权、历史关系保留、定向修复 dry-run 回滚、历史关系下的 guardian 与学生注销、SWEET 花园和反馈 API、默认关闭入口均已通过；定向 Playwright 63 passed、0 failed、3 个重复视口 skipped。以上仅支持**进入 MVP 正式部署准备**，不替代正式操作授权及仍开放的人工/学校条件。
