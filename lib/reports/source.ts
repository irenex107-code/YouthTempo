import { reportDimensions, type ReportAnswers, type ReportSourceRecord } from "./types";

const sourceFields = {
  sleep: { field: "quality", options: {
    "睡得很好": "sleep_very_good", "比较好": "sleep_good", "一般": "sleep_neutral", "不太好": "sleep_poor", "很不好": "sleep_very_poor",
  } },
  wake: { field: "state", options: {
    "很有精神": "wake_very_energized", "比较有精神": "wake_energized", "一般": "wake_neutral", "有点疲惫": "wake_tired", "很疲惫": "wake_very_tired",
  } },
  eat: { field: "rhythm", options: {
    "很规律": "eat_very_regular", "比较规律": "eat_regular", "一般": "eat_neutral", "不太规律": "eat_irregular", "很不规律": "eat_very_irregular",
  } },
  exercise: { field: "duration", options: {
    "0 分钟": "exercise_none", "1–9 分钟": "exercise_one_to_nine", "10–19 分钟": "exercise_ten_to_nineteen", "20–29 分钟": "exercise_twenty_to_twenty_nine", "30 分钟以上": "exercise_over_thirty", "不太确定": "exercise_unsure",
  } },
  task: { field: "engagement", options: {
    "很顺利": "task_very_smooth", "比较顺利": "task_smooth", "一般": "task_neutral", "不太顺利": "task_difficult", "很不顺利": "task_very_difficult",
  } },
} as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Exact timezone-bearing ISO instants, retaining PostgreSQL microsecond ordering. */
export function parseReportInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = "", zone, sign, offsetHour, offsetMinute] = match;
  const offsetHours = Number(offsetHour || 0);
  const offsetMinutes = Number(offsetMinute || 0);
  if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const offset = zone === "Z" ? 0 : (sign === "+" ? 1 : -1) * (offsetHours * 60 + offsetMinutes) * 60_000;
  const local = new Date(milliseconds + offset);
  if (local.getUTCFullYear() !== Number(year) || local.getUTCMonth() + 1 !== Number(month)
    || local.getUTCDate() !== Number(day) || local.getUTCHours() !== Number(hour)
    || local.getUTCMinutes() !== Number(minute) || local.getUTCSeconds() !== Number(second)) return null;
  const microseconds = milliseconds * 1000 + Number(fraction.padEnd(6, "0").slice(3));
  return Number.isSafeInteger(microseconds) ? microseconds : null;
}

export function formatReportInstant(microseconds: number): string {
  const milliseconds = Math.floor(microseconds / 1000);
  const remaining = microseconds - milliseconds * 1000;
  const iso = new Date(milliseconds).toISOString();
  return remaining ? iso.replace(/(\.\d{3})Z$/, `$1${String(remaining).padStart(3, "0")}Z`) : iso;
}

/**
 * Reads the current canonical SWEET shape only. English UI saves these same Chinese
 * options; translated labels and arbitrary free text are never mapping fallbacks.
 * The current source has no persisted schema-version field. This adapter does not
 * establish ownership, consent, recipient eligibility or a lawful processing basis.
 */
export function adaptSweetReportSources(rows: unknown[]): ReportSourceRecord[] {
  const result: ReportSourceRecord[] = [];
  if (!Array.isArray(rows)) return result;
  for (const row of rows) {
    if (!isObject(row) || !Array.isArray(row.records) || row.records.length !== reportDimensions.length) continue;
    const instant = parseReportInstant(row.created_at);
    if (instant === null) continue;
    const answers: Partial<ReportAnswers> = {};
    let valid = true;
    for (const dimension of reportDimensions) {
      const matchingSteps = row.records.filter((step) => isObject(step) && step.id === dimension);
      const step = matchingSteps[0];
      if (matchingSteps.length !== 1 || !isObject(step) || !Array.isArray(step.fields)) { valid = false; break; }
      const definition = sourceFields[dimension];
      const matchingFields = step.fields.filter((field) => isObject(field) && field.id === definition.field);
      const field = matchingFields[0];
      if (matchingFields.length !== 1 || !isObject(field) || typeof field.value !== "string"
        || !Object.hasOwn(definition.options, field.value)) { valid = false; break; }
      // Both keys and values come from the dimension-specific fixed lookup above.
      const mapped = (definition.options as Record<string, string>)[field.value];
      Object.assign(answers, { [dimension]: mapped });
    }
    if (valid) result.push({ createdAt: formatReportInstant(instant), answers: answers as ReportAnswers });
  }
  return result;
}
