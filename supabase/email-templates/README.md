# YouthTempo 登录验证码邮件

Supabase Dashboard 中需要同时更新以下两个模板，确保首次注册和已有账号登录的邮件体验一致：

1. Authentication > Emails > Confirm sign up
2. Authentication > Emails > Magic Link / OTP

两个模板都使用相同设置：

- Subject: `[YouthTempo] 登录验证码`
- Body: 使用本目录下 `otp.html` 的完整内容

模板必须保留 `{{ .Token }}`，不要加入 `{{ .ConfirmationURL }}`。如果模板包含确认链接，Supabase 会发送链接而不是纯验证码。

## 正式环境要求

- Supabase 默认 SMTP 仅用于开发，不能作为试点发信服务；必须在 Authentication > SMTP Settings 配置自有 SMTP。
- 发信地址使用独立的认证邮件子域，并完成 SPF、DKIM、DMARC。
- Auth > Rate Limits 中核对邮件上限；启用自有 SMTP 后 Supabase 初始限制通常为每小时 30 封。
- Auth > Providers > Email 中保持 OTP 长度为 8、有效期不超过 3600 秒，并与页面和模板说明一致。
- 不要在仓库、截图、工单或对话中保存 SMTP 密码。

完整验收记录见 `docs/EMAIL_OTP_SMTP.md`。
