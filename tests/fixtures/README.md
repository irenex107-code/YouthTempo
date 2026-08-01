# 权限验收虚拟数据

这里的账号、学校和 SWEET 记录全部使用 `[E2E]` 标记，仅用于验证家长、老师、学校负责人和平台管理员的访问边界，不得替换为真实学生信息。

## 初始化

在本地环境中配置以下变量，密码至少 16 个字符且不得提交到仓库：

```text
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
E2E_PERMISSION_TEST_PASSWORD=...
```

然后运行：

```bash
npm run test:fixtures:permissions
```

脚本是幂等的：重复运行会恢复虚拟学校、账号、关系和三条测试记录，不会创建重复数据。Supabase `service_role` 只由该服务端脚本读取，绝不能放进 `NEXT_PUBLIC_` 变量。

## 验证

对本地站点或腾讯云 CloudBase 正式地址运行 Playwright。只有配置了 `E2E_PERMISSION_TEST_PASSWORD` 时，真实登录与 RLS 测试才会执行；否则会明确标记为跳过。

## 清理

确认不再需要这些虚拟数据后，显式运行：

```bash
npm run test:fixtures:permissions:cleanup
```

清理脚本只删除 `permission-boundary.json` 中列出的固定虚拟账号和学校。
