import type { ReportCategoryId, ReportDimension } from "./types";

export const comprehensiveVersion = "sweet-comprehensive-report-v2" as const;
export const historyDetailsVersion = "sweet-history-details-v1" as const;
export const maximumTrendBinsPerPage = 24;
export const maximumDetailDaysPerPage = 25;
export const maximumDetailTextCharacters = 8192;

export type SchoolReportDimension = {
  id: ReportDimension;
  state: "category" | "mixed" | "insufficient" | "unsupported";
  category?: ReportCategoryId;
};
export type SchoolReportWindow = { start: string | null; end: string; dimensions: SchoolReportDimension[] };
export type SchoolReportBin = SchoolReportWindow & { start: string; partial: boolean };
export type SchoolReportComparison = { id: ReportDimension; state: "same" | "different" | "unavailable" };
export type SchoolReportRecent = {
  current: SchoolReportWindow;
  previous: SchoolReportWindow;
  comparisons: SchoolReportComparison[];
};
export type SchoolReportCoverage = { start: string | null; end: string; state: "complete" | "partial" | "unsupported" };
export type SchoolReportTrend = {
  version: typeof comprehensiveVersion;
  asOf: string;
  viewToken: string;
  coverage: SchoolReportCoverage;
  overview: SchoolReportWindow;
  recent: { days7: SchoolReportRecent; days30: SchoolReportRecent };
  longTerm: { unit: "week" | "month"; bins: SchoolReportBin[]; nextCursor: string | null };
  detailsState: "off" | "available";
};

export type SchoolReportField = {
  id: string;
  state: "available" | "unsupported";
  value?: string | string[];
};
export type SchoolReportDetailDimension = { id: ReportDimension; fields: SchoolReportField[] };
export type SchoolReportDetailItem = {
  key: string;
  date: string | null;
  state: "available" | "partial" | "unsupported" | "conflict";
  dimensions?: SchoolReportDetailDimension[];
  summary?: string | null;
  summaryState?: "available" | "missing" | "unsupported";
};
export type SchoolReportDetails = {
  version: typeof historyDetailsVersion;
  asOf: string;
  viewToken: string;
  items: SchoolReportDetailItem[];
  nextCursor: string | null;
};

// Reference/RPC-only pagination positions. They are never public DTOs or access
// credentials. The server binds and encrypts them before adding public tokens.
export type SchoolReportTrendCore = Omit<SchoolReportTrend, "viewToken" | "longTerm"> & {
  longTerm: { unit: "week" | "month"; bins: SchoolReportBin[]; hasMore: boolean; nextBinStart: string | null };
};
export type HistoryDetailPosition = { phase: "dated"; beforeDate: string } | { phase: "undated"; afterId: string | null };
export type SchoolReportDetailsCore = {
  version: typeof historyDetailsVersion;
  asOf: string;
  // Internal key is the source UUID; the API MUST replace it with an opaque key
  // bound to the current actor and enrollment before returning a public DTO.
  items: SchoolReportDetailItem[];
  hasMore: boolean;
  nextPosition: HistoryDetailPosition | null;
};

export type ComprehensiveSourceRow = { id: string; created_at: unknown; records: unknown; summary?: unknown; [key: string]: unknown };
export type NormalizedSweetDetails = {
  answers: Partial<Record<ReportDimension, ReportCategoryId>>;
  dimensions: SchoolReportDetailDimension[];
  summary: string | null;
  summaryState: "available" | "missing" | "unsupported";
  state: "available" | "partial" | "unsupported";
};
export type DetailFieldDefinition = {
  id: string;
  kind: "single" | "multi" | "text";
  required?: true;
  options?: readonly string[];
};
