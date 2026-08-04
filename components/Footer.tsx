import Link from "next/link";
import { footerLinks } from "@/data/site";

export function Footer() {
  return (
    <footer className="border-t border-ink/10 bg-ink px-5 py-12 text-white sm:px-8 lg:px-12 lg:py-16">
      <div className="container grid gap-10 md:grid-cols-[1.3fr_1fr]">
        <div>
          <p className="text-lg font-black tracking-[-0.03em]">YouthTempo</p>
          <p className="mt-4 max-w-xl text-sm leading-7 text-white/65">
            青少年可以记录近况、整理感受；家长和老师可以在获得授权后了解变化。需要的时候，大家也能更快找到合适的帮助。
          </p>
          <p className="mt-5 text-xs font-bold text-white/45">从最近的生活开始聊。</p>
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
