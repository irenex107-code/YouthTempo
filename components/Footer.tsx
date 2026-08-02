import Link from "next/link";
import { footerLinks } from "@/data/site";

export function Footer() {
  return (
    <footer className="border-t border-ink/10 bg-ink px-5 py-12 text-white sm:px-8 lg:px-12 lg:py-16">
      <div className="container grid gap-10 md:grid-cols-[1.3fr_1fr]">
        <div>
          <p className="text-lg font-black tracking-[-0.03em]">YouthTempo</p>
          <p className="mt-4 max-w-xl text-sm leading-7 text-white/65">
            YouthTempo 面向青少年、家庭、学校和专业支持者，提供容易开始的成长支持。我们从日常节律、感受整理和可信任的人际连接开始，让年轻人更早获得帮助。
          </p>
          <p className="mt-5 text-xs font-bold text-white/45">先看见节律，再找到支持。</p>
        </div>
        <div className="flex flex-wrap content-start gap-x-5 gap-y-3 text-sm font-bold text-white/70 md:justify-end">
          {footerLinks.map((item) => (
            <Link key={item.label} href={item.href} className="rounded-lg px-1 py-1 hover:text-white">
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
