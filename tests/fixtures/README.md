# 权限验收虚拟数据

这里的账号、学校和 SWEET 记录全部使用 `[E2E]` 标记，仅用于验证家长、老师、学校负责人和平台管理员的访问边界，不得替换为真实学生信息。

## 初始化

在 Supabase Dashboard 打开 YouthTempo 项目：

1. 在 **Connect** 或 **Settings → API Keys** 复制 Project URL。
2. 在 **Publishable key** 复制 `sb_publishable_...`，供浏览器客户端使用。
3. 在 **Secret keys** 创建或复制一个 `sb_secret_...`，只供本机脚本和服务端使用。旧版 **Legacy API Keys → service_role** 仍兼容，但不优先使用。
4. 在本机运行 `openssl rand -base64 24` 生成一段独立的虚拟测试密码；不要使用真实账户密码。

在项目根目录新建 `.env.local` 并配置以下变量。密码至少 16 个字符且不得提交到仓库：

```text
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...或旧版service_role
E2E_PERMISSION_TEST_PASSWORD=...
# 可选：直接验证腾讯云正式环境；不填则自动启动本地 Next.js
PLAYWRIGHT_BASE_URL=https://youthtempo-web-287026-8-1457638967.sh.run.tcloudbase.com
```

收紧文件权限并确认 Git 会忽略它：

```bash
chmod 600 .env.local
git check-ignore -v .env.local
npm run env:check
```

检查命令只报告配置是否合格，不会回显密钥。然后运行：

```bash
npm run test:fixtures:permissions
npm run test:e2e:permissions
npm run test:e2e:sweet
npm run test:e2e:community
```

脚本是幂等的：重复运行会恢复虚拟学校、账号、关系和三条测试记录，不会创建重复数据。权限测试会覆盖伪造跨角色、跨学校、跨学生与留言收件人参数，以及直接调用 Supabase Data API 读取或删除他人记录；还会依次移出虚拟学生、老师和家长，验证测试开始前已经签发的旧会话是否立即失去相应权限。无论撤销测试是否通过，虚拟关系都会在 `finally` 中恢复。Supabase `service_role` 只由本机夹具和撤销测试读取，绝不能放进 `NEXT_PUBLIC_` 变量。

## 验证

对本地站点或腾讯云 CloudBase 正式地址运行 Playwright。只有配置了 `E2E_PERMISSION_TEST_PASSWORD` 时，真实登录与 RLS 隔离测试才会执行；成员撤销测试还需要 `SUPABASE_SERVICE_ROLE_KEY`，用于在测试后恢复固定虚拟关系。缺少相应变量时，测试会明确标记为跳过。

SWEET 生命周期测试会用虚拟学生在页面中完成五个维度，真实生成 AI 小结并保存，再从账号页重新读取和删除。每条临时记录都带唯一 `[E2E-LIFECYCLE]` 标记，并在 `finally` 中再次清理。

社区可见范围测试会用学生、家长、老师、专业支持者和平台管理员真实登录，验证发帖时选择的查看与评论身份、越权评论、作者删除和管理员删除。临时帖子与评论都带唯一 `[E2E-COMMUNITY]` 标记，并在 `finally` 中再次清理。

## 清理

确认不再需要这些虚拟数据后，显式运行：

```bash
npm run test:fixtures:permissions:cleanup
```

清理脚本只删除 `permission-boundary.json` 中列出的固定虚拟账号和学校。
