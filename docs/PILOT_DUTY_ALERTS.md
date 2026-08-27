# 学生自主试用值班与邮件提醒

本链路只用于当前没有学校、老师或监护人参与的学生自主试用。它不会创建虚假的学校、老师或监护关系，也不能替代实时紧急服务。

## 收录范围

- 学生明确选择“试点值班负责人”后发送的留言；
- 没有学校承接、且确定性安全规则标记为 `safety_review` 的留言；
- 普通 SWEET、Mood Journal、私人日记和未命中安全规则的“写给自己”内容不进入值班队列。

平台管理员通过 `/admin#message-duty` 查看队列。正文默认收起；状态变更必须填写 1–500 字处理记录，数据库保存操作者、前后状态与时间。

## 邮件最小化

邮件只包含：

- 事件类型；
- 随机事件 UUID；
- 提交时间；
- 受权限保护的后台链接。

邮件不得包含学生姓名、登录邮箱、学校、留言正文、AI 小结、token、OTP 或其他敏感信息。SMTP 失败不会删除留言；后台显示发送状态，并允许值班负责人重新发送不含正文的提醒。

## 正式启用顺序

1. 正式 Supabase 已于 2026-08-28 应用 `20260827200529_add_pilot_duty_message_queue.sql` 与 `20260827200713_index_pilot_duty_foreign_keys.sql`，并完成安全与性能 advisors 复核。
2. 确认接收邮箱属于当前 active 平台管理员，并开启强认证与必要的邮箱安全措施。
3. 在香港 Lighthouse 受限环境文件中配置以下变量；不得写入仓库、Docker 镜像、聊天、截图或工单：

   - `PILOT_DUTY_ENABLED=true`
   - `PILOT_DUTY_SMTP_HOST`
   - `PILOT_DUTY_SMTP_PORT`（465 使用直接 TLS；587 使用 STARTTLS）
   - `PILOT_DUTY_SMTP_USER`
   - `PILOT_DUTY_SMTP_PASSWORD`
   - `PILOT_DUTY_SMTP_FROM`
   - `PILOT_DUTY_ALERT_TO`
   - `PILOT_DUTY_DASHBOARD_URL=https://youthtempo.com/admin#message-duty`

4. 使用虚拟学生、无真实个人信息的测试文本验证：主动留言、普通自我留言、高风险测试留言、邮件收件、后台查看、处理中、完成和处理历史。
5. 确认 SMTP 失败时留言仍在后台，学生端不声称邮件已经送达，运行日志和外部告警不包含正文或身份信息。
6. 登记值班时段、预计首次查看时间、替补联系人、非值班时段提示和线下紧急路径；在这些证据完成前保持 `READY WITH CONDITIONS`。

## 关闭与故障处理

- 设置 `PILOT_DUTY_ENABLED=false` 后，学生端不再显示主动联系值班负责人的选项；已保存队列和审计记录不被删除。
- SMTP 不完整或发送失败时，后台仍保留事件并显示“邮件尚未配置/发送失败”。
- 高风险页面必须继续要求学生立即联系身边可信任的成年人；如有即时危险，联系当地紧急服务，不得要求学生等待邮件回复。
