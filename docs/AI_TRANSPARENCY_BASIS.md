# AI 透明度与未成年人告知依据

更新时间：2026-08-18

本文件只记录本轮“事前告知、主动确认、AI 身份标识”设计所依据的权威规范。它不是法律意见，也不替代中国适用法律、学校政策、隐私影响评估或心理专业审核。

## 本轮采用的产品原则

1. 青少年在输入内容前，应以年龄适配的语言知道回应来自 AI，而不是真人、教师、心理咨询师或医疗人员。
2. 说明 AI 可能出错、不提供诊断或治疗、不作重要决定，并保留现实中的真人支持路径。
3. 在内容发送给 provider 前取得主动确认，并用版本号让服务端拒绝缺失或过期的普通请求。
4. AI 辅助记录小结在结果中显示显式标识；确定性规则结果和固定安全提示不标为 AI 生成。
5. 告知用户不要输入姓名、学校班级、住址或联系方式；provider、保留、训练使用、处理地点和跨境信息需在法务核对后写入最终对外文本。

Referral 自 2026-08-18 起不再属于 AI 生成场景：普通支持路径由 `referral-rules-2026-08-18` 固定规则产生，详见 `docs/REFERRAL_RULE_BASIS.md`。

Worry Time 自 2026-08-18 起也不再属于 AI 生成场景：普通整理只根据用户填写的担心、可控性选择和明日行动，由 `worry-time-rules-2026-08-18` 固定规则产生，不调用 provider。

当前调用 provider 的网页场景仅为 SWEET Check-in 与 Mood Journal，另有小程序 Check-in。三者使用告知版本 `ai-notice-2026-08-18-v2`。模型不再直接撰写最终展示文本，只能从服务端生成的最小化 `sourceFields` 中选择有限数量的字段 ID；服务器拒绝未知、重复、超量或附带额外字段的输出，再用经过脱敏的来源片段和固定模板组成小结。关注维度、可选行动、下一工具和支持路径继续由固定规则或用户原文决定。

生成能力采用 fail-closed 配置：`AI_GENERATION_ENABLED` 只有精确为 `true` 时才开放；`OPENAI_BASE_URL` 的 HTTPS 主机必须列入 `AI_ALLOWED_PROVIDER_HOSTS`，`OPENAI_MODEL` 必须列入 `AI_ALLOWED_MODELS`。默认 OpenAI 配置使用日期快照 `gpt-4.1-mini-2025-04-14`，OpenAI 别名模型即使列入白名单也会被拒绝。正式启用前仍须由负责人核对供应商与模型获批证据，不能仅凭环境变量存在即视为完成治理。

发送前的常见标识移除覆盖邮箱、中国大陆及常见国际电话号码、身份证号、带标签的姓名、学校、班级、住址、微信/QQ/其他社交账号和链接。自动脱敏不能保证识别所有自然语言中的姓名、地点或第三方身份，因此产品仍要求用户不要输入这些信息，并保留人工隐私评估条件。

青少年端“陪我捋一捋”自 2026-08-18 起在首轮学校试点中关闭：页面不收集或发送对话内容，普通 API 请求不调用 AI provider；兼容 API 只保留确定性危机优先路径。关闭范围与重新开放条件见 `docs/TALK_PILOT_CLOSURE.md`。家长端基于 AIDET 的 SWEET Talk 不在此关闭范围内。

## 权威来源

- UNICEF，《Policy Guidance on AI for Children 2.0》：要求面向儿童及照护者提供可理解的透明度说明，直接与 AI 交互时应明确通知，重要决定不能只依赖 AI。https://www.unicef.org/innocenti/media/1341/file/UNICEF-Global-Insight-policy-guidance-AI-children-2.0-2021.pdf
- WHO，《Ethics and governance of artificial intelligence for health》：强调人的自主、有效知情同意、透明度、责任、安全和人的最终控制。https://www.who.int/publications/i/item/9789240029200
- WHO，“WHO calls for safe and ethical AI for health”：指出大模型可能生成看似权威但错误的内容，健康用途需要透明、专家监督和严格评估。https://www.who.int/news/item/16-05-2023-who-calls-for-safe-and-ethical-ai-for-health
- UNESCO，《Guidance for generative AI in education and research》：主张以人为本、年龄适配、隐私保护，并对独立使用生成式 AI 设置适当边界。https://www.unesco.org/en/articles/guidance-generative-ai-education-and-research
- 国家互联网信息办公室等，《人工智能生成合成内容标识办法》：要求在文本或交互场景周边添加用户可明显感知的显式标识，并在协议中说明标识方式；自 2025-09-01 起施行。https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm
- 国家标准 GB 45438—2025《网络安全技术 人工智能生成合成内容标识方法》：规定生成合成内容显式与隐式标识方法。https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=F32EA2A561F1886CD8D606513512D547
- 《未成年人网络保护条例》：要求网络产品和服务提供者履行未成年人网络保护义务，并根据不同年龄阶段的身心与认知特点提供服务。https://www.moe.gov.cn/jyb_xxgk/moe_1777/moe_1778/202310/t20231025_1087333.html

## 尚未关闭的治理事项

- 确认实际 provider、子处理者、处理地点、保存期限、是否用于训练以及跨境安排。
- 由法务/隐私负责人确认同意基础、敏感个人信息单独同意和未成年人适用流程。
- 由心理专业人员及学校审核告知文案是否足够清楚、不会造成错误安全感或替代真人支持。
- 如支持复制、下载或对外发布 AI 内容，另行实现并验证文件级显式/隐式标识要求。
