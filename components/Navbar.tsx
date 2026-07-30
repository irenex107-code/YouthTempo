import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { navItems } from "@/data/site";
import { getSupabase } from "@/lib/supabaseClient";

const roleEntryHrefs = new Set(["/for-teens", "/for-parents", "/for-teachers"]);

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [accountRole, setAccountRole] = useState("");
  const refreshVersionRef = useRef(0);

  useEffect(() => {
    const supabase = getSupabase();
    let mounted = true;

    async function refreshAccount(session?: Session | null) {
      const refreshVersion = refreshVersionRef.current + 1;
      refreshVersionRef.current = refreshVersion;

      let activeSession = session;
      if (activeSession === undefined) {
        const { data } = await supabase?.auth.getSession() || { data: { session: null } };
        activeSession = data.session;
      }

      if (!mounted || refreshVersion !== refreshVersionRef.current) return;
      if (!activeSession) {
        setSignedIn(false);
        setAccountName("");
        setAccountRole("");
        setAuthReady(true);
        return;
      }

      setSignedIn(true);
      const metadataName =
        typeof activeSession.user.user_metadata?.display_name === "string"
          ? activeSession.user.user_metadata.display_name.trim()
          : "";

      try {
        const response = await fetch("/api/account/status", {
          headers: { authorization: `Bearer ${activeSession.access_token}` },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "账号状态加载失败。");
        if (!mounted || refreshVersion !== refreshVersionRef.current) return;
        const displayName =
          typeof data.profile?.display_name === "string"
            ? data.profile.display_name.trim()
            : "";
        setAccountName(displayName || metadataName);
        setAccountRole(typeof data.displayRole === "string" ? data.displayRole : "");
      } catch {
        if (!mounted || refreshVersion !== refreshVersionRef.current) return;
        setAccountName(metadataName);
        setAccountRole("");
      } finally {
        if (mounted && refreshVersion === refreshVersionRef.current) setAuthReady(true);
      }
    }

    refreshAccount();

    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      refreshAccount(session);
    });
    const handleProfileUpdated = () => refreshAccount();
    window.addEventListener("youthtempo:profile-updated", handleProfileUpdated);

    return () => {
      mounted = false;
      subscription?.data.subscription.unsubscribe();
      window.removeEventListener("youthtempo:profile-updated", handleProfileUpdated);
    };
  }, []);

  const accountLabel = signedIn
    ? accountName
      ? `你好，${accountName}！`
      : "你好！"
    : "登录 / 我的记录";
  const primaryAction =
    accountRole === "平台管理员"
      ? { href: "/admin", label: "平台管理", mobileLabel: "平台管理" }
      : accountRole === "学校负责人"
        ? { href: "/admin", label: "学校管理", mobileLabel: "学校管理" }
        : accountRole === "支持老师"
          ? { href: "/account#students", label: "我的学生", mobileLabel: "我的学生" }
          : accountRole === "家长"
            ? { href: "/account#records", label: "孩子记录", mobileLabel: "孩子记录" }
            : { href: "/check-in", label: "开始 SWEET 节律", mobileLabel: "记录今天" };
  const roleEntryHref =
    accountRole === "学生"
      ? "/for-teens"
      : accountRole === "家长"
        ? "/for-parents"
        : accountRole === "支持老师" || accountRole === "学校负责人"
          ? "/for-teachers"
          : null;
  const visibleNavItems = !authReady
    ? navItems.filter((item) => !roleEntryHrefs.has(item.href))
    : !signedIn
      ? navItems
      : navItems.filter(
          (item) => !roleEntryHrefs.has(item.href) || item.href === roleEntryHref,
        );

  return (
    <header className="sticky top-0 z-30 border-b border-ink/10 bg-cream/92 backdrop-blur">
      <div className="px-4 sm:px-8 lg:px-12">
        <div className="container flex min-h-[64px] items-center justify-between gap-3 lg:min-h-[68px]">
          <Link href="/" className="shrink-0 text-[1.05rem] font-extrabold text-ink">
            YouthTempo
          </Link>
          <nav className="hidden items-center gap-4 text-sm font-bold text-ink/80 xl:flex xl:gap-5">
            {visibleNavItems.map((item) => (
              <Link key={item.href} href={item.href} className="whitespace-nowrap transition hover:text-sage-dark">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="hidden shrink-0 items-center gap-2 xl:flex">
            {authReady ? (
              <Link
                href="/account"
                className="button-secondary max-w-48 truncate px-4 py-2 text-xs sm:px-5"
                title={accountLabel}
              >
                {accountLabel}
              </Link>
            ) : (
              <span className="h-9 w-28 animate-pulse rounded-full bg-ink/5" aria-label="正在加载账号" />
            )}
            <Link href={primaryAction.href} className="button-primary px-4 py-2 text-xs sm:px-5">
              {primaryAction.label}
            </Link>
          </div>
          <div className="flex items-center gap-2 xl:hidden">
            {signedIn && accountRole ? (
              <Link href={primaryAction.href} className="button-primary px-3 py-2 text-xs">
                {primaryAction.mobileLabel}
              </Link>
            ) : null}
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-ink/10 bg-white/75 text-ink shadow-sm"
              aria-label={menuOpen ? "关闭导航菜单" : "打开导航菜单"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span className="grid gap-1.5">
                <span className={`block h-0.5 w-5 rounded-full bg-current transition ${menuOpen ? "translate-y-2 rotate-45" : ""}`} />
                <span className={`block h-0.5 w-5 rounded-full bg-current transition ${menuOpen ? "opacity-0" : ""}`} />
                <span className={`block h-0.5 w-5 rounded-full bg-current transition ${menuOpen ? "-translate-y-2 -rotate-45" : ""}`} />
              </span>
            </button>
          </div>
        </div>
        {menuOpen ? (
          <div className="container pb-4 xl:hidden">
            <nav className="grid gap-2 rounded-3xl border border-ink/10 bg-white/92 p-3 shadow-soft">
              {visibleNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-2xl px-4 py-3 text-sm font-bold text-ink/80 transition hover:bg-cream hover:text-sage-dark"
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
              <div className="mt-1 grid gap-2 border-t border-ink/10 pt-3">
                {authReady ? (
                  <Link href="/account" className="button-secondary w-full px-4 py-2.5 text-sm" onClick={() => setMenuOpen(false)}>
                    {accountLabel}
                  </Link>
                ) : (
                  <span className="h-11 w-full animate-pulse rounded-full bg-ink/5" aria-label="正在加载账号" />
                )}
                <Link href={primaryAction.href} className="button-primary w-full px-4 py-2.5 text-sm" onClick={() => setMenuOpen(false)}>
                  {primaryAction.label}
                </Link>
              </div>
            </nav>
          </div>
        ) : null}
      </div>
    </header>
  );
}
