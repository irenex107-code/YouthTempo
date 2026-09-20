export type GardenParticipation = {
  created_at: string;
};

export type GardenStage = "seed" | "sprout" | "leaves" | "bloom";

// The pilot uses the same Shanghai calendar convention as SWEET history.
export function shanghaiDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function weekStart(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

export function gardenStage(participations: number): GardenStage {
  if (participations >= 10) return "bloom";
  if (participations >= 4) return "leaves";
  if (participations >= 1) return "sprout";
  return "seed";
}

export function gardenSummary(
  quickCheckIns: GardenParticipation[],
  sweetRecords: GardenParticipation[],
  now = new Date(),
) {
  const today = shanghaiDateKey(now);
  const firstDayOfWeek = weekStart(today);
  const firstDayOfMonth = today.slice(0, 7);
  const records = [...quickCheckIns, ...sweetRecords]
    .map((record) => shanghaiDateKey(record.created_at))
    .filter(Boolean);
  const total = records.length;
  return {
    stage: gardenStage(total),
    total,
    thisWeek: records.filter((day) => day >= firstDayOfWeek && day <= today).length,
    thisMonth: records.filter((day) => day.startsWith(firstDayOfMonth) && day <= today).length,
    quickCheckIns: quickCheckIns.length,
    fullSweetRecords: sweetRecords.length,
  };
}
