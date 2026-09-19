# 会前开发工作区基线与分类

记录时间：2026-09-19；基线 `b11739d222679bfae5715360a7d3721e98e9dc21`，开始时 `main` 与 `origin/main` 一致，34 个 tracked 修改、47 个未跟踪文件、0 个 staged，stash 为空。`/private/tmp/youthtempo-phase0-20260919-213831` 保存状态、分支、远端、80 条历史、diff、未跟踪清单、迁移清单、基线构建/测试、脱敏 patch 及 68 个可安全复制的代码/文档文件。备份权限为仅当前用户；初步扫描未发现凭据。`deliverables/` 下 13 份可能含私人合作/学生材料的文档和图片没有复制、阅读、提交或删除，仍留在原工作区。初始未跟踪 migration 的清单见备份；正式项目未连接。本文件不包含个人数据。

| 类别 | 原工作区代表文件 | 本轮处理 |
|---|---|---|
| 家长/监护政策 | `lib/guardianAccessPolicy.ts`、`lib/studentConsent.ts`、账户/学校 API、政策文档 | 保留既有应用层关闭，并新增 RLS/历史关系注销边界 |
| 成年人路径 | `views/account/page.tsx`、`views/for-young-adults/page.tsx`、`tests/student-age-guidance.spec.ts` | 在账户工作台分流，接入花园、聊天室与暗上线咨询 |
| 专业人员申请 | `lib/professionalVerification.ts`、申请/审核组件、个人申请 migration | 保留资质核验；新增四类支持申请与具体事项授权域 |
| 解忧室/聊天室 | `lib/peerSpaceAccess.ts`、`lib/peerSpaceStaff.ts`、两层基础迁移、预览视图/测试与设计稿 | 保留准入/值班基础；真实聊天室与审核替代预览路由；旧预览组件保留为未使用文件 |
| 国际化 | `locales/zh-CN.json`、`locales/en.json`、公开成年页、账户页 | 新键成对加入，中文原意保持；旧字典改动保留 |
| 安全和权限 | 学校名单、关系分配、消息、账户导出/注销、RLS 基础 | 按当前无家长政策收紧；支持及聊天采用服务端事实校验 |
| 测试 | 原有 guardian、peer space、professional、school 与 age spec | 更新过时断言，新增花园/权限测试；登录态和 DB 测试仍待隔离环境 |
| 文档 | `ROADMAP.md`、五份试点治理文档、专业/解忧室设计稿、项目概览 | 记录新方向覆盖旧决策，补会前核对与部署手册 |
| 本轮无关 | `deliverables/` 的 13 份 docx/txt/png；`.gitignore` 原有修改；`PROJECT_MASTER_OVERVIEW.md`、`YOUTHTEMPO_PROJECT_OVERVIEW.md` 的历史内容 | 原样保留，未借机重构；私人文件不纳入功能分支 |

基线 `pnpm typecheck` 和 `pnpm build` 通过；全量浏览器回归在改动前 443 通过、59 跳过、2 个相同旧账户页断言失败。该失败已在本轮调整为现有实现的断言。所有登录态 fixture 测试在缺少隔离环境凭据时跳过，不能视为权限通过。
