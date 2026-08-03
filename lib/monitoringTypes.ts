export const monitoredAreas = ["auth", "save", "ai", "community"] as const;
export type MonitoredArea = (typeof monitoredAreas)[number];

export const monitoredClientOperations = [
  "auth_session",
  "auth_redirect",
  "auth_otp_send",
  "auth_otp_verify",
  "sweet_record_save",
] as const;
export type MonitoredClientOperation = (typeof monitoredClientOperations)[number];

export const failureKinds = [
  "timeout",
  "network",
  "invalid_or_expired",
  "permission_denied",
  "rate_limited",
  "service_unavailable",
  "unexpected",
] as const;
export type FailureKind = (typeof failureKinds)[number];

export function isMonitoredArea(value: unknown): value is MonitoredArea {
  return typeof value === "string" && monitoredAreas.includes(value as MonitoredArea);
}

export function isMonitoredClientOperation(value: unknown): value is MonitoredClientOperation {
  return typeof value === "string" && monitoredClientOperations.includes(value as MonitoredClientOperation);
}

export function isFailureKind(value: unknown): value is FailureKind {
  return typeof value === "string" && failureKinds.includes(value as FailureKind);
}
