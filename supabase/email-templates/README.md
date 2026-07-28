# YouthTempo 登录验证码邮件

Supabase Dashboard 中需要同时更新以下两个模板，确保首次注册和已有账号登录的邮件体验一致：

1. Authentication > Emails > Confirm sign up
2. Authentication > Emails > Magic Link / OTP

两个模板都使用相同设置：

- Subject: `[YouthTempo] 登录验证码`
- Body: 使用本目录下 `otp.html` 的完整内容

模板必须保留 `{{ .Token }}`，不要加入 `{{ .ConfirmationURL }}`。如果模板包含确认链接，Supabase 会发送链接而不是纯验证码。
