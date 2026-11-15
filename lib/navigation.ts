/** Display navigation only; every destination retains its own server authorization. */
type NavigationContext = { role: string; ageBand?: string | null };

const publicTargets = new Set([
  "/", "/for-young-people", "/for-teens", "/for-young-adults", "/for-parents", "/for-teachers",
  "/referral", "/resources", "/sweet-model", "/privacy-safety", "/contact", "/feedback", "/community",
]);
const studentTargets = new Set(["/garden", "/check-in", "/mood-journal", "/worry-time", "/support-request"]);
const schoolRoles = new Set(["支持老师", "学校负责人", "平台管理员"]);

export function normalizeNavigationTarget(value: unknown): string | null {
  if (value === "garden") return "/garden"; // Existing shared entry links.
  if (typeof value !== "string" || value.length > 512 || !value.startsWith("/") || value.startsWith("//")
    || /[\\%\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, "https://navigation.invalid");
    if (url.origin !== "https://navigation.invalid" || url.username || url.password) return null;
    // Next's locale-aware router restores the current locale, rather than accepting one from a return URL.
    const pathname = url.pathname.replace(/^\/(?:en|zh-CN)(?=\/|$)/, "") || "/";
    if (pathname.startsWith("//")) return null;
    if (pathname !== value.split(/[?#]/, 1)[0].replace(/^\/(?:en|zh-CN)(?=\/|$)/, "")) {
      if (!(pathname === "/" && ["/en", "/zh-CN"].includes(value))) return null;
    }
    if (url.hash && !/^#[a-zA-Z][a-zA-Z0-9_-]*$/.test(url.hash)) return null;
    // No route used for task return needs another nested redirect parameter.
    if (url.searchParams.has("next") || url.searchParams.has("redirect") || url.searchParams.has("returnTo")) return null;
    return `${pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function navigationTargetForRole(value: unknown, { role, ageBand }: NavigationContext): string | null {
  const target = normalizeNavigationTarget(value);
  if (!target || !role) return null;
  const pathname = target.split(/[?#]/, 1)[0];
  if (publicTargets.has(pathname)) return target;
  if (role === "学生" && studentTargets.has(pathname)) return target;
  if (pathname === "/messages" && ["学生", "支持老师", "学校负责人"].includes(role)) return target;
  if (pathname === "/reports" && ["学生", "支持老师"].includes(role)) return target;
  if (["/peer-space", "/consultation"].includes(pathname) && role === "学生" && ageBand === "18_plus") return target;
  if (["/support/apply", "/support/workbench"].includes(pathname)
    && (role === "专业支持者" || role === "支持老师" || (role === "学生" && ageBand === "18_plus"))) return target;
  if (pathname === "/admin" && schoolRoles.has(role)) return target;
  // Room reviewers hold scoped staff assignments independently of their profile role.
  // Returning to this exact task never grants access; its existing API verifies the assignment.
  if (pathname === "/admin/peer-space") return target;
  if (["/admin/support", "/admin/role-preview"].includes(pathname) && role === "平台管理员") return target;
  return null;
}

export function defaultAccountDestination(role: string): string | null {
  if (role === "学生") return "/garden";
  if (role === "家长") return "/for-parents";
  if (role === "支持老师") return "/account#students";
  if (role === "学校负责人" || role === "平台管理员") return "/admin";
  if (role === "专业支持者") return "/support/apply";
  return null;
}
