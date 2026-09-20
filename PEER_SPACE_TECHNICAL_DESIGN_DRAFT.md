# 解忧室实时群聊数据库、API 与权限技术设计草案

> **2026-09-19 新方向提示：** 本文保留早期决策/设计脉络；与 `ROADMAP.md` 会前版本方向冲突的唯一公共房间、可展示经验证姓名、无普通倾听志愿者或尚未实现的描述均以新路线图和 `docs/TEACHER_REVIEW_READINESS.md` 为准。代码仍处开发分支，正式环境未开放。

状态：**截至 2026-09-19，已完成三批尚未应用的本地基础：成年人邀请/规则确认/公共房间成员期、独立工作人员 capability 与值班租约、房间开房/只读/暂停的原子控制及审计。相关 API 均由默认关闭的服务端开关保护，普通客户端业务表仍 deny-all，公共房间初始 `closed`；未创建消息、Realtime、审核/安全队列、生产排班或真实人员授权，租约回收持续调度和 60 秒内部提醒尚未接入。新增房间迁移尚未在数据库执行。本实现不授权正式迁移或真实用户开放。其余技术、隐私/安全和审核运营设计继续待逐批确认。**

关联基线：

- `PEER_SPACE_PRODUCT_DECISION.md`
- `PEER_SPACE_ADULT_MVP_DESIGN_DRAFT.md`
- `PEER_SPACE_STUDENT_UX_DESIGN_DRAFT.md`
- `PEER_SPACE_STAFF_UX_DESIGN_DRAFT.md`
- `SECURITY_PERMISSION_MATRIX.md`

本草案只覆盖 `18_plus` 邀请制解忧室。未来 `14_17` 仅保留不可用的年龄空间结构，状态保持 `hidden`，没有入口、候补名单、API 读取、实时订阅或内容写入。

## 1. 推荐架构

### 1.1 独立 `peer_space_*` 数据域

推荐建立独立数据域，不在 `community_posts`、`community_comments` 上增加字段后混用：

1. 家校医社区按角色和学校范围组织帖子；解忧室按年龄、邀请资格和实时房间 membership 授权。
2. 社区作者可能显示 `display_name`；解忧室只能按本人当前房间身份设置返回系统匿名标识、房间昵称或经验证姓名，以及学生主动开启的验证学校标签，绝不回退到邮箱或未经验证的账号名称。
3. 实时群聊需要房间状态、排班、断线补齐、消息幂等和实时订阅授权，现有帖子模型不能表达。
4. 首期只有一个跨学校公共房间，允许多个试点批次共同参与；`cohort` 不承担内容可见范围，学校认证也不创建聊天室。
5. 账号—房间身份映射、学校展示偏好和安全身份查看必须独立审计，不能混入普通社区查询。

现有确定性安全检查、举报分类、限流、屏蔽、禁言和审核审计代码模式可以抽取为共享能力，但不能共享帖子、作者展示或权限查询。

### 1.2 持久化消息为准，Realtime 只负责及时通知

推荐发送链路：

1. 客户端把文字和幂等键提交到 Pages Router API，不直接向 Realtime Broadcast 发送消息。
2. API 每次重新验证 session、年龄、同意、试点 membership、room membership、房间状态、禁言和限速。
3. API 在任何广播前执行确定性危机识别和内容安全检查。
4. 普通消息写入 `peer_space_messages` 并提交成功。
5. 服务端或数据库只向对应私有频道发送最小失效事件，例如随机 `message_id` 和事件类型；不在 WebSocket payload 中发送正文、学校、昵称或账号信息。
6. 已授权客户端收到事件后，通过消息 API 按游标批量补取当前仍可见的消息。

该方式多一次受控 API 读取，但有三个重要收益：

- 断线、删除、屏蔽、审核和历史分页始终以业务数据库为准。
- 学校标签可按用户当前偏好渲染，不会作为旧消息快照永久残留。
- Supabase Realtime 频道权限在连接期间会缓存；成员被撤销后，旧连接即使短暂收到随机消息 ID，也无法绕过逐次鉴权 API 读取正文。

### 1.3 Supabase Realtime 频道

- 每个聊天室使用不可猜测的私有 topic，例如 `peer-room:<opaque-id>`，不把学校名称、年龄或试点批次写进 topic。
- 项目应关闭 Realtime public channel access；浏览器只订阅 `private: true` 频道。
- Realtime 使用 `realtime.messages` 上的 RLS 判断谁可以接收 Broadcast；普通学生不获得客户端 Broadcast `INSERT` 权限。
- 不在首批向学生开放 Presence，因此不会传送成员在线名单、个人在线状态或“正在输入”。房间是否开放来自排班和房间状态，而不是在线人数。
- Supabase 目前推荐 Broadcast 而不是 Postgres Changes 作为可扩展和更安全的数据库变更分发方式；正式实现前仍须按届时 changelog 与文档复核。
- 2026 年平台已锁定 `realtime` schema 的对象修改，仅允许管理 `realtime.messages` RLS；不得尝试在该 schema 新建表、函数或修改平台对象。

### 1.4 Realtime 授权桥接

普通业务表继续不向 `authenticated` 开放。为使 `realtime.messages` RLS 能安全判断房间订阅，可增加一张内容最小化的授权桥接表 `peer_space_realtime_access`：

- 只保存 `user_id`、不可猜测 `room_topic`、状态和过期时间，不保存昵称、学校、消息或审核内容。
- `authenticated` 只获得 SELECT 本人 active 行的权限，并由 RLS 强制 `(select auth.uid()) = user_id`。
- 只有可信服务端流程可以写入、撤销或续期授权行。
- `realtime.messages` 的 SELECT policy 同时检查 `realtime.topic()`、Broadcast extension、本人 active 授权和过期时间。
- 普通学生不获得 `realtime.messages` INSERT policy；所有广播来自受控服务端或经过审核的数据库事件路径。

这张表是普通客户端 deny-all 原则的唯一拟议例外，只包含建立私有频道所需的最小事实。实现前须验证 Data API 暴露设置、GRANT、RLS、旧 JWT 和已建立连接的撤销边界。

## 2. 概念数据模型

以下是待审批的对象职责，不是最终 SQL。

### 2.1 `peer_spaces`

表示年龄产品空间：

- `id uuid`、稳定 `code text`。
- `age_scope text`：仅 `18_plus` 或 `14_17`。
- `status text`：`hidden`、`invite_only`、`active`、`paused`、`closed`。
- `rules_version text`、创建与更新时间。

首个可启用空间只能是 `18_plus`。即使预建 `14_17` 数据行，也必须为 `hidden`，API 仍硬性拒绝未成年人。

### 2.2 `peer_space_cohorts`

表示邀请和运营批次，不是可见范围：

- `id uuid`、`space_id uuid`。
- `partner_school_id uuid null`：仅说明运营合作来源，不创建学校房间访问权，也不进入学生消息响应。
- 内部名称、状态、开始结束时间和创建更新时间。

来自不同 cohort 的 active 成年成员可以共同进入大家房间。关闭一个 cohort 只撤销该批次 membership，不应改变其他批次的房间结构。

### 2.3 `peer_space_memberships`

表示账号在年龄空间和试点批次中的资格：

- `id uuid`、`space_id uuid`、`cohort_id uuid`、`user_id uuid`。
- `status text`：`invited`、`active`、`paused`、`left`、`removed`。
- 当前规则版本、接受时间、邀请与结束审计字段。
- 限长的运营原因，不写聊天正文。

至少需要 `(space_id, cohort_id, user_id)` 唯一约束、复合一致性约束及外键索引。激活时服务端确认学生角色、有效 `student_consents`、`18_plus` 和 `adult_self`；客户端不能提交或覆盖这些事实。

#### `peer_space_rule_acceptance_events`

每次接受新规则追加不可变事件，不能用更新当前 membership 覆盖旧确认记录。

### 2.4 `peer_space_rooms`

表示真正的内容可见范围：

- `id uuid`、`space_id uuid`、不可猜测 `realtime_topic text`。
- `room_type text`：首期只允许 `everyone`；`school` 与未来主题类型不写入当前 migration 或运行配置。
- `scope_school_id uuid null`：首期强制为空；未来本校房间升级须另行批准字段约束。
- `status text`：`staffed_open`、`read_only`、`paused`、`closed`。
- 历史分页配置、计划开放时间、规则版本和创建更新时间；历史授权边界不由房间配置覆盖，而由查看者的成员期决定。

一个 `18_plus` 空间首批只有一个大家房间。可信学校认证只影响本人可选的学校标签和经验证姓名，不创建 `school` room、room membership 或 Realtime topic。未来本校房间升级见 `PEER_SPACE_FUTURE_UPGRADES.md`。

### 2.5 `peer_space_room_memberships`

表示学生具体可进入哪些房间：

- `id uuid`、`room_id uuid`、`membership_id uuid`。
- `status text`：`active`、`muted`、`left`、`removed`。
- `current_intent text null`：当前交流期待。
- `show_verified_school boolean`：默认 `false`，仅大家房间允许为 `true`。
- `auto_join_suppressed boolean`：本人主动退出后为 `true`，防止刷新、登录或同一学校重复同步时自动加回。
- `visible_from timestamptz`、`visible_until timestamptz null`：这一段房间成员资格的历史可见区间。
- 加入、更新、结束时间及最小化原因。一次退出后重新加入须创建新的成员期，不覆盖旧区间。

约束要求：

- 同一 `(room_id, membership_id)` 同时最多一条 active/muted 记录；允许保留多段已经结束的成员期。
- membership 与 room 必须同属一个 age space。
- 首次接受解忧室规则时，服务端自动创建大家房间成员期；学校认证建立或变化不创建其他成员期。客户端提交的 school ID 不参与授权。
- 本人主动退出后结束当前成员期并设置 auto-join 抑制；本人明确重新加入时清除抑制。规则、登录或学校关系同步不能绕过。
- 首期只有 `everyone` 房间允许学生本人修改 `show_verified_school`。
- room membership 激活、暂停或撤销时同步更新 `peer_space_realtime_access`。
- 历史查询只返回消息时间落在本人任一获准成员期内的行。后来加入者不能读取加入前的消息；退出或被移出期间的消息不能在重新加入后补发。

### 2.6 `peer_space_verified_names`

首批为经验证姓名建立独立事实，不复用可编辑资料字段：

- `id uuid`、`user_id uuid`、`verified_name text`。
- `source_type text`：首批只允许 `school_roster_attestation`。
- `source_school_id uuid`、`source_reference_id uuid`：关联受信任的学校名单确认事件，不保存原始名单文件或身份证件。
- `verified_by uuid`、`verified_at timestamptz`：必须是当时有权管理该校名单的学校负责人或平台受信任操作者。
- `status text`：`active`、`correction_pending`、`revoked`、`expired`。
- `invalidated_at timestamptz null`、最小化原因类别、创建与更新时间；更正和撤销追加不可变审计，不能覆盖原记录。

当前 `profiles.display_name` 可由本人修改；Auth metadata 也不是姓名核验事实。现有 `school_invites.display_name` 可以作为未来名单确认界面的预填输入，但它当前缺少独立确认状态、确认人和完整更正审计，不能直接生成 `active` 经验证姓名。首批不收身份证、学生证、人脸或其他证件副本，也不从邮箱前缀推断姓名。

只有受信任的学校名单流程可以创建、确认、更正或撤销该记录。普通客户端、解忧室值班、内容审核、安全值班和 `config_admin` 均不能直接写入；学校负责人只能处理本人学校范围内的姓名确认，且接口不返回学生是否使用实名、加入了哪个房间或任何聊天活动。

姓名记录失效、进入更正、对应学校验证失效或姓名内容变化时，服务端在同一受控事务中把公共房间内引用该记录且仍为 `verified_name` 的身份改为 `room_alias`，清除公开姓名缓存并追加身份变更审计。重新产生 active 记录后不自动改回实名。

### 2.7 `peer_space_room_identities`

将每个房间的对外身份设置与真实 membership 分开，按稳定 `(room_id, membership_id)` 保存，而不是复制到每条消息：

- `id uuid`、`membership_id uuid`、`room_id uuid`，二者组合唯一。
- `identity_mode text`：`anonymous`、`room_alias`、`verified_name`，默认 `room_alias`。
- `anonymous_code text`：每段成员期生成的随机短标识，只用于向同房间成员区分发言者，不跨房间复用。
- `alias_code text`：来自审核词库的房间昵称，不存自由输入昵称。
- `verified_name_source_id uuid null`：选择 `verified_name` 时引用当时 active 的 `peer_space_verified_names`；未经验证的 `profiles.display_name`、邮箱、Auth metadata、自由输入或现有邀请姓名不能进入此模式。
- 模式变更、二次确认版本、创建和更新时间。

同一 room 内 active `anonymous_code` 与 `alias_code` 分别唯一。首期只生成公共房间身份；未来增加任何房间时必须重新生成，不能跨房间复用稳定标识。中英文通过同一 code 渲染对应词典。切换身份模式后，历史 API 使用当前模式重新渲染本人所有可见历史消息；消息行不保存公开姓名或昵称快照。举报、屏蔽和审核仍使用内部 membership 标识，不受展示变化影响。

### 2.8 `peer_space_messages`

- `id uuid`、`room_id uuid`、`author_room_membership_id uuid`。
- `client_idempotency_key text`：用于安全重试，按作者唯一。
- `body text`：首批建议 1–600 个字符。
- `message_type text`：`student`、`official_notice`；普通值班人员不能伪装为学生。
- `moderation_status text`：`published`、`safety_review`、`revision_required`、`removed_by_author`、`removed_by_moderator`。
- 审核原因、创建、更新与移除时间。

约束要求：

- 作者 room membership 必须与消息 room 一致。
- `safety_review`、`revision_required` 和已移除消息不出现在普通历史 API。
- 不存作者公开姓名、匿名标识、房间昵称、邮箱、学校、cohort、年龄或角色快照；房间身份与学校标签读取时动态解析。
- 幂等键防止断线重试生成重复消息。
- 普通消息不设置自动到期字段或定时清理任务；保留到本人删除、审核移除、账号注销、房间依法清理或其他已告知删除条件发生。

### 2.9 `peer_space_blocks`

- `space_id`、屏蔽发起 membership、被屏蔽 membership 和创建时间。
- 同一年龄空间内双向查询；任一方向命中，双方在共享房间历史与新消息中互相不可见。
- 不能屏蔽自己，不能利用 block API 枚举其他成员。

### 2.10 `peer_space_reports`

- 举报人 room membership、目标 message、类别、限长原因、优先级和状态。
- 目标必须是举报人当前可见的同一房间消息，且不能举报自己。
- 同一举报人对同一消息只允许一个未结举报。
- 2/24/72 小时目标只有在排班能力登记并验收后才能对外承诺。

### 2.11 `peer_space_moderation_actions`

记录消息恢复或移除、成员禁言或移出、房间只读或暂停以及举报结案：目标、前后状态、原因、操作者、职责、时间。不能通过更新原记录覆盖历史。

- 获准内容审核员可以单独执行 1 小时或 24 小时禁言。
- 7 天禁言或移出解忧室先进入第二人复核；等待期间最多执行 24 小时临时限制，复核人与原决定人不能相同。
- 处置结果保留一次 7 天申诉窗口；申诉决定追加新事件，不覆盖原操作。

### 2.12 `peer_space_staff_assignments`

工作人员能力不能从 `profiles.role`、学校成员或专业核验自动推断：

- scope 可限定 space 或 room。
- `capability text`：`room_duty`、`content_moderator`、`safety_duty`、`config_admin`。
- active/revoked 状态、起止时间、授予与撤销审计。

同一人可持有多项能力，但每次 API 请求只按当前操作所需能力授权并记录。

### 2.13 `peer_space_duty_shifts` 与交接事件

- room、当班人员、独立备班/安全联系人、计划与实际起止时间、状态和服务端租约到期时间。
- `staffed_open` 前必须存在 1 名已确认当班人员、1 名独立备班/安全联系人和可用安全升级路径；首批一个当班人员同时最多负责一个开放房间。
- 当班客户端每 30 秒向服务端续租；连续 60 秒无有效心跳触发内部提醒，连续 120 秒没有任何有效当班租约时由服务端原子地把房间改为 `read_only`。
- 本地值班 migration 暂按交接 UX 采用“每个房间最多 1 条 `active` 与 1 条 `handoff_pending` 班次”约束：旧班交接中可由下一班签到；旧班结束或过期时，只有不存在另一条租约、时段、主班与备班授权均有效的班次，才将开放房间转只读。该约束及并发事务仍待数据库级验证，不能据此视为值班系统已验收。
- 签到、续租与开始交接均须重新确认独立备班/安全联系人授权有效；即使备班失权，主班仍可执行结束以便房间收口。未来持续回收优先评估数据库内定时调用现有 `expire_peer_space_duty_leases()`，避免新增公网 service-role 维护入口；仅在隔离项目核对 Cron 可用版本、执行身份、运行记录、失败告警及真实延迟后，另行批准生产调度。定时轮询存在执行间隔，不能仅凭 120 秒租约字段宣称房间恰在第 120 秒变为只读；60 秒提醒还需要独立的可送达渠道和去重/失败处理。
- 交接事件记录未结举报/安全事项的数量与责任转移，不在普通交接摘要复制学生正文。
- 班次缺人、异常结束或升级路径不可用时，自动或人工把房间改为 `read_only` / `paused`。

### 2.14 `peer_space_safety_cases`

高风险消息与普通举报分开：记录 room、消息目标、风险来源、状态、负责人和响应时间。提醒邮件不得包含身份、邮箱或正文；身份查看和现实升级使用独立事件，不用一个布尔值覆盖过程。

### 2.15 `peer_space_identity_access_events`

只记录 active 安全事件下受限的账号—房间身份映射查看：membership、安全事件、申请人、独立复核人、理由、字段范围、授权到期和查看时间。普通房间值班、内容审核和配置管理员没有读取映射接口。

- 常规查看必须由两名具有对应 scope 的 `safety_duty` 人员完成申请与批准，且不能由同一账号兼任两步。
- 存在迫切现实安全风险时，允许一名 `safety_duty` 人员先查看最少字段；必须标记紧急例外并在 24 小时内由第二人复核，逾期自动升级给安全负责人。

### 2.16 学校数据与未来房间边界

- 首期不创建本校房间、成员关系、Realtime topic、申请或候补计数；学校认证不得触发隐藏预建。
- 学校端不获得公共聊天室是否有人使用、参与人数、身份选择或消息活动；只处理原有学校认证和姓名确认职责。
- 不向学校返回成员数、申请数、活跃人数、消息数、主题、时间分布、对外身份、举报或安全事件统计；如未来确需学校级分析，重新进行产品和隐私审批。

## 3. 学校标签解析规则

普通消息 API 的作者展示按以下顺序生成：

1. 读取该作者在目标 room 的当前 `identity_mode`。
2. `anonymous` 返回本成员期匿名短标识；`room_alias` 返回 `alias_code` 的本地化昵称；`verified_name` 仅在所引用姓名确认记录仍为 active、内容未变化且对应学校验证仍有效时返回经验证姓名。任一条件不满足，受控失效流程先把身份模式改为房间昵称，绝不回退到邮箱或 `display_name`。
3. 仅当 room 为 `everyone`、本人 `show_verified_school = true`，且当前仍存在平台认可的有效学校关系时，附加学校公开名称。
4. 任何条件不满足都不返回学校字段，不能回退到 cohort 的合作学校、资料自由文本或历史快照。
5. 身份模式或学校展示关闭后，历史 API 和实时补取立即使用新展示；客户端缓存须同步清除，并提示无法收回他人已看到或截图的信息。
6. 首期不存在本校房间。学校标签只可能出现在公共房间，且完全由学生本人控制。

API 不返回学校关系 ID、院系、班级、专业或学校联系人。学校展示设置的变更只广播“房间显示信息已更新”的最小事件，客户端随后重新拉取可见消息或作者展示缓存。

## 4. 数据库权限与 Realtime RLS

### 4.1 业务表默认 deny-all

每个 `public.peer_space_*` 业务表在同一 migration 中：

1. 启用 RLS。
2. 显式撤销 `anon`、`authenticated` 的业务表权限。
3. 只向可信服务端授予必要权限。
4. 函数默认撤销 `PUBLIC` 执行权限，再按需要最小授权。
5. 不用 `SECURITY DEFINER` 临时绕过权限错误；确有必要的内部函数必须位于非暴露 schema、固定 `search_path`、检查调用者并经专项安全审查。

`peer_space_realtime_access` 按 1.4 节作为最小授权例外：只允许 authenticated SELECT 本人有效 topic，不允许客户端新增、修改或删除。

### 4.2 `realtime.messages` policy

- SELECT：只允许已认证用户接收 `extension = 'broadcast'`、topic 与本人未过期授权桥接行匹配的事件。
- INSERT：不授予普通学生；不允许客户端绕过 Pages API 发送 Broadcast。
- Presence：首批不创建普通学生的 SELECT/INSERT policy。
- 所有频道使用 `private: true`；公共频道设置关闭。

Realtime 授权在连接建立时计算并缓存。撤销 membership 后：

- 所有 Pages API 立即拒绝历史和正文读取。
- 服务端撤销 realtime access 行并发送退出控制事件，客户端取消订阅。
- 恶意客户端即使忽略控制事件，也只能在最长 5 分钟内继续收到不含正文的随机事件 ID；服务端使用不超过 5 分钟的私有 topic epoch、短期授权令牌或自管网关强制换道，不能把前端取消订阅当作安全边界。
- 每次换道重新核验 membership；旧 topic 到期后不再发送任何新事件。API 在整个 5 分钟窗口内仍立即拒绝已经失权的正文请求。

## 5. API 草案

路径均为 Pages Router API；中英文错误文案不能暴露资源是否存在。

### 学生端

| 路径 | 方法 | 用途 | 关键检查 |
|---|---|---|---|
| `/api/peer-space/access` | GET | 返回入口资格、规则版本和最小状态 | 年龄、同意、有效邀请；不返回消息 |
| `/api/peer-space/rules` | POST | 接受规则、激活 membership 并自动加入大家房间 | 当前规则版本与成年人资格；幂等创建 room membership |
| `/api/peer-space/rooms` | GET | 返回公共房间和值班状态 | active membership；只返回 `everyone`，无成员名单或本校占位 |
| `/api/peer-space/rooms/[id]/history` | GET | 游标读取当前可见历史 | room membership 的可见时间区间、状态、屏蔽、审核状态；每页最多 50 条 |
| `/api/peer-space/rooms/[id]/messages` | POST | 发送消息 | 幂等键、房间开放、限速、安全检查后持久化 |
| `/api/peer-space/rooms/[id]/realtime` | GET | 返回私有 topic 和同步游标 | room membership、topic 授权行和过期时间 |
| `/api/peer-space/rooms/[id]/identity` | GET/PATCH | 读取本人房间身份可用状态；更新交流期待、身份模式或学校展示 | 仅本人；经验证姓名须 active 学校名单确认、当前确认版本和二次确认，学校展示只允许大家房间 |
| `/api/peer-space/messages/[id]` | DELETE | 删除本人消息 | 仅作者；保留例外待审批 |
| `/api/peer-space/reports` | GET/POST | 提交并查看本人举报状态 | 仅本人可见消息，不能举报自己 |
| `/api/peer-space/blocks` | GET/POST/DELETE | 管理屏蔽 | 同 age space，禁止枚举和自我屏蔽 |
| `/api/peer-space/membership` | DELETE | 退出解忧室 | 撤销 room 与 realtime access |
| `/api/peer-space/support-resources` | GET | 查看核验资源 | 不需要先发送消息 |

### 工作端

| 路径 | 能力 | 用途 |
|---|---|---|
| `/api/admin/peer-space/config` | `config_admin` | 管理 space、cohort、room 和功能开关 |
| `/api/admin/peer-space/memberships` | `config_admin` | 邀请、暂停、移出；不返回正文 |
| `/api/admin/peer-space/staff` | `config_admin` | 授予、撤销工作人员能力和房间范围 |
| `/api/admin/peer-space/shifts` | `room_duty` / `config_admin` | 排班、签到、备班和交接 |
| `/api/admin/peer-space/moderation` | `content_moderator` | 查看获派举报/待审消息并处理 |
| `/api/admin/peer-space/restrictions` | `content_moderator` | 禁言、移出或解除限制并审计 |
| `/api/admin/peer-space/safety-cases` | `safety_duty` | 处理高风险事件和交接 |
| `/api/admin/peer-space/identity-access` | `safety_duty` | active 安全事件下查看映射并审计 |
| `/api/admin/peer-space/operations` | `config_admin` | 管理房间配置和值班条件；不返回学生使用统计 |
| `/api/admin/schools/[id]/verified-names` | 学校名单管理权限 | 确认、更正或撤销本校学生姓名；不返回任何解忧室 membership、身份选择或活动 |

任何列表限制页大小并使用游标。5xx 只返回用户安全通用错误；服务端日志不记录消息正文、学校展示组合、邮箱、token、OTP 或完整请求体。

## 6. 返回数据最小化

普通房间 API 可以返回：

- room ID、公开名称、范围说明、值班状态和下一次计划开放时间。
- 消息 ID、正文、粗粒度时间、message type，以及当前模式允许的匿名标识、房间昵称或经验证姓名。
- 仅在本人主动展示且当前验证有效时返回学校公开名称。
- 当前用户是否为作者、是否可发送、删除、举报或已屏蔽。只有本人主动打开身份设置时才返回其准确确认姓名和确认版本，用于二次确认；普通大厅与后台状态接口不返回该姓名。

不得返回：

- `user_id`、membership/room membership ID、未获本人公开选择的姓名、未经验证姓名、邮箱、学校关系 ID、院系、班级、专业或出生信息。
- cohort 来源、其他成员列表、精确在线状态、工作人员账号、安全事件或举报人。
- 账号—房间身份映射、内部审核原因、原始数据库行或 Realtime 授权桥接行。

## 7. 安全与实时发布流水线

固定顺序：

1. 认证及年龄、同意、space、room、membership 授权。
2. 房间必须为 `staffed_open` 且有有效当班确认；成员不能处于 muted/removed。
3. 校验幂等键、文字长度、请求体大小和服务端速率限制。
4. 运行共享中英文确定性危机识别。
5. 检查辱骂、威胁、联系方式和明显可识别信息。
6. 普通消息提交成功后发送最小 realtime 事件；高风险消息进入 `safety_review` 且不广播。
7. 人工审核可恢复或移除，但 AI 不能自动改变最终状态。

审核队列故障时采用 fail closed：高风险或不确定消息不公开。Realtime 分发故障不能回滚已经安全保存的普通消息；客户端通过发送响应、游标补齐和重连恢复一致性。

## 8. 删除、退出与保留

技术设计按已确认规则支持：

- 作者删除后立即从普通历史和后续补齐消失。
- 不设置限时撤回窗口；本人可以随时删除。无未结举报或安全事件时，删除正文在 24 小时内物理清理。
- 未删除的普通消息不自动到期，但历史 API 必须按查看者每一段 room membership 的 `visible_from` / `visible_until` 过滤，不允许新成员回看加入前内容。
- 有未结举报或安全事件时，只把必要内容保存在与普通消息读取隔离的 evidence 记录中；结案后最多保留 180 天并告知例外。
- 不含正文、明文邮箱或用户编号的删除、审核、限制、身份查看和成员变更审计最多保留 24 个月；需要依法另行保存的影响评估等合规材料不与聊天审计混为一类。
- 退出后立即撤销 API 与 realtime access；不影响 YouthTempo 其他本人功能。
- 账号注销覆盖 membership、room membership、alias、message、block、report、realtime access 和可识别身份映射；只留下符合上述期限的去标识化审计。
- 删除或匿名化不能破坏必须保留的不可变审核记录；字段最小化方案须经隐私审批。

## 9. 测试矩阵

### 测试身份和房间

- 两个 cohort、两所学校的成年学生 A、B、C；其中 A/B 同校，C 异校。A 有 active 学校姓名确认，B 只有可编辑 `display_name` 与旧邀请姓名，C 没有姓名确认。
- 未受邀成年人、14–17 岁学生、家长、老师、学校负责人和专业支持者。
- 唯一的大家房间及其 read-only/paused 状态；断言不存在 A/B 或 C 的本校房间、membership 与 topic。
- `room_duty`、`content_moderator`、`safety_duty`、`config_admin` 分离账号。

### 允许路径

- 不同 cohort、不同学校的成年成员在大家房间实时收发并读取历史。
- 首次规则确认自动创建大家房间成员期；学校认证、登录刷新或名单更正均不创建本校房间、成员期或 topic。
- 新加入学生只能读取 `visible_from` 之后的消息；退出后重新加入不读取退出期间的消息，断网或退出登录后返回仍保留原 active 成员期历史。
- A、B、C 只能进入同一个公共房间；直接请求构造的 `school` room ID 一律返回通用不可用结果。
- 学校标签默认隐藏；A 开启后仅大家房间显示验证学校，关闭后既往历史也不再返回标签。
- A 在公共房间依次选择匿名、房间昵称和经验证姓名；三种模式切换后当前及历史展示更新，举报和屏蔽关系保持。学校负责人只能确认本校姓名，不能看到 A 是否使用实名或任何房间活动。
- A 的姓名确认进入更正、撤销、过期或学校验证失效后，公共房间立即回退为房间昵称，历史同步更新且其他学生不收到失效通知；重新确认后仍须 A 再次选择实名。
- 交流期待变更、本人删除、双向屏蔽、举报和退出即时反映到历史补齐。
- 值班签到后房间开放，交接完成，缺少备班或升级路径时转为只读。
- 断线重连按游标补齐消息，不重复、不丢失、不恢复已删除或被屏蔽内容。

### 拒绝路径

- 未登录、未受邀、14–17 岁及其他角色读取入口、历史、topic 或发送。
- 客户端伪造 user、age、school、space、room、cohort、identity mode、匿名标识、昵称、经验证姓名来源、学校展示或工作人员能力。
- B/C 用可编辑 `profiles.display_name`、邮箱、Auth metadata、自由文本或缺少独立确认记录的 `school_invites.display_name` 冒充经验证姓名；客户端伪造确认版本或引用他人姓名记录。
- 普通平台配置管理员、值班或审核人员写入姓名确认；学校负责人跨校确认姓名，或通过姓名确认接口读取学生的房间 membership、身份选择或活动。
- 客户端直接向 Realtime Broadcast 发送消息。
- 任意用户订阅构造的本校 room topic；已退出、暂停、移出或 room paused 后继续读写。
- 普通值班、内容审核或配置管理员读取账号映射；学校读取消息、昵称、成员或举报详情。
- authenticated 客户端直接读写业务 `peer_space_*` 表；授权桥接表只能读本人最小 active topic。

### 实时与撤销

- API 写入失败时不广播；安全检查命中时不广播；重复幂等键只产生一条消息。
- Broadcast 丢失、乱序、重复和短暂断线后，API 游标补齐恢复一致状态。
- membership 或学校关系撤销后，新 API 请求立即拒绝；旧 WebSocket 最多 5 分钟只收到无正文随机事件 ID，topic epoch 到期后完全停止接收。
- 房间切为只读/暂停后，前台和直接 API 同时停止发送。
- Realtime 消息速率、并发连接、频道加入限制和退避重连在试点规模下完成容量测试。
- 伪造游标、放大分页大小或直接请求旧 message ID 都不能读取本人任何成员期之外的消息。

### 安全、数据与界面

- 中英文明确危险表达在持久化公开消息和 Broadcast 前进入固定现实支持路径。
- 普通压力、孤独、疲惫、课程讨论和第三人称引用不过度危机化。
- 学校、班级、联系方式和可识别他人信息的修改/复核路径。
- 复合外键、所有外键索引、游标分页、并发禁言/房间关闭和迁移空库重放。
- `zh-CN` / `en` 键结构、320–1440 px、键盘、焦点、屏幕阅读器、断线和失败恢复。
- 真实 iPhone、Android 和微信内置浏览器在开放前完成实时收发、重连、举报、屏蔽、学校展示和退出。

## 10. 实施顺序与审批点

1. **确认修订后的技术设计**：房间模型、Realtime 最小事件、学校展示、排班、保留和撤销上限签字。
2. **成年人授权基础（已本地完成，未应用）**：用 Supabase CLI 创建 migration 并同步 `supabase/schema.sql`；实现业务表 deny-all、严格成年人同意与邀请双重校验、规则确认和公共房间成员期，不创建公开入口。
3. **工作人员授权与值班状态基础（已本地完成，未应用）**：已建立独立 capability、当班/备班、签到、心跳租约、交接和结束的本地 migration 与默认关闭的 API；本地已暂定每房间最多一条 active 和一条 handoff_pending，结束/过期时检查其他有效班次，并统一房间先于班次的锁顺序。房间开房/只读/暂停及安全值班解除暂停的独立迁移和 API 也已本地完成，开房原子核对当前主备班、租约、签到和成年人空间状态；房间迁移尚未执行数据库级验证。真实排班配置、持续租约回收调度和 60 秒提醒仍未完成。没有经验证的有效值班链路时公共房间保持 `closed`，学生消息 API 不得开放。
4. **实现持久化消息与安全处置**：消息、成员期历史、幂等发送、发送前安全、举报、屏蔽、限制、审核和安全事项；先用鉴权 API 完成允许/拒绝验证，不依赖 Realtime 才能保持一致性。
5. **实现私有 Realtime 最小事件**：增加授权桥接、`realtime.messages` RLS、私有频道、游标补齐、断线恢复及 5 分钟失权选型；客户端没有 Broadcast 发送权限。
6. **连接成年人和工作人员界面**：自动加入公共房间、匿名/昵称、交流期待、发送状态、重连、值班和审核工作流；不实现本校房间入口或占位，并保持 feature hidden。姓名确认工作流和专项测试完成前，`verified_name` 与学校展示全局关闭。
7. **独立 E2E 与容量验收**：完成跨 cohort/学校、旧连接撤销、安全、删除、移动端和 Realtime 限制测试。
8. **人工运营审批**：值班人员已到岗，登记开放时段、备班、交接、支持资源、升级路径和暂停负责人。
9. **另行批准邀请制开放及正式迁移**：只开放 `18_plus`；`14_17` 保持 `hidden`。本地 migration 完成不能替代正式数据库应用授权。

任何一步通过都不能自动授权下一步，更不能视为生产开放授权。

## 11. 审批前仍需决定

- 学校名单确认界面的具体操作者分工、批量更正交互和学生异议处理时限，以及首批实际开放时段。
- 5 分钟 Realtime topic epoch、短期令牌或自管网关的实现选型及容量验证。
- 值班人员名单、备班、交接和现实升级联系链。
- 学校安全联系人在何种已签署条件下可以接收可识别事件。
- 规则更新后是否要求重新确认。

## 12. Supabase 技术依据

- [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Subscribing to Database Changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Realtime Limits](https://supabase.com/docs/guides/realtime/limits)
- [Realtime schema locked-down change](https://supabase.com/changelog/realtime-schema-locked-down-against-modification)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Securing your API](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase Changelog](https://supabase.com/changelog)

技术设计批准：技术负责人 ______ / ______；产品负责人 ______ / ______；隐私或安全负责人 ______ / ______；审核运营负责人 ______ / ______。

大学试点与邀请制开放另行批准：大学试点方 ______ / ______；YouthTempo 负责人 ______ / ______。
