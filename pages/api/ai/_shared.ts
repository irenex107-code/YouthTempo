import type { NextApiRequest, NextApiResponse } from "next";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "");

export function requirePost(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "POST") return true;
  res.setHeader("Allow", "POST");
  res.status(405).json({ error: "Only POST requests are supported." });
  return false;
}

export function missing(res: NextApiResponse, message = "请先完成必要问题，再生成回应。") {
  res.status(400).json({ error: message });
}

export async function generateJson<T extends JsonValue>({
  task,
  schema,
  input,
}: {
  task: string;
  schema: string;
  input: JsonValue;
}): Promise<T> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "你是 YouthTempo 的早期支持助手，主要服务对象是青少年，以及关心他们的家长和老师。你做的是危机之前、更早一步的整理与引导。",
            "",
            "【语言与语气】只用简体中文。像一个可信任、耐心的大人：温和、平等，不居高临下、不说教。低污名、非医疗化。用第二人称「你」，紧扣用户写下的具体内容来回应，避免空泛安慰和套话。",
            "",
            "【边界】不诊断，不给用户贴健康标签（如“你有抑郁/焦虑症”），不做医学化结论。不替代医生、咨询师、父母、学校或紧急服务。不恐吓、不夸大、不制造紧迫感，不评判用户“好坏”或“健康与否”。只依据用户提供的信息回应，不臆测未提及的经历或原因。",
            "",
            "【安全兜底·最高优先级】如果用户流露出想伤害自己、不想活了、无法保证自身安全，或正在被他人伤害的信号：先温和表达关心，并让 ta 知道“你愿意说出来很重要”；不要追问细节、不评判、不制造羞耻。明确而温和地引导 ta 尽快联系可信任的大人、学校心理老师或专业帮助，让 ta 知道现在可以不用一个人扛。可自然提及全国心理援助热线 12356，紧急危险时拨打 110 或 120。这种情况下，安全永远优先于完成原本的整理任务。",
            "",
            "【输出】每个字段简洁克制，通常两到三句话，聚焦一个重点，不堆砌、不重复。严格只返回 JSON，不要使用 Markdown，不要加 ``` 代码块围栏，不要在 JSON 之外写任何说明文字。",
          ].join("\n"),
        },
        {
          role: "user",
          content: `${task}\n\n请严格返回 JSON，不要返回 Markdown。\nJSON 字段要求：${schema}\n\n用户输入：${JSON.stringify(input)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenAI response did not include content.");
  }

  // 部分模型（如经中转的 Claude）在 json 模式下仍会用 ```json ``` 代码块包裹，解析前先剥离。
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(cleaned) as T;
}

export function fail(res: NextApiResponse) {
  res.status(500).json({ error: "暂时无法生成回应，请稍后再试。" });
}
