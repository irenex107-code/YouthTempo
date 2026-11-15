/** This switch enables a synthetic UI review, never real report access. */
export function isReportUiPreviewEnabled() {
  return (
    process.env.NODE_ENV !== "production"
    && process.env.REPORTS_UI_PREVIEW_ENABLED === "true"
  );
}
