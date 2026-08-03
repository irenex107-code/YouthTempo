# YouthTempo 邮箱 OTP 与 SMTP 验收

更新时间：2026-08-04

## 当前结论

YouthTempo 使用 Supabase 邮箱 OTP 登录，页面与邮件模板均按 8 位数字验证码设计。正式 Supabase 的公开 Auth 设置已确认：邮箱登录开启、允许首次 OTP 自动创建账户、手机号登录关闭。

正式库中已有不含邮箱地址的历史聚合证据：

| 收件服务 | 已确认账户 | 曾成功登录 | 最近一次成功登录（UTC） |
| --- | ---: | ---: | --- |
| QQ 邮箱域 | 1 | 1 | 2026-07-28 07:40 |
| 163 邮箱域 | 5 | 5 | 2026-07-31 15:33 |
| Outlook/Hotmail/Live 域 | 1 | 1 | 2026-07-28 09:15 |

这些记录证明三类邮箱过去完成过 OTP 登录闭环，但不能证明当前投递质量。近 24 小时 Auth 日志没有可用于重新验收的 OTP 活动。

当前仍不能勾选 ROADMAP：自有 SMTP 配置、发信域名认证和三类邮箱的当次收件验收尚未取得证据。Supabase 默认 SMTP 只面向开发与团队授权地址，没有生产交付 SLA。

## 自有 SMTP 配置

在正式项目 `saqkzfsmabsgbwdvuras` 的 Authentication > SMTP Settings 中配置：

- SMTP host、port、user、password；
- From address 使用专门的认证邮件子域，例如 `no-reply@auth.<正式域名>`；
- Sender name 使用 `YouthTempo`；
- 连接必须使用服务商支持的 TLS 端口。

SMTP 密码只能直接录入 Supabase Dashboard，不能写入 `.env.local`、仓库、终端命令、工单截图或聊天记录。

随后完成 DNS：SPF、DKIM、DMARC。认证邮件与营销邮件应使用不同子域和发信地址。

## Supabase Auth 核对

- Magic Link / OTP 与 Confirm sign up 模板都使用 `[YouthTempo] 登录验证码` 和 `supabase/email-templates/otp.html`。
- 模板必须包含 `{{ .Token }}`，不得包含 `{{ .ConfirmationURL }}`。
- OTP 长度保持 8 位，有效期不超过 3600 秒。
- 自有 SMTP 启用后，检查 Auth > Rate Limits；Supabase 默认先限制为每小时 30 封，再按试点规模审慎调整。
- 保持 60 秒重发间隔，不因投递问题关闭安全确认。

## 三邮箱正式验收

每类邮箱使用专用虚拟试点账号，不使用真实学生资料。QQ、163、Outlook 分别执行：

1. 从腾讯云正式站请求一次 OTP，记录请求时间，不记录验证码。
2. 确认 2 分钟内进入收件箱；若进入垃圾箱，记录为失败并检查域名认证和发信信誉。
3. 输入 OTP 完成登录，确认账户页正确加载。
4. 同一 OTP 再次使用必须失败；等待过期后的 OTP 必须失败。
5. 60 秒内重复请求应被限制或由页面阻止；不得收到异常邮件洪泛。
6. 只记录服务商、到达耗时、收件箱/垃圾箱、登录结果和时间，不保存邮件地址、验证码或邮件原文。

## 完成标准

- 自有 SMTP 已开启，发件人、TLS 与每小时上限已核对；
- SPF、DKIM、DMARC 全部通过；
- QQ、163、Outlook 当次收件与登录全部通过；
- 模板自动化测试和腾讯云正式站登录回归通过；
- 失败事件能进入 YouthTempo 脱敏错误监控。

参考：[Supabase Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)、[Supabase Passwordless Email](https://supabase.com/docs/guides/auth/auth-email-passwordless)。
