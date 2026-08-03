# YouthTempo 数据库备份与恢复

更新时间：2026-08-03

## 当前结论

正式 Supabase 项目 `saqkzfsmabsgbwdvuras` 当前为 Free 套餐。Free 套餐不提供平台自动每日备份，因此不能把 Dashboard 中的时间点恢复视为已具备能力。试点开始前应建立每日加密导出、异地保存和定期隔离恢复。

当前状态：备份与恢复脚本、校验和及正式库误操作防护已经落库；baseline 已在独立 Supabase 项目验证。真实业务数据导出和隔离恢复尚未完成；本机仍需 Docker 与 PostgreSQL 17 客户端（Homebrew 安装因当前网络无法读取公式清单而未完成）、正式库与隔离库连接密码，并在恢复前清空已登记的可丢弃隔离项目，所以 ROADMAP 中的“数据库备份和恢复演练”不得勾选完成。

## 目标

- RPO：完成每日自动备份后不超过 24 小时；在自动化建立前为“未验证”。
- RTO：完成隔离演练后，以实测时间为准；在此之前不承诺恢复时长。
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

## 与 baseline migration 的分工

baseline migration 用来从空项目重建数据库结构、函数、索引、RLS 和权限；数据库备份用来恢复真实业务数据。

- 已验证文件：`supabase/baseline/20260803143336_youthtempo_baseline_20260803.sql`
- 验证日期：2026-08-03
- 隔离项目：`YouthTempo Recovery Drill`（`sebtakwjwubvdqdswtdi`，新加坡，`$0/月`）
- 验证结果：25 张业务表、30 条 RLS policy、94 个索引、核心限流/审核/学校退出函数及每日清理任务均成功创建；除两条平台管理员引导角色外，不包含业务数据或 Auth 用户。
- 后续要求：每次正式 schema 变更后同步更新 `supabase/schema.sql`；需要重做 baseline 时必须通过 Supabase CLI 生成新文件，并再次在空项目验证。

baseline 已完成空库验证，但只有真实备份数据也能在隔离环境恢复并通过应用验收后，才能把数据库备份恢复演练标为完成。

参考：[Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)。
