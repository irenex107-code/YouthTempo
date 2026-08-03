# YouthTempo

YouthTempo 是一个面向 14–18 岁在校青少年的早期支持平台。第一阶段采用学校合作的 B2B2C 模式，以 SWEET 日常节律记录为核心，连接学生、家长、老师、学校负责人和专业支持者。

当前状态：学校试点前收口阶段。正式网站部署在腾讯云 CloudBase Run；Supabase 提供身份认证与主数据库。

## 核心产品链路

1. 学生记录睡眠、醒来、饮食、运动和任务投入。
2. AI 生成简短、非诊断性的 SWEET 小结并保存云端记录。
3. 家长查看已关联孩子的记录和来信。
4. 老师查看所负责学生的概览、记录与来信。
5. 学校负责人按老师查看近四周参与情况和需要了解的变化，必要时追踪原始记录。
6. 家校医社区支持按身份控制帖子和评论的可见范围。

## 主要页面

- `/for-teens` 青少年入口
- `/for-parents` 家长入口
- `/for-teachers` 老师入口
- `/check-in` SWEET 节律记录
- `/mood-journal` 心情拼图
- `/worry-time` 今晚先放下
- `/talk` 陪我捋一捋
- `/messages` 悄悄话信箱
- `/referral` 下一步找谁
- `/community` 家校医社区
- `/account` 登录与角色工作区
- `/admin` 学校与平台管理台

## 本地开发

项目固定使用 `pnpm@11.9.0` 和 Node.js 22。

```bash
pnpm install --frozen-lockfile
pnpm dev:local
```

验证命令：

```bash
pnpm typecheck
pnpm build
pnpm test:e2e
```

首次运行浏览器测试前：

```bash
pnpm test:e2e:install
```

## 环境变量

浏览器可见配置：

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

服务端密钥：

```text
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
OPENAI_BASE_URL
OPENAI_MODEL
WECHAT_MINI_APP_ID
WECHAT_MINI_APP_SECRET
WECHAT_MINI_BIND_PAGE
ERROR_MONITOR_WEBHOOK_URL
ERROR_MONITOR_WEBHOOK_TOKEN
```

禁止把真实密钥写入代码、Dockerfile 或 Git 历史。

## 项目管理

所有当前状态、优先级和验收标准统一维护在 [ROADMAP.md](./ROADMAP.md)。历史对话中的待办应先合并到该文件，不再建立相互冲突的清单。
