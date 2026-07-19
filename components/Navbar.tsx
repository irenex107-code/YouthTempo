import Link from "next/link";
import { useState } from "react";
import { navItems } from "@/data/site";

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 border-b border-ink/10 bg-cream/92 backdrop-blur">
      <div className="px-4 sm:px-8 lg:px-12">
        <div className="container flex min-h-[64px] items-center justify-between gap-3 lg:min-h-[68px]">
          <Link href="/" className="shrink-0 text-[1.05rem] font-extrabold text-ink">
            YouthTempo
          </Link>
          <nav className="hidden items-center gap-4 text-sm font-bold text-ink/80 lg:flex xl:gap-5">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className="whitespace-nowrap transition hover:text-sage-dark">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <Link href="/account" className="button-secondary px-4 py-2 text-xs sm:px-5">
              登录 / 我的记录
            </Link>
            <Link href="/check-in" className="button-primary px-4 py-2 text-xs sm:px-5">
              开始 SWEET 节律
            </Link>
          </div>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-ink/10 bg-white/75 text-ink shadow-sm sm:hidden"
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
        {menuOpen ? (
          <div className="container pb-4 sm:hidden">
            <nav className="grid gap-2 rounded-3xl border border-ink/10 bg-white/92 p-3 shadow-soft">
              {navItems.map((item) => (
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
                <Link href="/account" className="button-secondary w-full px-4 py-2.5 text-sm" onClick={() => setMenuOpen(false)}>
                  登录 / 我的记录
                </Link>
                <Link href="/check-in" className="button-primary w-full px-4 py-2.5 text-sm" onClick={() => setMenuOpen(false)}>
                  开始 SWEET 节律
                </Link>
              </div>
            </nav>
          </div>
        ) : null}
      </div>
    </header>
  );
}
