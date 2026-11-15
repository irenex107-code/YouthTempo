# S04_R03 隔离数据库阶段执行计划（未获执行授权）

本文件是本地交付的后续计划。**本轮没有启动数据库/容器、连接Supabase、执行SQL、迁移或回填。** 纯单元、SQL静态检查和合成存储通过，都不能关闭下面的真实数据库阻断检查。

唯一产品政策基线是 [六项已确认设计基线](../audit-records/2026-10-31/s04_r03_decisions_consolidated_20261031_220208/S04_R03_六项已确认设计基线整合记录.md)及其[检查清单](../audit-records/2026-10-31/s04_r03_decisions_consolidated_20261031_220208/S04_R03_实施前检查清单_确认基线版.md)。下文C编号沿用原37项矩阵，V编号沿用九项技术假设，不代表已执行用例数。

## 1. 开始前的独立授权

必须获得用户明确指定的隔离目标、可销毁数据范围、创建用户/fixture是否允许、SQL应用/回填/故障及清理范围。包括本机容器也不能从“本地代码实施”推定获准。

- 不选正式Supabase项目，不使用正式用户、学校或青少年内容，不从本地凭据环境自动发现目标。
- 若选择已登记的恢复项目，先按 `docs/DATABASE_RECOVERY.md` 再确认目标可销毁且无应保留数据；本文件不授权复用或清空它。
- 明确真实Auth/JWT会话验证、创建测试用户或发送OTP/邮件的单独范围。可在只批准数据库的第一阶段模拟角色/维护事务，但不能将其写成真实GoTrue删除或Email OTP通过。
- 记录PostgreSQL/PostgREST/SDK版本、实际schema/trigger/函数ACL差异；凭据、JWT、邮箱和正文不写入报告。
- 先审查本地SQL与所有写入口。禁止仅打开新RPC却继续允许旧表直写，禁止为fixture添加公开绕过函数。

正式环境迁移、数据读取预检、回填、权限切换、备份/恢复、发布及生产故障试验仍分别审批。

## 2. 本地离线预检工具的范围

`lib/sweetBackfillPlan.ts` 是纯函数；`scripts/prepare-sweet-head-backfill.mjs` 只读取显式本地JSON，不连接数据库、不读取配置凭据、不执行SQL。JSON由未来获批的导出步骤提供；本轮测试只使用合成样本。

```bash
node scripts/prepare-sweet-head-backfill.mjs --input /approved/private/snapshot.json
```

默认只输出aggregate counts和固定issue codes，不输出owner、record UUID、答案、小结或AI内容。`databaseReady`始终为false；`requiresLockedDatabaseRevalidation`始终为true。退出码：0仅表示本地样本准入，2表示有准入问题，1表示输入/输出不可用，64表示调用参数不完整。

只有显式同时提供 `--restricted-plan <new-file>` 和 `--allow-sensitive-plan` 才写候选head映射；以0600、排他创建，不能覆盖导出/旧计划。该文件只含owner/day/既有UUID/action，无内容。**SQL backfill不接受这份映射作为权威输入，必须在锁内重新计算。** 不需要该映射时不要生成或留存。

输入版本为1，必须显式提供：

| 字段 | 内容与限制 |
| --- | --- |
| `sources` | 全量SWEET源，含id/user_id/school_id/created_at、完整五维typed records和三摘要字段（缺失不等于null）。不能只取最近50行 |
| `authUserIds` | 全量相关Auth owner UUID，不导出邮箱/session/OTP；用以检查源及head owner存在 |
| `existingHeads` | 全量既有head，只有user_id/business_day/head_token/current_record_id四字段；源空墓碑也须纳入 |
| `accountSelections` | 每个有源owner/上海日的实际既有日选源 `{user_id,business_day,record_id}`，全量核对，不从50行缺失推定空 |
| `incomingForeignKeys` | 全部指向public.sweet_records.id的FK定义：schema/table/column/targetSchema/targetTable/targetColumn/onDelete/deferrable/validated/impactReviewed |
| `dependencyReferences` | 已声明完整的关联行元数据 `{relation,record_id}`，无跟进内容；对照源存在性 |
| `manifest` | 六个all…Exported声明及sourceCount/actorCount/headCount/selectionCount/foreignKeyCount/dependencyReferenceCount，必须与文件各数组相符 |
| `barrier` | phase=closed及writesPaused/tokenIssuancePaused/legacyDirectWritesBlocked/inFlightTransactionsDrained的明确声明 |

manifest的六个声明名为allSourcesExported、allActorsExported、allHeadsExported、allSelectionsExported、allIncomingForeignKeysExported、allDependencyReferencesExported。它们和barrier仅是导出者的声明，不能证明真实数据库完整或真正互斥；虚假或过期导出仍必须被锁内SQL拒绝。

预检阻断包括：非法/重复UUID、owner不存在、非法或无时区时间、微秒最大值并列、不可安全处理的完整payload（typed step/field额外键先审阅，不丢弃；UTF-16字段上限及60000-byte JSONB记录预算；NUL/不成对surrogate拒绝）、缺/重复/不一致日选源、未知/未审阅/未验证FK、悬空关联、head/pointer/owner/day/token不一致、墓碑仍有源、墓碑含额外内容字段、未声明全量或屏障。合法null不被跳过；较旧多行不被删除。任何问题整体blocked，不输出部分可用head计划。

已知incoming FK只允许经核对的 `public.school_followups.record_id` CASCADE，以及新增 `private.sweet_record_heads.current_record_id` 可延迟NO ACTION。检测到其他定义不自动“兼容”；先报告关联影响并另行确认。

## 3. 准备隔离环境与闭合切换屏障

1. 明确可信fixture播种方式及审批；先建立测试所需legacy单行/多行/null/tie/非法形状等样本。不能在正式库播种，不为应用开直写后门。
2. 获批后审阅并应用本地迁移文件。新 `private.sweet_protocol_control` 默认closed。关闭时不能发新写scope令牌或接受新CAS变更；原账户历史读取政策不扩大。
3. 测试/切换的写暂停不能只靠UI。维持数据库拒绝旧直写/晚到请求的边界，排空已执行事务，再完成其余DDL/guard/grants准备。关系锁与既有report mutex分别审查；不能未经验证边持业务mutex边任意做DDL。
4. service-only `public.sweet_scope_preflight()` 输出去内容问题与统计。验证未知FK、tie、非法时间/JSONB、选源异常都使其blocked；整个窗口不开放新写/token。
5. 只有全量准入后，另获执行范围内调用 `public.sweet_scope_backfill()`。函数在closed和既有global mutex下fresh全量复核并重新计算head；它不信任离线计划。任何异常完整回滚，源内容/UUID/时间及旧多行保持。
6. 再核对源数据不变、head覆盖/owner/day/token/pointer及墓碑一致。只有 `public.sweet_scope_open()` 自行锁内fresh复核完整通过后才可open；不把“离线CLI exit0”当开放条件。
7. `public.sweet_scope_close()` 与内容写使用同一业务互斥，验证关闭之后的所有新变更和旧REST晚到均拒绝。失败保持closed，不临时恢复authenticated INSERT/DELETE。

函数名称以交付SQL为准；此计划不表示它们已在任何数据库创建。DDL准备、锁序、grants、Auth维护例外和回填整体rollback均是隔离阶段必须实测的事项。

## 4. 双连接确定性协议试验

使用两个独立数据库连接和明确BEGIN/锁占用/提交屏障。每个场景应分别保存连接标识、scope/expected、比较前后head、提交/回滚结果、源行与B数据对照和计数；公共报告只放去标识统计，受限证据不含凭据或真实内容。不得用随机sleep、两个JS Promise或缓存变量代替实际事务并发。

| 试验组 | 明确控制的顺序与必需判据 | 原矩阵/假设 |
| --- | --- | --- |
| 首次创建 | 两连接先读ABSENT；一方持mutex提交后再放另一方。最多一笔head推进；反向顺序重复。第一笔在中途失败则仍U，无ghost，第二笔可成功 | C06–C09/C25；V02 |
| 旧版本和null | S1基线请求先冻结但延后执行；S2先提交，再放旧S1/旧clear。旧请求在任何DELETE/INSERT前conflict；源/head仍S2，B完整行不变 | C01/C03/C05/C13/C17；V02/V08/V09 |
| NOOP和clear | 当前token同内容多次NOOP，不推进head/行数/参与日；preserve先NOOP后clear可成功，clear先推进后旧preserve冲突 | C04/C09/C21–C23；V09 |
| 提交丢ACK | 服务端先真正提交，阻断客户端收响应；原expected重试不重复写。随后S2已提交时旧请求仍不能自动换token或日期 | C02/C10/C11/C14；V08/V09 |
| 事务部分失败 | 在解除pointer、DELETE、INSERT、head更新、FK/trigger各边界用获批的隔离故障方式中断；source/head、followup级联及report失效必须完整rollback | C25/C28/C33；V02/V03 |
| 读取快照 | source/head变更交错时token＋payload不能跨版本配对；S2确认后新账户读取为S2，旧在途读由UI代际丢弃 | C29/C31/C34；V08 |
| 回填竞争 | closed内挂住旧变更/回填；证明旧事务仅在最终快照前结算或之后拒绝，不能夹在回填/开放之间；部分回填失败不开放 | C25/C26/C30；V07 |

## 5. Auth删除、权限与最小元数据

- 真实Auth阶段另批后，按现API Auth硬删除路径验证live源＋多个墓碑的同事务清理。新head owner→auth.users CASCADE；head→source FK在提交时验证，不依赖偶然触发顺序。
- 两门序都测：CAS先提交后Auth删除应清新源/head；Auth先提交后CAS必须fresh拒绝用户不存在，不能当ABSENT重建。删除故障源/head共同回滚；unknown沿原注销回执协调。
- 旧JWT尚可解码、旧ACK及同邮箱新UID不能复活旧数据或重绑新actor。B不受影响。
- 只证明在线source/head的事务边界；不将导出、Storage、审计、后清理或备份统称一个原子注销流程。原政策不改，不新增TTL/GC或复制内容进审计。
- 逐角色检查PUBLIC/anon/authenticated/service/真实Auth维护角色。EXECUTE所有重载和默认权限、private USAGE/表DML、source RLS、旧DML撤销、head/source guard、metadata-only例外必须分别验证。service-role INVOKER并不自动受普通RLS保护，锁内Auth/profile/consent必须真实执行。

对应C12/C18/C26/C32–C34、V01/V03/V05；这些当前仍是阻断检查，不以纯模型模拟注销代替。

## 6. 时间、历史目标及真实网络

- 在两个连接分别设置不同session timezone，且浏览器用户时区不同，记录归属/参与日/scope均必须按Asia/Shanghai。
- 用数据库实际today构造昨日operationDay，验证scope_expired且零写；历史targetDay删除作为当前新操作仍按原范围可用。
- 锁后采样点与事务开始now()必须区分。真实“等锁跨午夜”需获批的上海午夜窗口，以锁/提交屏障控制；不改主机/数据库时钟，不在正式环境暴露可覆盖服务器时间的参数。
- 23:59已接受但00:00提交/ACK仍属接受日；等锁到00:00才接受的昨日scope必须拒绝。没有合适窗口时明确保留未执行，不让静态/模拟替代。
- 真实网络断开/重连、GoTrue/JWT过期或撤回、多设备、OTP及真实AI各有单独授权；合成503不代表真实网络/认证已验证。

对应C15–C19/C24/C27/C29/C31/C35–C37、V04/V08。

## 7. 结果门槛与收尾

每个C项分列纯单元/SQL静态/合成/实际PostgreSQL/真实Auth网络证据。原37条场景不是37次执行；语言变体、重复运行、前置超时和真正业务失败分别计数。原S04/R01/R02/联合/ABA业务oracle保留，相关S01–S03和花园定向兼容另记，不扩完整回归。

只有双连接CAS、首次/unknown、Auth/FK/guard、时间、回填屏障及合法null等阻断检查实际通过后，才可讨论数据库阶段验收。异常legacy数据、未知关联、无法证明入口封闭或政策冲突立即停止，不能把迁移/SQL执行失败改写为可接受NOOP。

按获批清理范围关闭测试写入、核对无遗留数据库连接/临时用户/受限导出和故障开关；保留去内容执行日志、schema/权限摘要及恢复检查点。源/head/权限必须一致恢复，失败保持closed，不开放无CAS旧写。**本地交付完成不自动启动本计划或正式发布。**
