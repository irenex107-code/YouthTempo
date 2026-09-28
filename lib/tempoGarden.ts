import { unlockedGardenPositions } from "@/lib/gardenCatalog";

export type GardenParticipation = {
  created_at: string;
};

export type GardenStage = "seed" | "sprout" | "leaves" | "bloom";
export type GardenSceneLevel = "base" | "settled" | "mature";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

// The pilot uses the same Shanghai calendar convention as SWEET history.
export function shanghaiDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function weekStart(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

export function participationDateKeys(
  quickCheckIns: GardenParticipation[],
  sweetRecords: GardenParticipation[],
  now = new Date(),
) {
  const today = shanghaiDateKey(now);
  return [...new Set(
    [...quickCheckIns, ...sweetRecords]
      .map((record) => shanghaiDateKey(record.created_at))
      .filter((day) => Boolean(day) && day <= today),
  )].sort();
}

export function gardenStage(participationDays: number): GardenStage {
  if (participationDays >= 7) return "bloom";
  if (participationDays >= 3) return "leaves";
  if (participationDays >= 1) return "sprout";
  return "seed";
}

export function gardenSceneLevel(participationDays: number): GardenSceneLevel {
  if (participationDays >= 28) return "mature";
  if (participationDays >= 14) return "settled";
  return "base";
}

export function gardenSummary(
  quickCheckIns: GardenParticipation[],
  sweetRecords: GardenParticipation[],
  now = new Date(),
) {
  const today = shanghaiDateKey(now);
  const firstDayOfWeek = weekStart(today);
  const firstDayOfMonth = today.slice(0, 7);
  const participationDays = participationDateKeys(quickCheckIns, sweetRecords, now);
  const total = participationDays.length;

  return {
    stage: gardenStage(total),
    sceneLevel: gardenSceneLevel(total),
    total,
    thisWeek: participationDays.filter((day) => day >= firstDayOfWeek && day <= today).length,
    thisMonth: participationDays.filter((day) => day.startsWith(firstDayOfMonth) && day <= today).length,
    quickCheckIns: quickCheckIns.length,
    fullSweetRecords: sweetRecords.length,
    todayParticipated: participationDays.includes(today),
    unlockedPositions: unlockedGardenPositions(total),
  };
}
