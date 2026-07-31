# YouthTempo 腾讯云部署

腾讯云 CloudBase Run 是 YouthTempo 当前唯一正式网站部署目标。Supabase 继续承担身份认证和主数据库，CloudBase Run 运行 Next.js 服务和 API。

## 正式环境

- Region：上海
- Runtime：CloudBase Run
- Build：仓库根目录 `Dockerfile`
- Service port：`3000`
- Health check：`/api/health`
- Production URL：`https://youthtempo-web-287026-8-1457638967.sh.run.tcloudbase.com`

## 必需变量

构建和运行时都需要：

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

仅运行时使用：

```text
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
OPENAI_BASE_URL
OPENAI_MODEL
WECHAT_MINI_APP_ID
WECHAT_MINI_APP_SECRET
WECHAT_MINI_BIND_PAGE
```

`SUPABASE_SERVICE_ROLE_KEY`、`OPENAI_API_KEY` 和 `WECHAT_MINI_APP_SECRET` 必须保持为服务端密钥。

## 每次发布后的验收

1. 确认 `/api/health` 返回 `200` 和 `status: ok`。
2. 检查首页、三个角色入口、社区、账户和管理台可访问。
3. 使用试点账号完成一次 SWEET 生成、保存和重新读取。
4. 验证家长、老师、学校负责人不能越权查看无关学生。
5. 检查社区发帖、评论、可见范围、举报和删除。
6. 确认 GitHub Verify 工作流通过。

## 部署收口

- 不再把 Vercel 作为正式或备用部署目标。
- 仓库内不保留 Vercel 专用配置。
- 需要在 Vercel 账户中断开该仓库的自动部署集成；删除仓库文件本身不会停止外部集成。
- 自定义域名上线前完成域名实名认证、ICP 备案和 CloudBase 域名绑定。
