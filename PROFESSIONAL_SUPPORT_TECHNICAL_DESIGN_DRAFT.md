# YouthTempo 专业支持技术设计草案

> **2026-09-19 新方向提示：** 本文保留早期决策/设计脉络；与 `ROADMAP.md` 会前版本方向冲突的唯一公共房间、可展示经验证姓名、无普通倾听志愿者或尚未实现的描述均以新路线图和 `docs/TEACHER_REVIEW_READINESS.md` 为准。代码仍处开发分支，正式环境未开放。

状态：**待产品、专业服务、隐私/安全与学校审批；不得据此实施数据库迁移或开放真实学生数据。**

版本：2026-09-13 v0.2

关联决定：PROFESSIONAL_SUPPORT_MODEL_DECISION.md

## 1. 草案目的

本草案把已经讨论的专业支持方向转成可审批的数据库关系、服务端 API 权限和后台入口设计。它不是迁移文件、接口合同或上线批准。

在审批前：

- 不修改 profiles.role、school_members.member_role 或任何现有枚举。
- 不创建数据表、RLS、函数、Storage bucket 或生产配置。
- 不让校内心理老师、申请中的个人专业志愿者、社工或机构人员读取真实学生数据。
- 不把当前规则化的 /referral 结果误认为已经创建人工转介。

## 2. 纳入本轮设计的产品输入

### 2.1 专业人员质量与服务连续性

- 专业人员可以免费注册和提交资料，但“注册成功”不等于“审核通过”，审核通过也不等于自动获得学生访问权。
- 平台团队负责资质材料、身份、经历、面谈/考评、试岗、持续质量和投诉安全复核。
- 一个支持事项应有明确的主要承接人、备援人、接受时间、响应时限、阶段复核和交接记录，避免学生反复从头讲述。
- 不能承诺“找到一定能解决问题的咨询师”，也不能用“一次解决”或“服务次数少”作为质量标准。问题难度、学生意愿和所需时间不同。
- 资源分配可以参考审核等级、连续性、响应、学生反馈、安全记录和当前承载量，但最终由团队人工决定，不建立面向学生的咨询师排行榜。

### 2.2 年龄、家长关系与家庭支持

- 当前试点不要求家长加入，也不创建新的监护关系。
- 18 岁及以上用户不进入家长加入流程；专业支持请求中不显示或保存家长联系偏好。
- 未满 18 岁学生未来可以选择是否邀请家长加入，但须先完成单独的产品、隐私、安全和学校政策审批；未获批准前保持关闭。
- 家长不是所有学生的默认安全联系人。未来未成年人专业支持流程若启用家长选项，必须允许表达“暂不联系家长”“先告诉我再联系”“可以联系”或“不确定”。
- 平台不得把“先告诉家长”写成所有人工支持的固定前置步骤。
- 涉及未成年人告知、同意、紧急升级或可能受到伤害的情形，具体覆盖规则必须由隐私/安全和专业负责人审批；产品不自行承诺绝对保密。
- 家长是否获得任何内容，仍由有效关系、同意依据、数据范围和具体授权共同决定，不能仅凭亲属身份读取。

### 2.3 低门槛倾诉、值班与社区

- 到达平台的学生可能正处于“没有合适的人可以说”的状态，因此平台可以提供独立的专业支持入口，但不能把现有悄悄话信箱改造成专业支持入口。
- 悄悄话信箱继续服务于学生向已关联老师、家长或自己表达不便当面说的话；学生留言不得自动创建专业支持请求或向专业志愿者开放。
- 现有试点值班和高风险升级属于安全运营路径，不等同于建立心理支持关系。
- 平台不设置无专业资质的普通“志愿倾听者”类别。所有以志愿方式提供心理或社会工作支持的个人，都必须通过与其服务范围相匹配的资质和能力审核。
- 面向未成年人的“交友”不设计成陌生人私聊或匹配功能；可保留经过角色可见范围、举报、屏蔽、AI 预审核和人工复核保护的社区互动。
- AI 只做确定性危机识别、内容预筛和队列辅助，不审核专业资质、不单独决定风险处置、不替代人工二次审核。
- 值班权限与专业资质分离：专业人员默认不能看值班队列，值班人员默认也不能看专业转介资料。

### 2.4 SWEET 与不同年龄阶段

- SWEET 不是诊断工具，也不要求先确诊才能使用；是否更适合某些已经意识到问题或进入支持阶段的学生，属于试点需要验证的假设。
- 学生无需先填写 SWEET 才能倾诉、联系值班人员或申请人工支持。
- 当前核心范围仍是 14–18 岁。大学生的作息、饮食、住宿与自主生活逻辑不同，未来若扩展 18–25 岁必须使用独立问卷版本、解释规则、基线和效果指标，不能复用中学生阈值。

### 2.5 试点是否有效

首批试点优先回答三个问题：

1. 学生是否愿意使用，并愿意再次使用。
2. 学生是否感到被听见、知道下一步、获得了持续而安全的真人支持。
3. 学校是否更容易发现需要承接的事项、明确责任人并完成跟进，而不是获得更多学生隐私。

## 3. 已确认的产品模式

2026-09-13 产品方向已确认：YouthTempo 直接招募符合资质的个人专业志愿者，避免把外部机构或第三方咨询平台作为首批服务前提。

本草案建议把目标身份调整为：

- 学生支持老师：学校雇员，负责日常支持。
- 校内心理老师：学校雇员，具有适用的专业资质或岗位审核。
- 平台专业志愿者：由 YouthTempo 直接招募、审核和管理，可包括具备适用资质的心理咨询、社会工作或其他专业人员；每个人只获得审核通过的服务能力。
- 机构归属：作为可选经历或未来合作关系，不是个人免费注册、平台审核或平台派单的必需条件。

产品模式已同步到 `PROFESSIONAL_SUPPORT_MODEL_DECISION.md`。专业服务、隐私/安全、学校责任与技术设计仍须分别审批；在这些审批和实现完成前，平台直接招募或机构合作均不产生学生数据访问权。

## 4. 当前实现基线

当前代码已经具备：

- profiles：账号资料、一个互斥的中文角色和单一 school_id。
- school_members：school_admin / school_support 学校成员关系。
- teacher_student_assignments：支持老师与学生的明确分配。
- professional_verifications：每名用户一条专业身份审核，含机构、岗位、资质和审核状态。
- professional_verification_events：申请、通过、补充、拒绝、撤销、到期审计。
- student_messages：学生写给支持老师、家长、自己或试点值班的留言；不是专业支持沟通或接案关系。
- student_message_duty_actions：值班处理审计。
- community_*：社区可见范围、AI/规则预筛、安全复核、举报、屏蔽和限制。
- pilot_feedback：学生、家长和老师的试点反馈。
- 2026-09-13 本地工作区已将现有专业身份申请中的机构信息改为选填，并创建迁移 `20260912161714_allow_individual_professional_applicants.sql`；该迁移尚未应用到正式 Supabase，不代表完整专业支持模型已经实现。

当前缺口：

- profiles.role 和 school_id 混合表达身份、归属和权限。
- 没有校内心理老师能力。
- 没有独立的专业人员岗位/服务能力、平台归属关系或承载量。
- 没有独立于悄悄话信箱的人工专业支持入口、申请、转介、接案、数据授权、转接和结束关系。
- 现有 /referral 只返回规则化支持路径，不创建真人服务事项。
- 专业核验与移出学校错误耦合；移出学校可能撤销全局专业核验并把角色改回学生。
- 值班权限目前等同平台管理员权限，尚未拆为独立值班能力。
- 反馈表不能表达一次具体支持经历或专业人员的持续质量。

## 5. 设计原则

1. 身份、工作归属、专业资质、值班资格、具体学生访问权五者分离。
2. 所有敏感关系以服务端数据库事实判定，不信任客户端传来的角色、学校、专业类型或授权范围。
3. “审核通过”只进入可用人才池；只有已接受的具体支持事项和未过期的数据授权才能读取该学生的最少内容。
4. 平台直接招募符合资质的个人专业志愿者，外部机构关系保持可选，不依赖第三方咨询平台派单。
5. 一名学生的一个支持事项始终最多有一名 active 主要承接人；换人必须完成显式交接。
6. 支持团队只记录联系、接案、转接、下一步、结束等运营事件；不在 YouthTempo 保存诊断、治疗方案、咨询逐字稿或完整病历。
7. 学生反馈用于团队质量复核，不直接公开给咨询师，不形成公开评分榜，也不由算法自动淘汰人员。
8. 安全升级队列、社区审核队列和普通专业支持队列相互隔离。
9. 所有新敏感表默认不向浏览器 Data API 开放；通过服务端 API 访问，并保留 RLS 作为纵深防护。
10. 任何撤销、到期、离职、暂停、投诉调查或账号停用，都应在下一次服务端请求时立即失权，不依赖 JWT 中可能陈旧的角色。

## 6. 目标关系模型

### 6.1 关系总览

~~~mermaid
erDiagram
  AUTH_USERS ||--|| PROFESSIONAL_PROFILES : applies
  AUTH_USERS ||--o{ PROFESSIONAL_CREDENTIALS : submits
  AUTH_USERS ||--o{ PROFESSIONAL_AFFILIATIONS : works_as
  SCHOOLS ||--o{ PROFESSIONAL_AFFILIATIONS : employs
  PROFESSIONAL_ORGANIZATIONS ||--o{ PROFESSIONAL_AFFILIATIONS : optionally_contains
  AUTH_USERS ||--o{ SUPPORT_REQUESTS : asks_for_help
  SCHOOLS ||--o{ SUPPORT_REQUESTS : optionally_scopes
  SUPPORT_REQUESTS ||--o| SUPPORT_CASES : becomes
  SUPPORT_CASES ||--o{ SUPPORT_CASE_ASSIGNMENTS : staffed_by
  AUTH_USERS ||--o{ SUPPORT_CASE_ASSIGNMENTS : accepts
  SUPPORT_CASE_ASSIGNMENTS ||--o{ SUPPORT_CASE_DATA_GRANTS : authorizes
  SUPPORT_CASES ||--o{ SUPPORT_CASE_EVENTS : audits
  SUPPORT_CASES ||--o| SUPPORT_EXPERIENCE_FEEDBACK : receives
  AUTH_USERS ||--o{ PROFESSIONAL_QUALITY_REVIEWS : reviewed
  AUTH_USERS ||--o{ DUTY_ROSTER_ASSIGNMENTS : serves_duty
  AUTH_USERS ||--o{ PLATFORM_STAFF_PERMISSIONS : receives
~~~

### 6.2 保留的既有表

| 表 | 草案处理 |
|---|---|
| profiles | 继续作为公开资料与兼容显示。长期不得再作为专业权限的唯一来源。 |
| school_members | 继续承载学校负责人和学生支持老师；是否增加 school_counselor 需单独审批。 |
| teacher_student_assignments | 继续用于学生支持老师日常负责关系，不能复用于专业接案。 |
| professional_verifications | 迁移期只读兼容；数据回填到新的申请/资质结构后再决定是否停用。 |
| student_messages | 保留给已关联老师、家长、本人及现有试点安全值班用途；不作为专业支持入口，正式支持事项内沟通不混入普通留言列表。 |
| community_* | 延续现有预筛、人工复核、举报和屏蔽机制，不新增陌生人私聊。 |
| pilot_feedback | 保留整体试点反馈；具体服务体验使用独立表。 |

### 6.3 拟新增表

以下是概念字段，尚不是 SQL。

#### professional_profiles

每名申请人的平台专业档案，一人一条。

- user_id：主键，关联 auth.users。
- applicant_category：counselor / social_worker / other_qualified_professional。
- application_status：draft / submitted / screening / interview / trial / active / needs_changes / rejected / suspended / exited。
- approved_service_scope：只允许团队批准过的能力，例如 listening、school_coordination、professional_consultation。
- public_bio、languages：通过审核后可展示的最少公开信息。
- supervision_required、supervisor_user_id：是否必须由督导复核。
- current_capacity：本人申报；实际在手数量由 assignment 计算。
- created_at、updated_at、activated_at、suspended_at。

约束：

- 不存在无专业资质的普通志愿倾听者类别；每项 approved_service_scope 都必须有审核通过的个人资质和能力依据。
- active 必须有已完成的审核事件和至少一项有效服务能力。
- 公开资料与审核材料分字段返回。

#### professional_credentials

支持一人多份证照、培训、专业经历或身份材料。

- id、user_id。
- credential_kind、issuer、issued_on、expires_on。
- credential_number_hash、credential_number_masked；不在普通 API 返回完整编号。
- evidence_storage_path：存放在私有 Storage bucket，只向指定审核人员生成短期签名链接。
- verification_status：pending / verified / rejected / expired / revoked。
- verified_by、verified_at、review_note。

约束：

- 到期或撤销不删除历史审计。
- 是否足以提供某项服务由审核团队决定，不能仅凭字符串类型自动放行。
- 完整证件编号和材料的加密、密钥托管及保存期限必须在实施前另行批准。

#### professional_review_events

申请、面谈、试岗、补充材料、通过、限制、暂停、恢复和退出的不可变审计。

- id、professional_user_id、action、previous_status、new_status。
- actor_user_id、reason_code、note、created_at。

审核说明只记录做出决定所需的事实，不记录无关个人隐私。

#### professional_organizations

可选的机构资料，不作为平台直接招募的前置条件。

- id、name、organization_type、verification_status、status。
- contact_user_id、service_scope、verified_by、verified_at。

首批若不开展机构合作，可暂不实现该表和相关界面。

#### professional_affiliations

表达一个专业人员在哪里以什么身份提供服务。

- id、professional_user_id。
- affiliation_type：platform_direct / school_employee / organization_member。
- school_id 或 organization_id；platform_direct 时两者均为空。
- job_category：school_counselor / counselor / social_worker / other_qualified_professional。
- status：pending / active / paused / ended。
- starts_at、ends_at、approved_by、created_at。

约束：

- school_employee 必须有且只有 school_id。
- organization_member 必须有且只有 organization_id。
- platform_direct 不得附带 school_id 或 organization_id。
- 归属结束不自动删除仍有效的个人资质，但必须立即停止基于该归属的新接案资格。

#### support_requests

学生主动求助或学校在授权范围内提出的人工支持请求。

- id、student_user_id、school_id（可空）。
- source_type：student_self / school_referral / safety_handoff。
- requested_service：professional_listening / counseling_support / social_work_support / unsure；所有服务均由通过对应能力审核的专业人员承接。
- preferred_contact_channel。
- guardian_contact_preference：仅未来未满 18 岁流程可用；可取 do_not_contact_without_telling_me / tell_me_first / may_contact / unsure。18 岁及以上不显示、不保存。
- identity_display_preference：real_name / pseudonym_to_supporter。
- structured_reason_codes；student_note 限长且不要求填写。
- status：submitted / triaged / waiting_assignment / offered / accepted / withdrawn / closed。
- consent_basis、policy_version、submitted_at、withdrawn_at。

说明：

- 对承接人使用化名不等于对平台匿名；平台仍需知道账号身份并执行安全和权限检查。
- guardian_contact_preference 是学生偏好，不得被解释为对法定安全责任的绝对否决；覆盖条件必须另行签署。
- 不要求先完成 SWEET。

#### support_cases

进入人工承接后的连续支持事项。

- id、request_id、student_user_id、school_id（可空）。
- service_type、case_status：proposed / active / transfer_pending / paused / completed / withdrawn / closed_for_safety_review。
- primary_assignment_id。
- response_due_at、review_due_at、access_ends_at。
- consent_basis、policy_version、created_by、created_at、closed_at。

约束：

- 一个 request 最多生成一个 case。
- 一个 active case 最多一个 active primary assignment。
- case 关闭、撤回或到期后，所有数据授权同步撤销。

#### support_case_assignments

记录主要承接人、备援人和显式接案。

- id、case_id、professional_user_id。
- assignment_role：primary / backup / supervisor。
- status：offered / accepted / declined / active / handoff_pending / ended / revoked。
- offered_at、respond_by、accepted_at、started_at、ended_at。
- end_reason、assigned_by。

连续性规则：

- 只有 accepted 后才能创建数据授权。
- 主要承接人离开前先指定新承接人并完成 handoff_completed 事件；紧急停权例外，由值班/质量团队接管。
- 拒绝、超时或当前承载量已满时回到 waiting_assignment，不把责任留在无人处理状态。

#### support_case_data_grants

把“被分配”与“能看什么”分开。

- id、case_assignment_id、student_user_id。
- scope_key：request_summary / case_messages / selected_sweet_snapshot / contact_details。
- source_record_ids：仅在学生明确选择某些记录时保存对应 ID。
- granted_by、consent_basis、granted_at、expires_at、revoked_at、revocation_reason。

默认范围：

- professional_listening：request_summary + case_messages；无 SWEET、家长资料或学校全量记录，且仍须由获准该服务范围的专业人员承接。
- professional_support：request_summary + case_messages；selected_sweet_snapshot 仅在学生明确选择并满足适用同意后增加。
- contact_details 默认关闭；确有线下/外部联络需要时单独授权。

#### support_case_events

只保存运营协作事实。

- id、case_id、actor_user_id。
- event_type：created / offered / accepted / contact_attempted / contact_confirmed / review_due / transfer_requested / handoff_completed / completed / withdrawn / expired / safety_escalated。
- reason_code、short_operational_note、created_at。

禁止写入：

- 诊断、症状推断、治疗方案、咨询逐字稿、详细家庭冲突或完整临床记录。

#### support_experience_feedback

学生在阶段复核或结束后提交，每个 case 最多一条当前版本。

- id、case_id、student_user_id。
- felt_heard、continuity、next_step_clarity、felt_safe、would_seek_help_again：1–5 或“不想回答”。
- concern_flag、optional_comment、may_contact_about_feedback。
- hidden_from_assignee_at、created_at、updated_at。

规则：

- 原始反馈只向质量审核团队开放；承接人只看达到最小样本量后的去标识汇总和改进建议。
- safety concern 或投诉进入人工复核，但不能自动把学生原文发送给被投诉人。
- 不收集“是否被治好”或“几次解决”作为单一评分。

#### professional_quality_reviews

平台团队对人员进行入驻后持续考评。

- id、professional_user_id、review_period_start、review_period_end。
- evidence_summary：结构化计数，不复制学生正文。
- decision：retain / coaching_required / restrict_scope / pause_new_cases / suspend / exit。
- decision_note、reviewed_by、reviewed_at、next_review_at。

建议考评维度：

- 资质和身份是否持续有效。
- 接案响应、失约、主动退出和交接完成率。
- 学生是否感到被听见、安全、知道下一步。
- 投诉、安全事件及督导复核。
- 是否遵守边界、记录最小化和隐私要求。
- 当前承载量与服务连续性。

考评不得完全自动化，也不得只按平均星级淘汰新人或承接困难事项的人。

#### duty_roster_assignments

独立管理值班权限。

- id、user_id、duty_role：listener / duty_lead / safety_reviewer。
- starts_at、ends_at、status、approved_by。
- scope：pilot_general / school_id。

只有当前时间处于 active 排班且具有对应 duty_role 的账号才能读取相应队列。

#### platform_staff_permissions

把平台后台能力从“所有平台管理员都能看所有内容”逐步拆开。

- id、user_id。
- permission_key：professional_review / quality_review / duty_queue / safety_review / school_operations。
- status、granted_by、starts_at、ends_at。

现有 admin_roles 在迁移期作为超级管理员兼容入口；日常审核人员应使用最小权限。

## 7. 关键状态机

### 7.1 专业人员

draft → submitted → screening → interview → trial → active

任一审核阶段可以进入 needs_changes 或 rejected；active 可以进入 suspended、exited，整改后可由人工复核恢复 active。

### 7.2 支持请求与接案

submitted → triaged → waiting_assignment → offered → accepted → active

active 可以进入 transfer_pending、paused、completed、withdrawn 或 closed_for_safety_review。

关键要求：

- offered 不开放学生数据，只展示接案判断所需的去标识最少信息。
- accepted 与数据授权必须在同一服务端事务中创建。
- withdrawn、expired、suspended、affiliation ended 必须在同一事务中撤销授权并写审计。
- safety_escalated 进入独立安全流程，不自动把完整内容暴露给普通专业人员。

## 8. 服务端 API 草案

所有接口沿用 Next.js Pages Router，先验证 Supabase session，再从数据库加载实时权限。浏览器不能直接写入下述敏感表。

### 8.1 申请人和专业人员接口

| 接口 | 方法 | 调用者 | 服务端边界 |
|---|---|---|---|
| /api/professional/profile | GET, POST | 登录用户本人 | 只读写本人申请；不能自行设 active、服务范围或审核结论。 |
| /api/professional/credentials | GET, POST, DELETE | 本人 | 只管理本人未锁定材料；active 材料更新进入重新审核。 |
| /api/professional/availability | GET, PATCH | active 人员本人 | 只申报可接案状态和容量；不能修改实际在手数量。 |
| /api/professional/cases | GET | active 且有有效 assignment | 仅返回本人 accepted / active case 和有效数据 scope。 |
| /api/professional/cases/[caseId]/decision | POST | 收到 offer 的本人 | 只能接受或拒绝自己的 offer；接受时服务端重新检查资质、归属、容量和期限。 |
| /api/professional/cases/[caseId]/events | GET, POST | 该 case 的 active 承接人 | 只读本 case，写入允许的运营事件；拒绝临床记录字段。 |

### 8.2 学生接口

| 接口 | 方法 | 调用者 | 服务端边界 |
|---|---|---|---|
| /api/support/requests | GET, POST | 学生本人 | 只创建和查看本人请求；不接受客户端 school_id、风险等级或 assignee。 |
| /api/support/requests/[requestId] | PATCH | 学生本人 | 只允许撤回、更新联系偏好；已进入安全流程时返回清晰说明并由人工处理。 |
| /api/support/cases/[caseId] | GET | 学生本人 | 查看本人事项状态、承接人公开资料和已授权范围。 |
| /api/support/cases/[caseId]/shared-records | POST, DELETE | 学生本人 | 明确选择或撤回要分享的 SWEET 记录；服务端校验记录所有权与同意。 |
| /api/support/cases/[caseId]/feedback | GET, PUT | 学生本人 | 只提交本人反馈；承接人不能通过此接口读取原始内容。 |

### 8.3 学校接口

| 接口 | 方法 | 调用者 | 服务端边界 |
|---|---|---|---|
| /api/school/support-network | GET | 本校负责人 | 只看本校学生支持老师、校内心理老师及岗位状态，不返回完整资质材料。 |
| /api/school/support-referrals | GET, POST | 本校负责人；被分配的学生支持老师 | 负责人限本校；支持老师只能为 assigned student 提出请求，提出不自动授权。 |
| /api/school/support-referrals/[requestId] | PATCH | 本校负责人或获授权的校内心理老师 | 只更新允许的学校协作状态；不能为外部人员授予全校访问。 |
| /api/school/counselor-affiliations | GET, POST, DELETE | 本校负责人 | 只确认校内岗位；平台专业团队仍单独确认资质和服务能力。 |

学校负责人可以看事项负责人、时限和进度状态，但默认不能看学生倾诉正文、原始专业反馈或咨询内容。是否允许查看 SWEET 仍按现行学校政策和后续签署决定处理，不因本设计自动扩大。

### 8.4 平台审核和运营接口

| 接口 | 方法 | 所需能力 | 服务端边界 |
|---|---|---|---|
| /api/admin/professionals | GET | professional_review | 申请队列；按字段分级隐藏证件和敏感材料。 |
| /api/admin/professionals/[userId]/review | POST | professional_review | 面谈、试岗、通过、补充、拒绝；所有变更写不可变事件。 |
| /api/admin/professionals/[userId]/quality-review | POST | quality_review | 人工质量决定；不能由平均分自动触发停用。 |
| /api/admin/professional-affiliations | GET, POST, PATCH | professional_review 或 school_operations | 平台只确认平台招募/机构关系；学校只确认本校岗位。 |
| /api/admin/support-queue | GET | duty_queue | 返回待分配最少摘要，不返回未授权历史记录。 |
| /api/admin/support-cases/[caseId]/assign | POST | duty_queue | 校验服务能力、状态、容量和冲突后发 offer，不立即开放数据。 |
| /api/admin/support-cases/[caseId]/transfer | POST | duty_queue | 显式交接；紧急停权时先撤销旧访问，再由负责人接管。 |
| /api/admin/duty-roster | GET, POST, PATCH | school_operations 或超级管理员 | 管理独立值班资格和时段。 |
| /api/admin/support-feedback | GET | quality_review | 查看受限原始反馈或去标识汇总；不得用于公开排行。 |

### 8.5 安全和社区接口

- 继续复用现有确定性危机识别、message safety、community safety_review 和人工审核记录。
- 普通专业支持接口不能把 safety_review 改为 published、sent 或 resolved。
- AI 预筛只能返回辅助标签或进入 safety_review；人工处置结果必须由具有 safety_review 权限的人员提交。
- 任何安全提醒邮件继续只包含事件编号、时间和后台链接，不包含学生身份、正文或资质材料。

## 9. API 统一鉴权顺序

每个敏感请求必须按以下顺序执行：

1. 使用 Supabase Auth 验证 bearer token 对应的真实用户。
2. 从数据库读取账号状态、平台能力、学校关系、专业档案、资质、归属和值班排班。
3. 若访问学生数据，再验证 support case、accepted assignment、未过期 data grant 和 scope_key。
4. 对学生本人写入，验证记录所有权和有效同意；不接受客户端提交的 owner、school、reviewer 或 assignee。
5. 对状态变化使用单一事务或受控数据库函数，同时写事件和撤销相关访问。
6. 返回字段级最小响应；5xx 不返回数据库、约束或 provider 原始错误。
7. 记录不含正文、邮箱、token、OTP、证件号或咨询内容的操作元数据。

建议新增服务端 helper：

- requirePlatformPermission(permissionKey)
- getProfessionalContext(userId)
- requireActiveCaseAssignment(userId, caseId, scopeKey)
- canCreateSchoolReferral(actorId, studentId, schoolId)
- revokeCaseAccess(caseId, reason)

这些 helper 不能依赖 user_metadata 或客户端传来的 role。

## 10. 数据访问矩阵

| 数据/能力 | 学生本人 | 学生支持老师 | 校内心理老师 | 平台专业人员 | 值班人员 | 学校负责人 | 专业审核 | 质量审核 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 本人支持请求 | 全部 | assigned student 的状态摘要 | accepted case | accepted case | 待分配最少摘要 | 本校状态摘要 | 无 | 去标识统计 |
| 专业支持沟通 | 本人 | 默认无；悄悄话信箱仍按直接收件规则独立处理 | 有 case_messages grant | 有 case_messages grant | 仅对应值班/安全事项 | 默认无 | 无 | 投诉复核时受控 |
| SWEET 历史 | 本人 | 现行 assigned 权限 | 仅选中 snapshot | 仅选中 snapshot | 无 | 现行政策，不因本设计扩大 | 无 | 无 |
| 家长信息 | 本人可见范围 | 默认无 | 默认无 | 默认无 | 紧急流程最少字段 | 关系状态，不看私密正文 | 无 | 无 |
| 专业资质原件 | 无 | 无 | 本人材料 | 本人材料 | 无 | 只看“已核验/到期” | 指定审核人 | 必要时只读 |
| 原始学生服务反馈 | 本人 | 无 | 不可看本人被评内容 | 不可看本人被评内容 | 无 | 无 | 无 | 受控可见 |
| 值班队列 | 无 | 无 | 无默认 | 无默认 | 当前排班范围 | 无默认 | 无 | 无 |
| 社区人工审核 | 举报/屏蔽 | 无默认 | 无默认 | 无默认 | 无默认 | 本校安全范围按政策 | 无 | safety_review 能力另授 |

## 11. 后台与前台入口草案

### 11.1 专业人员个人入口

建议路由：

- /professional/apply：免费注册后的申请、材料和进度。
- /professional/workbench：接案 offer、在手事项、复核期限和容量。
- /professional/cases/[caseId]：仅显示获授权的数据、运营事件和交接动作。

界面必须始终显示：

- 当前身份类别和允许的服务范围。
- 资质、归属、值班和学生访问权是分开的状态。
- 不能进行诊断或把完整病历写入平台。
- 学生姓名显示规则和本 case 的访问到期时间。

### 11.2 平台管理台

不继续把所有内容堆在现有 /admin 单页。建议分为：

- /admin/professionals：申请审核、资质材料、面谈/试岗、能力范围和暂停/退出。
- /admin/professional-quality：周期考评、学生反馈、投诉、安全复核和督导事项。
- /admin/support-operations：待分配、offer 超时、容量、连续性、转接和无人承接预警。
- /admin/duty-roster：值班人员、班次、替补和失联升级。

现有 ProfessionalVerificationQueue 可作为迁移期入口，但不得直接扩展成学生事项查看器。

### 11.3 学校工作台

建议新增“支持网络”区域：

- 学生日常支持：学生支持老师与负责学生。
- 校内专业支持：校内心理老师的岗位、平台核验状态、可接案状态。
- 支持转介：只看本校授权范围内的请求状态、承接人和截止时间。

“成员管理”不再提供笼统的“专业支持者”选项。学校负责人确认校内岗位，平台审核团队确认专业资质，二者都不能单独产生学生访问权。

### 11.4 学生入口

建议把 /referral 保留为规则化“帮我选下一步”，另设清晰的真人入口：

- 寻求专业人士支持：进入独立说明页，了解服务边界和隐私范围后，由学生主动创建 support_request。
- 给老师或家长留言：继续进入现有悄悄话信箱，不创建 support_request，不向专业人员开放。
- 社区：公开/角色范围互动，不提供陌生人私聊交友。

专业支持入口只收集承接所需的最少信息，并允许选择实名或对承接人使用化名；不要求先完成 SWEET。18 岁及以上不出现家长选项；未满 18 岁的家长选项在后续政策批准前保持关闭。

## 12. Supabase 与数据安全设计

### 12.1 Data API 和 RLS

- 所有拟新增敏感表启用 RLS。
- 默认 revoke anon, authenticated 的表权限，仅 service_role 可通过服务端 API 访问。
- 若未来确需浏览器直读本人数据，必须显式 GRANT 所需操作并同时建立 owner / relationship / grant predicate；TO authenticated 本身不是授权边界。
- UPDATE policy 同时包含 USING 和 WITH CHECK。
- 不通过 public SECURITY DEFINER 函数绕过权限问题；确需特权事务时使用不暴露的受控函数、明确 revoke/grant，并复核调用者。
- 新表是否暴露到 Data API 与 RLS 是两个独立问题，迁移验收必须分别检查。

### 12.2 Storage

- 专业证明材料放在独立私有 bucket，不与社区或头像资源混用。
- 文件路径不使用邮箱、姓名、证件号。
- 只有 professional_review 权限能申请短期签名 URL。
- 上传前检查 MIME、大小、扩展名和恶意内容；下载、审核和删除写审计。
- 保存期限、申请被拒后的删除时点、加密方式和备份范围必须在实施前签署。

### 12.3 数据最小化

- 独立 professional support request 允许只选结构化原因，不强迫学生写长文本；不从悄悄话信箱自动生成。
- case event 只记录运营进度，不复制聊天正文。
- 质量统计保存结构化指标；原始学生反馈严格限权。
- 运营看板按学校或服务类型聚合，设置最小样本量，避免反推出单个学生。
- “使用率”不等于“健康程度”，不按未打卡、晚睡或外卖习惯给大学生贴风险标签。

## 13. 迁移与兼容计划

本节只描述顺序，不授权实施。

### 阶段 A：审批

- 产品已确认首批采用平台直接招募符合资质的个人专业志愿者，机构合作为未来可选项。
- 专业负责人确认人员类别、资质清单、面谈/试岗、督导和持续考评。
- 隐私/安全负责人确认未成年人告知、家长联系偏好、覆盖条件、数据范围、证件材料和服务反馈保存期限。
- 学校确认校内心理老师岗位、转介责任、值班边界和线下应急路径。

### 阶段 B：数据库迁移设计

- 使用 Supabase CLI 创建迁移文件，不手写迁移文件名。
- 先新增结构，不删除或改写现有表。
- 从 professional_verifications 回填 professional_profiles、credentials 和 review events。
- 旧 profiles.role = 专业支持者仅作为兼容显示，不再产生新权限。
- 修复学校移出逻辑：只结束学校 affiliation 和相关 case grant，不撤销独立专业资质，不静默改成学生。
- 同步更新 supabase/schema.sql，并运行数据库 advisors 与权限测试。

### 阶段 C：双写和只读验证

- 新申请先写新结构；旧审核队列临时读取兼容 projection。
- 用虚拟账号核对旧申请、到期、撤销和学校退出。
- 完成数据对账后再停止旧表写入；是否删除旧表另行审批。

### 阶段 D：API 和界面

- 先实现鉴权 helper 和拒绝路径，再实现后台和学生入口。
- 先开放申请/审核，不开放真实学生接案。
- 完成虚拟转介全生命周期后，才讨论小范围真实试点授权。

## 14. 验证与测试要求

### 14.1 数据库

- 每张新表确认 RLS 已启用、anon/authenticated 无意外表权限。
- 检查跨校、跨 case、跨专业人员、过期、撤回、暂停和旧 session 的拒绝路径。
- 验证 active case 只有一个 primary assignment。
- 验证 accepted 和 grant 原子创建，关闭/撤回/到期和 revoke 原子执行。
- 验证资质到期停止新接案，并按已进行事项的安全交接规则处理。
- 运行 Supabase security/performance advisors。

### 14.2 API

- 每个接口覆盖 401、403、404、409、422 和安全 5xx。
- 客户端伪造 role、schoolId、studentId、assigneeId、scopeKey、review status 均被拒绝。
- 未提供足够资质依据的申请人请求任何专业服务 scope 被拒绝；已审核人员请求超出本人获准范围的能力也被拒绝。
- 普通专业人员请求值班、社区安全审核、其他 case 或完整 SWEET 被拒绝。
- 学生撤回共享记录后，旧 session 下一次请求立即失权。

### 14.3 端到端

- 申请 → 补充 → 面谈/试岗 → 通过 → 进入人才池。
- 学生主动请求 → 人工分流 → offer → 接受 → 最小授权 → 反馈 → 结束。
- offer 拒绝、超时、满载、临时暂停和重新分配。
- 主要承接人离职或停权时的连续性交接。
- 学生选择暂不联系家长的普通路径及经批准的安全覆盖路径。
- 两所虚拟学校、两个专业人员和两个学生的完整交叉拒绝矩阵。
- 中英文、键盘、焦点、移动端、微信内置浏览器人工验收。

所有测试使用独立 E2E Supabase 项目，不使用正式项目或恢复演练项目。

## 15. 试点指标

### 学生是否愿意使用

- 支持入口浏览 → 提交请求的比例。
- 提交后主动撤回率及原因分类。
- 首次使用后愿意再次使用的比例。
- 学生选择哪种入口：老师/家长留言、独立专业支持、社区或自行整理；安全值班只作为运营升级路径单独统计。

### 学生是否获得帮助

- 首次响应时长、offer 接受时长、无人承接率。
- 学生评分中的 felt_heard、continuity、next_step_clarity、felt_safe、would_seek_help_again。
- 中途换人次数、无交接换人次数和学生重复讲述投诉。
- 安全投诉、隐私投诉及处理时长。

这些指标衡量体验和承接质量，不声称诊断改善、治愈或因果疗效。

### 是否帮助学校解决运营问题

- 学校是否能看到每个授权事项的负责人、下一步和截止时间。
- 需要跟进但无人负责的事项数量。
- 超时、转接、结束和线下升级是否有清楚记录。
- 学校负责人认为流程是否减少失联和职责不清。

学校不因统计需要获得更多学生正文或专业反馈。

## 16. 首批建议范围

为降低未成年人隐私、安全和专业责任风险，首批建议只做：

- 专业人员免费申请和团队严格审核。
- 平台直接招募的人才池，先区分具备适用资质的咨询、社会工作和其他专业人员，并逐人批准服务范围。
- 独立于悄悄话信箱的学生低门槛专业支持请求。
- 一名主要承接人、备援和显式交接。
- 最小 case 状态、消息范围和结束反馈。
- 值班与专业接案权限分离。
- 既有社区 AI 预筛 + 人工二次审核。

首批不做：

- 陌生人私聊式交友。
- 咨询师公开星级榜或自动派给“分数最高”的人。
- 平台内诊断、治疗计划、完整咨询记录或病历。
- 大学生版本直接复用中学生 SWEET。
- 未经审批的机构合作、学校全量数据共享或真实学生专业接案。

## 17. 待审批决定

以下全部确认后，才进入迁移设计：

- [x] 产品确认首批采用“平台直接招募符合资质的个人专业志愿者”，机构合作仅为未来可选项。
- [x] 产品确认不设置无专业资质的普通志愿倾听者；学生支持老师、校内心理老师和不同类别个人专业志愿者的服务能力分别审核。
- [ ] 免费注册后的审核阶段、通过标准、试岗、督导、暂停和退出机制。
- [ ] 学生反馈维度，以及原始反馈只对质量团队可见。
- [ ] 一个 case 一名主要承接人、备援与强制交接规则。
- [ ] 学生无需先做 SWEET 就能求助。
- [x] 产品确认当前试点不要求家长加入；18 岁及以上不建立家长关系，未满 18 岁家长可选加入留待后续审批。
- [ ] 未来未成年人专业支持中的家长联系偏好和安全覆盖规则另行签署。
- [ ] 首批不提供陌生人私聊式“交友”。
- [ ] 专业人员只能看 request summary、case messages 和学生明确选择的 SWEET snapshot。
- [ ] 平台不保存诊断、治疗计划、逐字稿或完整临床病历。
- [ ] 值班、专业审核、质量审核、社区安全审核分别授权。
- [ ] 首批试点成功以学生愿意使用、感到获得帮助、学校承接更清楚为核心。
- [x] 产品确认悄悄话信箱只用于学生向老师、家长或自己留言，不作为专业支持入口；专业支持另设独立流程。

## 18. 实施批准门

即使本草案内容获产品认可，也不等于批准数据库变更。进入实施前还需一份明确指令，至少写明：

- 批准创建哪些表和迁移。
- 是否批准私有 Storage bucket 和证件材料处理。
- 使用独立 E2E 项目的范围。
- 是否仅实现申请/审核，还是也实现虚拟转介。
- 任何正式 Supabase 或生产操作都需要再次单独授权。

## 19. 技术参考

- Supabase Row Level Security：<https://supabase.com/docs/guides/database/postgres/row-level-security>
- Supabase Securing your API：<https://supabase.com/docs/guides/api/securing-your-api>
- Supabase Changelog：<https://supabase.com/changelog>

2026-09-12 的平台变更核对提示：Supabase 已宣布新表不再自动暴露到 Data/GraphQL API，并计划在 2026-10-30 对所有项目执行；因此实施时必须显式核对 Data API grants 和 RLS，不能假设新表创建后即安全或可用。
