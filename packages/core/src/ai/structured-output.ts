/**
 * Валидация structured output LLM (docs/11 §4): JSON-схема, клампинг значений,
 * один fix-up-ретрай при невалидном ответе.
 */
import { z } from "zod";

export const StructuredAnswerSchema = z.object({
  answer: z.string().min(1).max(8000),
  confidence: z.coerce.number(),
  user_intent_flags: z
    .object({
      wants_human: z.coerce.boolean().default(false),
      complaint: z.coerce.boolean().default(false),
    })
    .default({ wants_human: false, complaint: false }),
  detected_intent: z.string().max(200).default(""),
});

export type StructuredAnswer = z.infer<typeof StructuredAnswerSchema>;

export type StructuredParseResult =
  | { ok: true; value: StructuredAnswer }
  | { ok: false; reason: string };

/** Извлекает JSON из ответа (модель может обернуть в ```json … ```). */
export function extractJson(raw: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export function parseStructuredAnswer(raw: string): StructuredParseResult {
  const json = extractJson(raw);
  if (!json) return { ok: false, reason: "no_json_object" };
  try {
    const parsed = StructuredAnswerSchema.parse(JSON.parse(json));
    // клампинг confidence в [0,1]
    const confidence = Math.min(1, Math.max(0, parsed.confidence || 0));
    return { ok: true, value: { ...parsed, confidence } };
  } catch (err) {
    const zodErr = err as z.ZodError;
    return {
      ok: false,
      reason: (zodErr.issues ?? []).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }
}

export function fixupInstruction(reason: string): string {
  return `Твой предыдущий ответ не прошёл валидацию (${reason}). Ответь заново СТРОГО валидным JSON указанной схемы, без пояснений вокруг.`;
}
