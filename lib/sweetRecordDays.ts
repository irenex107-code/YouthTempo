const dayMs = 24 * 60 * 60 * 1000;

export const sweetRecordTimeZone = "Asia/Shanghai";

function calendarParts(value: Date | string, timeZone: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

export function sweetRecordCalendarDayNumber(
  value: Date | string,
  timeZone = sweetRecordTimeZone,
) {
  const parts = calendarParts(value, timeZone);
  return parts ? Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / dayMs) : null;
}

export function shanghaiCalendarDayRange(value: Date | string = new Date()) {
  const parts = calendarParts(value, sweetRecordTimeZone);
  if (!parts) throw new Error("记录时间无效，请刷新后重试。");
  const start = Date.UTC(parts.year, parts.month - 1, parts.day) - 8 * 60 * 60 * 1000;
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + dayMs).toISOString(),
  };
}

export function latestSweetRecordsPerUserDay<
  T extends { user_id: string; created_at: string },
>(records: T[], timeZone = sweetRecordTimeZone) {
  const sorted = [...records].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  );
  const seen = new Set<string>();
  return sorted.filter((record) => {
    const day = sweetRecordCalendarDayNumber(record.created_at, timeZone);
    if (day === null) return true;
    const key = `${record.user_id}:${day}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
