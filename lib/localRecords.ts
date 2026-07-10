export type SavedSweetRecordField = {
  id: string;
  title: string;
  value: string | string[];
};

export type SavedSweetRecordStep = {
  id: string;
  title: string;
  label: string;
  fields: SavedSweetRecordField[];
};

export type SavedSweetRecord = {
  id: string;
  createdAt: string;
  records: SavedSweetRecordStep[];
  summary?: string;
  smallStep?: string;
  recommendedNextTool?: string;
};

export type DemoProfile = {
  name: string;
  role: string;
  updatedAt: string;
};

const recordsKey = "youthtempo:sweet-records";
const profileKey = "youthtempo:demo-profile";

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getDemoProfile(): DemoProfile | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(profileKey);
    return raw ? (JSON.parse(raw) as DemoProfile) : null;
  } catch {
    return null;
  }
}

export function saveDemoProfile(profile: Omit<DemoProfile, "updatedAt">) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(profileKey, JSON.stringify({ ...profile, updatedAt: new Date().toISOString() }));
}

export function getSavedSweetRecords() {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(recordsKey);
    const records = raw ? (JSON.parse(raw) as SavedSweetRecord[]) : [];
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

export function saveSweetRecord(record: Omit<SavedSweetRecord, "id" | "createdAt">) {
  if (!canUseStorage()) return null;
  const savedRecord: SavedSweetRecord = {
    ...record,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  const records = [savedRecord, ...getSavedSweetRecords()].slice(0, 20);
  window.localStorage.setItem(recordsKey, JSON.stringify(records));
  return savedRecord;
}

export function deleteSweetRecord(recordId: string) {
  if (!canUseStorage()) return;
  const records = getSavedSweetRecords().filter((record) => record.id !== recordId);
  window.localStorage.setItem(recordsKey, JSON.stringify(records));
}

export function clearSweetRecords() {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(recordsKey);
}
