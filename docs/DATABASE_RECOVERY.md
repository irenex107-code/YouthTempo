# YouthTempo 数据库备份与恢复

更新时间：2026-08-11

## 当前结论

正式 Supabase 项目 `saqkzfsmabsgbwdvuras` 当前为 Free 套餐。Free 套餐不提供平台自动每日备份，因此不能把 Dashboard 中的时间点恢复视为已具备能力。试点开始前应建立每日加密导出、异地保存和定期隔离恢复。

当前状态：备份与恢复脚本、校验和及正式库误操作防护已经落库；baseline 已在独立 Supabase 项目验证。2026-08-11 已完成一次正式库真实数据逻辑导出、加密双副本保存、本机实际解密校验，以及隔离项目数据库恢复、结构/关系校验、基于恢复关系的 JWT/RLS 角色边界验证和账号删除重放。数据库逻辑恢复耗时 24 秒；香港服务器的每日加密备份已连续成功两次，第二个包也已通过 Mac 异地同步复核。完整应用登录验收、跨日连续周期观察和外部失败告警仍未完成，所以 ROADMAP 中的“数据库备份和恢复演练”暂不勾选完成。

## 目标

- RPO：每日自动备份已配置，目标不超过 24 小时；首次任务已成功，但仍需观察连续运行并建立外部失败告警后才能视为稳定达成。
- RTO：本次数据库逻辑恢复实测 24 秒；这不包含创建隔离项目、解密、应用切换、认证验收、DNS 或人工决策时间，因此不能作为完整业务恢复承诺。
- 保留：每日备份滚动保留 30 天；每月首份保留 12 个月。备份必须加密，并存放在项目目录和开发电脑之外的受控位置。
- 权限：仅平台负责人和指定恢复人员可读取连接串、备份包及解密材料；连接串不得写入仓库、终端日志或 CI 输出。

## 备份

1. 安装并启动 Docker Desktop，准备正式 Supabase 的数据库连接串；只通过 `SUPABASE_DB_URL` 环境变量传入。
2. 在仓库根目录运行 `pnpm db:backup`。脚本默认使用已核准的 Supabase CLI `2.111.0`，分别导出角色、结构和数据，并生成 SHA-256 校验和；升级版本前需重新核对官方备份文档。
3. 检查 `backups/<UTC 时间>/` 中存在 `roles.sql`、`schema.sql`、`data.sql`、`SHA256SUMS` 和 `metadata.txt`。
4. 对目录加密后复制到异地受控存储；确认副本可读取后，删除开发机上的明文临时目录。
5. 备份作业失败必须进入错误监控，不得静默跳过。

## 隔离恢复演练

恢复演练只能指向空白、可丢弃的数据库，禁止指向正式项目。执行前需要人工核对目标主机、项目名和数据可删除性。

1. 使用已登记的隔离项目 `sebtakwjwubvdqdswtdi`，确认其中没有需要保留的数据并清空数据库；安装兼容版本的 `psql`。
2. 设置 `RESTORE_TARGET_DB_URL`，再设置确认口令 `ALLOW_EMPTY_RESTORE_TARGET=I_HAVE_VERIFIED_THIS_IS_DISPOSABLE`。
3. 运行 `pnpm db:restore:drill -- backups/<UTC 时间>`。脚本会先校验文件，再在一个事务中恢复角色、结构和数据，并在数据阶段关闭触发器；正式项目 ref 或未登记的其他项目都会被直接拒绝。
4. 记录开始、结束时间和三张核心表的行数；与源库备份时记录比对。
5. 将应用临时连接到隔离库，验证：邮箱登录、个人记录读取、学校角色隔离、成员撤销、社区可见范围、账号注销。
6. 对备份生成后发生的账号注销和逐条删除请求进行重放，再确认被删除数据没有因恢复重新出现。
7. 销毁隔离数据库，并在演练记录中保留日期、操作者、备份时间点、RPO、RTO、校验结果和问题清单，不保存连接串或个人数据样本。

## 真实备份验证记录

- 备份时间点：2026-08-10 18:06:38 UTC（北京时间 2026-08-11 02:06:38）。
- 来源：正式 Supabase 项目 `saqkzfsmabsgbwdvuras`；只读导出角色、结构和数据。
- 加密文件：`youthtempo-supabase-20260810T180638Z.tar.gz.age`，43,240 bytes。
- 加密文件 SHA-256：`0b7008f450298f8b6cbe99c31dab9a1623625e17ab3161dc9b6cea4f4e3baff2`。
- 副本位置：香港服务器受限备份目录和开发负责人 Mac 的仓库外受限目录；两端均只保留加密包与校验文件。
- 验证：服务器端加密包 SHA-256 通过；Mac 端使用对应 SSH 私钥实际解密成功；归档成员白名单及 `roles.sql`、`schema.sql`、`data.sql` 内部 SHA-256 全部通过；验证后临时明文已删除。
- 安全收尾：首次备份验证产生的服务器临时数据库连接文件、明文 SQL、明文归档及失败转储已删除；连接串和密码未写入仓库。
- 隔离恢复：2026-08-11 在登记项目 `YouthTempo Recovery Drill`（`sebtakwjwubvdqdswtdi`）完成真实数据恢复。恢复开始于 2026-08-10 18:51:59 UTC，完成于 18:52:23 UTC，数据库逻辑恢复耗时 24 秒；备份在演练开始时距生成时间 45 分 21 秒。
- 恢复兼容处理：第一次事务因隔离项目已由平台管理 `pg_cron` 等扩展而失败并完整回滚；第二次仅从恢复副本中移除 5 条已安装扩展的 `CREATE EXTENSION IF NOT EXISTS` 语句。原始 `schema.sql` 未修改且校验和继续通过；恢复副本 SHA-256 为 `41508fcaeeb273cef424fb5a54df36f8a1af185817be1b979db8c7318a1c60d5`。
- 恢复结果：27 张 public 表、27 张启用 RLS、32 条 RLS policy、18 个 Auth 用户、4 所学校、16 份 profile、7 条 SWEET 记录、103 个索引、11 个 public 函数和 4 个业务触发器均恢复；`session_replication_role` 已回到 `origin`。
- 关系校验：学校成员、监护关系、教师分配、同意记录与 profile/学校的断链计数均为 0。SWEET 记录有 2 条未匹配当前 profile；正式库只读对比也是相同的 2/7，属于源数据状态而非恢复丢失，需另行治理且不得在恢复演练中擅自删除。
- 顾问检查：所有 public 表均保持 RLS。隔离项目提示 4 张服务端流程表“RLS 已启用但无客户端 policy”，以及恢复项目 Auth 未启用泄露密码保护；另有 RLS 初始化计划和多 permissive policy 的性能提示。此次演练不改动 schema 或 Auth 配置。
- 每日自动化：香港服务器 `youthtempo-supabase-backup.timer` 已启用，每天 03:20 执行并随机延迟最多 20 分钟；每日包保留 30 天，每月首份保留约 12 个月。正式库连接文件、age 接收者文件和备份均为 `600` 权限，任务只读导出并在结束时删除明文临时目录。
- 异地同步：Mac LaunchAgent `com.youthtempo.supabase-backup-sync` 已启用，每天 04:15 将服务器最新加密包和校验文件拉取到仓库外的受限目录，校验 SHA-256 后保留 30 天；首次 RunAtLoad 同步退出码为 0，错误日志为空。
- 自动化首跑：2026-08-10 19:02:30 UTC 开始，19:02:53 UTC 成功完成；加密包 `youthtempo-supabase-20260810T190230Z.tar.gz.age` 为 43,333 bytes，服务器与 Mac 异地副本 SHA-256 均为 `43d9e6e4adf80c6cfa22a32391b7fe8939abf07da8d6eeea917be0eb9917c5c4`。
- 自动化第二次运行：2026-08-10 19:36:43 UTC 由 systemd timer 自动触发，19:37:04 UTC 成功完成，`Result=success`、`ExecMainStatus=0`；新加密包 `youthtempo-supabase-20260810T193643Z.tar.gz.age` 为 43,317 bytes。随后手动触发同一 Mac LaunchAgent 同步流程，运行次数增至 2、退出码为 0，新包已保存到仓库外受限目录且本地重新计算的 SHA-256 与服务器校验文件一致。下一次服务器计划运行时间为 2026-08-12 03:22 CST；仍需跨日观察才能认定连续周期稳定。
- 角色/RLS 验收：在隔离项目内以 `authenticated` 角色和恢复用户 JWT claim 分别模拟学生、已分配教师、已核验监护人和校方管理员。学生仅见本人 1 条记录；教师仅见已分配学生 1 条；监护人仅见已关联孩子 1 条；校方管理员仅见本校 2 条。普通用户无账号删除审计、学校退出和学生消息服务表读取权限，不能修改 `profiles.role`；自行修改 `school_id` 被数据库触发器以 `profile_school_assignment_server_only` 拒绝。
- 删除重放：仅在隔离副本选择一个非管理员账户执行与正式注销流程等价的数据库删除和邮箱引用清理；第一次删除命中 1 个账户，第二次重放命中 0 个且安全完成。profile 和 SWEET 记录均已级联删除，审计状态为 `completed`，审计中的用户和邮箱标识均为 64 位 SHA-256，不保存明文。
- 隔离数据清理：验证后已删除剩余 17 个隔离 Auth 用户并清空全部 27 张 public 表；复核结果为 Auth 用户 0、Storage 对象 0、非空 public 表 0、public 行数 0。结构继续保留 27/27 张表启用 RLS、32 条 policy、11 个 public 函数和 4 个业务触发器，便于下一次演练。
- 未完成：应用临时连接隔离库后的真实邮箱 OTP/session、成员撤销和社区可见范围端到端验收，自动备份连续周期观察，以及外部失败告警。

## 与 baseline migration 的分工

baseline migration 用来从空项目重建数据库结构、函数、索引、RLS 和权限；数据库备份用来恢复真实业务数据。

- 已验证文件：`supabase/migrations/20260718172309_youthtempo_baseline.sql`
- 验证日期：2026-08-03
- 隔离项目：`YouthTempo Recovery Drill`（`sebtakwjwubvdqdswtdi`，新加坡，`$0/月`）
- 验证结果：25 张业务表、30 条 RLS policy、94 个索引、核心限流/审核/学校退出函数及每日清理任务均成功创建；除两条平台管理员引导角色外，不包含业务数据或 Auth 用户。
- 后续要求：每次正式 schema 变更后同步更新 `supabase/schema.sql`；需要重做 baseline 时必须通过 Supabase CLI 生成新文件，并再次在空项目验证。

baseline 已完成空库验证，但只有真实备份数据也能在隔离环境恢复并通过应用验收后，才能把数据库备份恢复演练标为完成。

参考：[Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)。
