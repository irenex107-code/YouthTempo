import type { ReportDimension, ReportSummary } from "./types";

export const reportAccessVersion = "reports-access-v1" as const;
export const reportPolicyVersion = "reports-2026-10-27" as const;
export const reportSchoolPolicyVersion = "reports-school-2026-10-27" as const;

export type ReportRecipientType = "teacher" | "guardian";
export type ReportEligibility = "eligible" | "school_consent_required" | "minor_verification_required" | "not_available";
export type ReportGrantStatus = "active" | "expired" | "revoked" | "invalidated";

export type ReportCandidate = {
  id: string;
  type: "teacher";
  displayName: string;
};

// A management envelope, distinct from the identity-free report summary.
// Display names are only loaded after owner/recipient scope checks; no emails.
export type ReportAuthorizationView = {
  id: string;
  recipientType: ReportRecipientType;
  displayName: string;
  dimensions: ReportDimension[];
  effectiveAt: string;
  expiresAt: string;
  status: ReportGrantStatus;
};

export type ReportAccess = {
  version: typeof reportAccessVersion;
  eligibility: ReportEligibility;
  candidates: ReportCandidate[];
  owned: ReportAuthorizationView[];
  received: ReportAuthorizationView[];
};

export type CreateReportAuthorization = {
  recipientId: string;
  recipientType: "teacher";
  dimensions: ReportDimension[];
  requestId: string;
  confirmed: true;
};

export type ReportCurrentResponse = { summary: ReportSummary };

export const schoolReportAccessVersion = "school-report-access-v2" as const;
export const schoolReportPolicyVersion = "school-reports-2026-10-28" as const;
export const schoolReportDetailPolicyVersion = "sweet-details-2026-10-28" as const;

export type SchoolReportRecipient = { id: string; displayName: string; type: "teacher" };
export type SchoolReportEntry = {
  enrollmentId: string;
  displayName: string;
  effectiveAt: string;
  expiresAt: string;
};
export type SchoolReportOwner = SchoolReportEntry & {
  status: "active" | "expired" | "withdrawn" | "invalidated";
  detailsEnabled: boolean;
  detailRevision: number;
  recipientEpoch: number;
  recipients: SchoolReportRecipient[];
  recipientNextCursor: string | null;
};
export type SchoolReportAccess = {
  version: typeof schoolReportAccessVersion;
  viewerRole: "student" | "teacher" | "unavailable";
  eligibility: "enrolled" | "not_enrolled" | "expired" | "not_available";
  owner: SchoolReportOwner | null;
  received: SchoolReportEntry[];
  nextCursor: string | null;
};
export type SchoolReportDetailCommand = {
  enrollmentId: string;
  requestId: string;
  enabled: true;
  expectedDetailRevision: number;
  expectedRecipientEpoch: number;
  policyVersion: typeof schoolReportDetailPolicyVersion;
  confirmed: true;
} | { enrollmentId: string; requestId: string; enabled: false };
export type SchoolReportDetailSettingResponse = {
  enabled: boolean;
  detailRevision: number;
  recipientEpoch: number;
  replayed: boolean;
};
export type SchoolReportValidation = { valid: boolean; detailsEnabled: boolean };
