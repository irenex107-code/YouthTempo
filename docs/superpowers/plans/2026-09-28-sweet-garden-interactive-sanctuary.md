# SWEET 花园互动庭院实施计划

日期：2026-09-28

## 目标

在现有 `/garden` 上实现经确认的个人疗愈庭院：保留最初小草稿的构图与治愈插画感，加入每日一次轻照料、自由探索、固定位置布置和可选纪念物；成长按上海日历参与日去重，花园不显示或调用 AI 内容，并保持本人私有、双语、移动与减少动态效果可用。

## 架构摘要

现有轻量记录与完整 SWEET 继续作为参与事实。`lib/tempoGarden.ts` 负责把两类记录转换为去重参与日、主植物阶段、场景等级和解锁目录。新的照料、布置和纪念物通过窄 API 保存为本人私有状态；浏览器不能提交用户 ID、成长等级或解锁状态。页面拆成场景、操作栏和三个底部抽屉，持久化状态只在服务端确认后更新。

技术栈保持 Next.js 16 Pages Router、React 19、严格 TypeScript、Supabase PostgreSQL、Tailwind/CSS 与 Playwright，不引入 App Router、Server Actions、RSC 或新的运行时依赖。

## 开始前的硬闸门

- 已确认设计文档：`docs/superpowers/specs/2026-09-26-sweet-garden-interactive-sanctuary-design.md`。
- 数据库任务开始前，必须再次获得“允许创建本地迁移并修改 schema”的明确确认；设计批准不等于数据库批准。
- 正式 Supabase 应用迁移、正式部署和真实账号操作分别需要单独授权。
- 正式场景资产接入前，需取得一套以最初小草稿为基准、无 emoji、统一风格且通过用户视觉确认的插画文件。不得用临时几何图形作为最终交付。
- 保留当前工作区中的无关未提交文件，不加入本计划的提交。

## 任务 1：先锁定成长领域规则

**文件**

- 修改：`tests/tempo-garden.spec.ts`
- 修改：`lib/tempoGarden.ts`

**步骤**

1. 在 `tests/tempo-garden.spec.ts` 增加失败测试：同一上海日历日内的多条轻量记录、多条 SWEET 记录和两类记录重叠时，只算一个参与日。
2. 增加边界测试：UTC 跨日映射到上海日期、跨周、跨月、未来时间不计入当前统计。
3. 增加节点测试：参与日 0、1、3、7、14、28 分别返回预期主植物阶段、场景等级和解锁位置。
4. 增加等价性测试：四种感受值与不同 SWEET 内容不会改变任何成长结果。
5. 运行：

   ```bash
   pnpm exec playwright test tests/tempo-garden.spec.ts --project=desktop-chromium -g "参与日|成长节点|答案好坏"
   ```

   预期：新测试先失败。
6. 在 `lib/tempoGarden.ts` 增加纯函数：去重参与日、场景等级、当日参与判断和解锁集合。保留 `seed | sprout | leaves | bloom` 主植物合同。
7. 再次运行同一命令，预期通过。
8. 提交：

   ```bash
   git add lib/tempoGarden.ts tests/tempo-garden.spec.ts
   git commit -m "Derive garden growth from participation days"
   ```

## 任务 2：移除花园中的 AI 数据路径

**文件**

- 修改：`tests/tempo-garden.spec.ts`
- 修改：`pages/api/garden.ts`
- 修改：`lib/cloudRecords.ts`
- 修改：`locales/zh-CN.json`
- 修改：`locales/en.json`

**步骤**

1. 增加失败测试，断言花园 API 不再选择 `sweet_records.summary`，客户端类型和页面不再包含 `recentRhythm`，花园代码不引用 `/api/ai/`。
2. 修改 `/api/garden` 的 SWEET 查询，只读取 `created_at`。
3. 从 `TempoGardenData`、API 响应和花园页面移除 `recentRhythm`。
4. 删除 `garden.rhythm` 中英文键；保持两份字典结构一致。
5. 运行花园专项测试与键结构检查：

   ```bash
   pnpm exec playwright test tests/tempo-garden.spec.ts --project=desktop-chromium
   pnpm typecheck
   ```

6. 提交：

   ```bash
   git add pages/api/garden.ts lib/cloudRecords.ts locales/zh-CN.json locales/en.json tests/tempo-garden.spec.ts
   git commit -m "Remove AI content from SWEET Garden"
   ```

## 任务 3：建立稳定的庭院目录合同

**文件**

- 新增：`lib/gardenCatalog.ts`
- 新增：`tests/garden-catalog.spec.ts`

**步骤**

1. 先写测试定义允许的照料动作、四个固定位置、八个首发物件和三种纪念物，并验证每个键都有唯一解锁日。
2. 测试禁止目录值包含显示文案、emoji、自由文本或用户 ID。
3. 实现只含稳定内部键和解锁规则的 `gardenCatalog`；显示文案留给翻译字典。
4. 运行：

   ```bash
   pnpm exec playwright test tests/garden-catalog.spec.ts --project=desktop-chromium
   pnpm typecheck
   ```

5. 提交：

   ```bash
   git add lib/gardenCatalog.ts tests/garden-catalog.spec.ts
   git commit -m "Define SWEET Garden interaction catalog"
   ```

## 任务 4：准备并审核正式插画资产

**文件**

- 新增：`public/illustrations/garden/` 下的正式场景、阶段、照料、访客、装饰和功能图标资产
- 新增：`public/illustrations/garden/manifest.json`
- 新增：`tests/garden-assets.spec.ts`

**步骤**

1. 按设计文档输出桌面与手机安全裁切，保持最初小草稿的天空、草坡、池塘、长椅、主植物和访客关系。
2. 在接入代码前让用户查看正式静态场景与四阶段；未获确认不进入下一步。
3. 为资产建立 manifest，记录稳定键、文件名、原始尺寸、用途和是否纯装饰。
4. 写测试验证 manifest 中的每个文件存在、文件名唯一、没有远程 URL、没有 emoji 文件名，且核心场景有桌面和手机裁切。
5. 运行：

   ```bash
   pnpm exec playwright test tests/garden-assets.spec.ts --project=desktop-chromium
   ```

6. 提交：

   ```bash
   git add public/illustrations/garden tests/garden-assets.spec.ts
   git commit -m "Add approved SWEET Garden illustration assets"
   ```

## 任务 5：先用模拟数据完成静态场景与响应式页面

**文件**

- 新增：`components/garden/GardenScene.tsx`
- 新增：`components/garden/GardenActionDock.tsx`
- 新增：`components/garden/GardenRecordSheet.tsx`
- 新增：`components/garden/GardenCareSheet.tsx`
- 新增：`components/garden/GardenLayoutSheet.tsx`
- 新增：`components/garden/GardenKeepsakeDrawer.tsx`
- 新增：`components/garden/GardenFactsPanel.tsx`
- 修改：`views/garden/page.tsx`
- 修改：`views/globals.css`
- 修改：`locales/zh-CN.json`
- 修改：`locales/en.json`
- 修改：`tests/tempo-garden.spec.ts`

**步骤**

1. 扩展 `useIllustrativeGarden` 模拟响应，先写失败页面测试：庭院占主视觉、操作栏只有记录／照料／布置、AI 小结不存在、当天状态明确。
2. 写首次进入失败测试：实际庭院始终可见，只显示两步可跳过的场景内提示；完成或跳过后按账号记住。
3. 写手机与减少动态效果测试：无横向溢出、触控目标不小于 44×44、动画在 `prefers-reduced-motion` 下关闭。
4. 实现组件和页面状态机。底部抽屉打开时捕获焦点，关闭后返回触发按钮；持久化动作先保持禁用或模拟接口，不写本地长期状态。
5. 将现有轻量记录表单移入 `GardenRecordSheet`，保留完整 SWEET 链接和用户安全错误处理。
6. 保持提醒设置与真实参与统计在 `GardenFactsPanel`，不重新加入 AI 内容。
7. 运行：

   ```bash
   pnpm exec playwright test tests/tempo-garden.spec.ts --project=desktop-chromium
   pnpm exec playwright test tests/tempo-garden.spec.ts --project=mobile-chromium
   pnpm typecheck
   ```

8. 提交：

   ```bash
   git add components/garden views/garden/page.tsx views/globals.css locales/zh-CN.json locales/en.json tests/tempo-garden.spec.ts
   git commit -m "Build responsive interactive garden scene"
   ```

## 任务 6：数据库变更授权闸门

在执行任务 7 之前，向用户展示拟新增的三类表、字段、唯一约束、RLS、授权和级联删除范围，并取得“允许创建本地迁移并同步 `supabase/schema.sql`”的明确确认。若没有确认，停止数据库与持久化 API 工作；任务 1–5 的静态页面成果可以保留。

此授权仍不包括正式 Supabase 应用迁移。

## 任务 7：为私有互动状态创建本地迁移

**文件**

- 新增：由 Supabase CLI 生成的 `supabase/migrations/*_add_tempo_garden_interactions.sql`
- 修改：`supabase/schema.sql`
- 修改：`tests/tempo-garden.spec.ts`

**步骤**

1. 先扩展测试，断言新表都有 `auth.users(id) on delete cascade`、RLS、本人所有权条件、`USING` 与 `WITH CHECK`、对 `public/anon/authenticated` 的撤权，以及动作／位置／物件检查约束。
2. 运行测试确认失败。
3. 检查本机 CLI 命令，不猜参数：

   ```bash
   supabase --version
   supabase migration new --help
   ```

4. 创建迁移骨架：

   ```bash
   supabase migration new add_tempo_garden_interactions
   ```

5. 在生成文件中定义：每日照料表、固定位置布置表、日期型纪念物表；添加每日唯一、位置唯一、纪念日期唯一约束和所需索引。
6. 启用 RLS、撤销浏览器角色表权限、只授予 service role 所需权限，并保留本人所有权策略作为纵深防护。不要增加 `SECURITY DEFINER`。
7. 将迁移内容同步到 `supabase/schema.sql`。
8. 在本地 Supabase 应用并验证；执行前再次确认目标不是正式项目或恢复项目。
9. 运行：

   ```bash
   pnpm exec playwright test tests/tempo-garden.spec.ts --project=desktop-chromium -g "花园数据|级联|RLS"
   ```

   随后使用项目当时实际可用的 Supabase Advisors 工具执行安全与性能检查；工具不可用时如实记录未执行，不得猜测 CLI 参数或声称通过。
10. 提交迁移和 schema：

   ```bash
   git add supabase/migrations supabase/schema.sql tests/tempo-garden.spec.ts
   git commit -m "Add private SWEET Garden interaction state"
   ```

## 任务 8：实现服务端互动 API

**文件**

- 新增：`pages/api/garden/_shared.ts`
- 新增：`pages/api/garden/care.ts`
- 新增：`pages/api/garden/layout.ts`
- 新增：`pages/api/garden/keepsakes/index.ts`
- 新增：`pages/api/garden/keepsakes/[id].ts`
- 修改：`pages/api/garden.ts`
- 新增：`tests/tempo-garden-api.spec.ts`

**步骤**

1. 先写 API 失败测试：401、403、非法枚举、伪造日期、未解锁物件、跨用户删除、同日重复照料和纪念物幂等。
2. 抽取共享身份、学生资格、locale、限流与安全错误处理；保持服务端从 token 获取用户。
3. 实现照料 POST：验证当天存在参与事实，依靠唯一约束保证每日一次；重复请求返回已有结果而不是新增。
4. 实现布置 PUT：服务端重新计算参与日与解锁目录，只允许固定位置和已解锁物件。
5. 实现纪念物 POST/DELETE：创建前验证该上海日期存在本人参与事实；删除必须同时匹配 ID 和当前用户。
6. 扩展 `/api/garden` GET，返回场景等级、当天参与／照料状态、布局、已解锁目录、纪念物和提醒偏好。
7. 所有 5xx 只返回本地化安全文案，并用既有操作监控记录脱敏元数据。
8. 运行：

   ```bash
   pnpm exec playwright test tests/tempo-garden-api.spec.ts --project=desktop-chromium
   pnpm typecheck
   ```

9. 提交：

   ```bash
   git add pages/api/garden.ts pages/api/garden tests/tempo-garden-api.spec.ts
   git commit -m "Add secure SWEET Garden interaction APIs"
   ```

## 任务 9：连接浏览器客户端并保证失败恢复

**文件**

- 修改：`lib/cloudRecords.ts`
- 修改：`views/garden/page.tsx`
- 修改：`components/garden/GardenCareSheet.tsx`
- 修改：`components/garden/GardenLayoutSheet.tsx`
- 修改：`components/garden/GardenKeepsakeDrawer.tsx`
- 修改：`tests/tempo-garden.spec.ts`

**步骤**

1. 先写页面失败测试：服务端确认前不改变长期状态；失败时保留选择并显示重试；重复点击不会产生双提交；重新加载后状态来自服务端。
2. 在 `lib/cloudRecords.ts` 增加严格的响应类型和 care、layout、keepsake 请求函数。
3. 页面成功后刷新或局部合并服务端返回；动画只在确认成功后开始。
4. 资源失败时保留基础场景和可访问文本，不显示破图。
5. 运行桌面与手机专项：

   ```bash
   pnpm exec playwright test tests/tempo-garden.spec.ts --project=desktop-chromium
   pnpm exec playwright test tests/tempo-garden.spec.ts --project=mobile-chromium
   pnpm typecheck
   ```

6. 提交：

   ```bash
   git add lib/cloudRecords.ts views/garden/page.tsx components/garden tests/tempo-garden.spec.ts
   git commit -m "Connect SWEET Garden interactions"
   ```

## 任务 10：纳入 Account 数据导出与注销验证

**文件**

- 修改：`pages/api/account/data.ts`
- 修改：`tests/account-data-lifecycle.spec.ts`
- 修改：`tests/tempo-garden.spec.ts`

**步骤**

1. 先扩展 Account 生命周期测试：为临时用户插入照料、布置和纪念物，导出应包含这些行，注销后全部消失。
2. 在 `buildAccountExport` 中查询三个新表，只选择最小字段，不导出服务端内部信息。
3. 保持账号注销依靠 `auth.users` 外键级联；不要另写宽泛手动删除逻辑。
4. 运行：

   ```bash
   pnpm exec playwright test tests/account-data-lifecycle.spec.ts --project=desktop-chromium
   pnpm exec playwright test tests/tempo-garden.spec.ts --project=desktop-chromium -g "级联|导出"
   ```

   没有隔离 Supabase 凭据时，明确报告按设计跳过，不改用正式项目。
5. 提交：

   ```bash
   git add pages/api/account/data.ts tests/account-data-lifecycle.spec.ts tests/tempo-garden.spec.ts
   git commit -m "Include garden state in account lifecycle"
   ```

## 任务 11：完整回归与路线图证据

**文件**

- 修改：`ROADMAP.md`
- 仅在实际运行并取得证据后修改相关试点检查文档

**步骤**

1. 运行字典结构、静态检查和构建：

   ```bash
   pnpm typecheck
   pnpm build
   git diff --check
   ```

2. 运行花园桌面与手机专项：

   ```bash
   pnpm exec playwright test tests/tempo-garden.spec.ts tests/garden-catalog.spec.ts tests/garden-assets.spec.ts tests/tempo-garden-api.spec.ts --project=desktop-chromium
   pnpm exec playwright test tests/tempo-garden.spec.ts --project=mobile-chromium
   ```

3. 有隔离凭据且 fixture 已重置时，再运行相关权限与账号注销测试；无凭据则准确记录跳过。
4. 人工检查 `/garden` 与 `/en/garden` 的桌面和手机布局、焦点顺序、屏幕阅读器名称、减少动态效果和插画裁切。
5. 不用桌面证据关闭 iPhone Safari、安卓 Chrome 或微信内置浏览器事项。
6. 只把实际通过的命令、测试数量、跳过原因和日期写入 `ROADMAP.md`。整体结论继续保持 `READY WITH CONDITIONS`，除非所有其他 PILOT BLOCKER 也有合格证据。
7. 提交：

   ```bash
   git add ROADMAP.md
   git commit -m "Record interactive SWEET Garden verification"
   ```

## 最终人工确认点

- 正式插画是否确实延续最初小草稿的治愈感，而不是几何占位或 emoji 拼贴。
- 中文与英文是否自然、具体，没有聊天机器人式安慰表达。
- 记录、照料、布置和纪念物是否一眼可理解，但不会制造每日任务压力。
- 花园是否完全不显示 AI 小结、AI 建议或自动推断的情绪意义。
- 家长、老师、学校和管理员是否没有获得新的庭院数据入口。
- 正式 Supabase 迁移与正式部署是否仍保持未执行，直到各自获得明确授权。
