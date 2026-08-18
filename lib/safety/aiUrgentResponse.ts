export type AiUrgentResponse = {
  reply: string;
  urgent: true;
  suggestHumanSupport: true;
};

export function isAiUrgentResponse(value: unknown): value is AiUrgentResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Record<string, unknown>;
  return response.urgent === true
    && response.suggestHumanSupport === true
    && typeof response.reply === "string"
    && Boolean(response.reply.trim());
}
