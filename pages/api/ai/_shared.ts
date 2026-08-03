import type { NextApiRequest, NextApiResponse } from "next";
import { enforceAiRateLimit } from "@/lib/rateLimit";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "");
const maxInputCharacters = 20_000;

class AiInputTooLargeError extends Error {}

function requestTimeoutMs() {
  const configured = Number(process.env.AI_REQUEST_TIMEOUT_MS || 20_000);
  return Number.isFinite(configured) ? Math.min(60_000, Math.max(5_000, configured)) : 20_000;
}

export function requirePost(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "POST") return true;
  res.setHeader("Allow", "POST");
  res.status(405).json({ error: "Only POST requests are supported." });
  return false;
}

export function missing(res: NextApiResponse, message = "请先完成必要问题，再生成回应。") {
  res.status(400).json({ error: message });
}

export function shortText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function requireAiInputSize(req: NextApiRequest, res: NextApiResponse) {
  const serializedBody = JSON.stringify(req.body || {});
  if (serializedBody.length <= maxInputCharacters) return true;
  res.status(413).json({ error: "填写的内容有些长，请精简后再生成。" });
  return false;
}

export async function requireAiRateLimit(req: NextApiRequest, res: NextApiResponse) {
  try {
    return await enforceAiRateLimit(req, res, getSupabaseAdmin());
  } catch (error) {
    console.error("AI rate limit check failed", error);
    res.status(503).json({ error: "生成服务暂时不可用，请稍后再试。" });
    return false;
  }
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

  const systemMessage = [
    "你是 YouthTempo 的早期支持助手，主要服务对象是青少年，以及关心他们的家长和老师。你做的是危机之前、更早一步的整理与引导。",
    "",
    "【语言与语气】只用简体中文。像一个可信任、耐心的大人：温和、平等，不居高临下、不说教。低污名、非医疗化。用第二人称「你」，紧扣用户写下的具体内容来回应，避免空泛安慰和套话。",
    "",
    "【边界】不诊断，不给用户贴健康标签（如“你有抑郁/焦虑症”），不做医学化结论。不替代医生、咨询师、父母、学校或紧急服务。不恐吓、不夸大、不制造紧迫感，不评判用户“好坏”或“健康与否”。只依据用户提供的信息回应，不臆测未提及的经历或原因。",
    "",
    "【安全兜底·最高优先级】如果用户流露出想伤害自己、不想活了、无法保证自身安全，或正在被他人伤害的信号：先温和表达关心，并让 ta 知道“你愿意说出来很重要”；不要追问细节、不评判、不制造羞耻。明确而温和地引导 ta 尽快联系可信任的大人、学校心理老师或专业帮助，让 ta 知道现在可以不用一个人扛。可自然提及全国心理援助热线 12356，紧急危险时拨打 110 或 120。这种情况下，安全永远优先于完成原本的整理任务。",
    "",
    "【输出】每个字段只完成一个任务，通常一句，最多两句。先说用户此刻最需要知道的内容，再给一个能执行的小动作；不堆砌、不重复、不使用报告式小结。严格只返回 JSON，不要使用 Markdown，不要加 ``` 代码块围栏，不要在 JSON 之外写任何说明文字。",
  ].join("\n");
  const serializedInput = JSON.stringify(input);
  if (serializedInput.length > maxInputCharacters) {
    throw new AiInputTooLargeError("AI input is too large.");
  }
  const userMessage = `${task}\n\n请严格返回 JSON，不要返回 Markdown。\nJSON 字段要求：${schema}\n\n用户输入：${serializedInput}`;

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: attempt === 0 ? 0.4 : 0.1,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemMessage },
            {
              role: "user",
              content: attempt === 0 ? userMessage : `${userMessage}\n\n上一次请求未能生成可用结果。请只返回一个语法正确、字段完整的 JSON 对象。`,
            },
          ],
        }),
        signal: AbortSignal.timeout(requestTimeoutMs()),
      });
    } catch (error) {
      lastError = error;
      if (attempt === 0) continue;
      throw error;
    }

    if (!response.ok) {
      const text = (await response.text()).slice(0, 500);
      lastError = new Error(`OpenAI request failed: ${response.status} ${text}`);
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) continue;
      throw lastError;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      lastError = new Error("OpenAI response did not include content.");
      continue;
    }

    // 部分兼容模型仍会用 ```json ``` 包裹，解析前先剥离。
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      return JSON.parse(cleaned) as T;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("OpenAI response was not valid JSON.");
}

export function fail(res: NextApiResponse, error?: unknown) {
  if (error instanceof AiInputTooLargeError) {
    res.status(413).json({ error: "填写的内容有些长，请精简后再生成。" });
    return;
  }
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) {
    res.status(504).json({ error: "生成等待时间有些长，请稍后再试。" });
    return;
  }
  res.status(500).json({ error: "暂时无法生成回应，请稍后再试。" });
}
