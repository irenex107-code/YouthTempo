import Link from "next/link";
import { navItems } from "@/data/site";

export function Navbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-ink/10 bg-cream/92 backdrop-blur">
      <div className="px-5 sm:px-8 lg:px-12">
        <div className="container flex min-h-[68px] items-center justify-between gap-5">
          <Link href="/" className="shrink-0 text-[1.05rem] font-extrabold text-ink">
            青序计划 <span className="text-sm text-muted">YouthTempo</span>
          </Link>
          <nav className="hidden items-center gap-4 text-sm font-bold text-ink/80 lg:flex xl:gap-5">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href} className="whitespace-nowrap transition hover:text-sage-dark">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/account" className="button-secondary px-4 py-2 text-xs sm:px-5">
              登录 / 我的记录
            </Link>
            <Link href="/check-in" className="button-primary px-4 py-2 text-xs sm:px-5">
              开始 SWEET 节律
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
