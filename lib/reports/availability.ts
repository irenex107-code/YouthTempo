/** Local integration only. No browser option or production flag can enable it. */
export function isReportsLocalIntegrationEnabled() {
  if (process.env.NODE_ENV === "production" || process.env.REPORTS_LOCAL_INTEGRATION_ENABLED !== "true") return false;
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
    return url.protocol === "http:" && url.hostname === "127.0.0.1"
      && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}
