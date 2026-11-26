import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { navItems } from "@/data/site";
import { useTranslation } from "@/lib/i18n/client";
import { signOut } from "@/lib/cloudRecords";
import { getSupabase } from "@/lib/supabaseClient";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeoutId: number | undefined;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error("账号状态加载超时。")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

export function Navbar() {
  const router = useRouter();
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [accountRole, setAccountRole] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [exitFailed, setExitFailed] = useState(false);
  const displayedUser = useRef("");
  const signingOut = useRef(false);
  const refreshVersionRef = useRef(0);

  useEffect(() => {
    const supabase = getSupabase();
    let mounted = true;

    async function refreshAccount(session?: Session | null) {
      const refreshVersion = refreshVersionRef.current + 1;
      refreshVersionRef.current = refreshVersion;

      let activeSession = session;
      if (activeSession === undefined) {
        try {
          const sessionResult = supabase
            ? await withTimeout(supabase.auth.getSession(), 4_000)
            : { data: { session: null } };
          activeSession = sessionResult.data.session;
        } catch {
          if (!mounted || refreshVersion !== refreshVersionRef.current) return;
          setSignedIn(false);
          setAccountName("");
          setAccountRole("");
          setAuthReady(true);
          return;
        }
      }

      if (!mounted || refreshVersion !== refreshVersionRef.current) return;
      const actor = activeSession?.user.id || "";
      if (displayedUser.current !== actor) {
        setAccountName("");
        setAccountRole("");
        setExitFailed(false);
        displayedUser.current = actor;
      }
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
        const response = await withTimeout(
          fetch("/api/account/status", {
            headers: { authorization: `Bearer ${activeSession.access_token}` },
          }),
          8_000,
        );
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

  async function leaveAccount() {
    const actor = displayedUser.current;
    if (!actor || signingOut.current) return;
    signingOut.current = true;
    setLeaving(true);
    setExitFailed(false);
    try {
      await signOut(actor);
      if (!displayedUser.current || displayedUser.current === actor) {
        window.location.replace(router.locale === "en" ? "/en/account?signedOut=1" : "/account?signedOut=1");
      }
    } catch {
      setExitFailed(true);
    } finally {
      signingOut.current = false;
      setLeaving(false);
    }
  }

  const signOutButton = signedIn ? (
    <button type="button" className="button-secondary shrink-0 whitespace-nowrap px-1.5 py-2 text-sm sm:px-3" disabled={leaving} onClick={leaveAccount}>
      {t(leaving ? "common.navbar.account.signingOut" : "account.actions.signOut")}
    </button>
  ) : null;
  const accountLabel = signedIn
    ? accountName
      ? t("common.navbar.account.greetingWithName", { name: accountName })
      : t("common.navbar.account.greeting")
    : t("common.navbar.account.signInRecords");
  const primaryAction =
    accountRole === "平台管理员"
      ? { href: "/admin", label: t("common.navbar.actions.platformAdmin"), mobileLabel: t("common.navbar.actions.platformAdmin") }
      : accountRole === "学校负责人"
        ? { href: "/admin", label: t("common.navbar.actions.schoolAdmin"), mobileLabel: t("common.navbar.actions.schoolAdmin") }
        : accountRole === "支持老师"
          ? { href: "/account#students", label: t("common.navbar.actions.myStudents"), mobileLabel: t("common.navbar.actions.myStudents") }
          : accountRole === "家长"
            ? { href: "/for-parents", label: t("common.navbar.nav.forParents"), mobileLabel: t("common.navbar.nav.forParents") }
            : { href: "/garden", label: t("common.navbar.actions.startSweet"), mobileLabel: t("common.navbar.actions.recordToday") };
  return (
    <header className="sticky top-0 z-30 border-b border-ink/[0.07] bg-cream/88 shadow-[0_8px_30px_rgba(32,51,47,0.04)] backdrop-blur-xl">
      <div className="flex max-h-dvh flex-col px-2 min-[400px]:px-3 sm:px-8 lg:px-12">
        <div className="container flex min-h-[68px] w-full shrink-0 flex-wrap items-center justify-between gap-x-1 gap-y-1 py-1 sm:gap-x-3 lg:min-h-[76px] xl:flex-nowrap">
          <Link href="/" className="shrink-0 text-[1.2rem] font-black tracking-[-0.035em] text-ink transition hover:text-sage-dark" aria-label={t("common.navbar.homeAria")}>
            YouthTempo
          </Link>
          <nav className="hidden min-w-0 flex-wrap items-center justify-center gap-1 text-sm font-bold text-ink/80 xl:flex">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className={`whitespace-nowrap rounded-lg px-2.5 py-2 transition ${router.pathname === item.href ? "bg-mist text-sage-dark" : "hover:bg-white/70 hover:text-sage-dark"}`}>
                {t(item.labelKey)}
              </Link>
            ))}
          </nav>
          <div className="hidden shrink-0 items-center gap-2 xl:flex">
            <LanguageSwitcher />
            {authReady ? (
              <Link
                href="/account"
                className="button-secondary max-w-40 px-4 py-2 text-sm"
                title={accountLabel}
              >
                <span className="truncate">{accountLabel}</span>
              </Link>
            ) : (
              <span className="h-9 w-28 animate-pulse rounded-full bg-ink/5" aria-label={t("common.navbar.loadingAccount")} />
            )}
            {signOutButton}
            {!navItems.some((item) => item.href === primaryAction.href) && (
              <Link href={primaryAction.href} className="button-primary px-4 py-2 text-sm">
                {primaryAction.label}
              </Link>
            )}
          </div>
          <LanguageSwitcher className="ml-auto xl:hidden" />
          <div className="flex shrink-0 items-center gap-1 max-[399px]:ml-auto sm:gap-2 xl:hidden">
            {signedIn && accountRole ? (
              <Link href={primaryAction.href} className="button-primary hidden px-3 py-2 text-sm sm:inline-flex">
                {primaryAction.mobileLabel}
              </Link>
            ) : null}
            {signOutButton}
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-ink/10 bg-paper text-ink shadow-sm"
              aria-label={menuOpen ? t("common.navbar.closeMenu") : t("common.navbar.openMenu")}
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
          <div className="container min-h-0 w-full overflow-y-auto overscroll-contain pb-4 xl:hidden">
            <nav className="grid gap-2 rounded-[1.5rem] border border-ink/10 bg-paper/95 p-3 shadow-soft">
              <div className="grid gap-2 border-b border-ink/10 pb-3">
                {authReady ? (
                  <Link href="/account" className="button-secondary w-full px-4 py-2.5 text-sm [overflow-wrap:anywhere]" onClick={() => setMenuOpen(false)}>
                    {accountLabel}
                  </Link>
                ) : (
                  <span className="h-11 w-full animate-pulse rounded-full bg-ink/5" aria-label={t("common.navbar.loadingAccount")} />
                )}
                <Link href={primaryAction.href} className="button-primary w-full px-4 py-2.5 text-sm" onClick={() => setMenuOpen(false)}>
                  {primaryAction.label}
                </Link>
              </div>
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-xl px-4 py-3 text-sm font-bold transition ${router.pathname === item.href ? "bg-mist text-sage-dark" : "text-ink/80 hover:bg-cream hover:text-sage-dark"}`}
                  onClick={() => setMenuOpen(false)}
                >
                  {t(item.labelKey)}
                </Link>
              ))}

            </nav>
          </div>
        ) : null}
        {exitFailed ? <p role="alert" className="container pb-3 text-sm">{t("common.navbar.account.exitFailed")}</p> : null}
      </div>
    </header>
  );
}
