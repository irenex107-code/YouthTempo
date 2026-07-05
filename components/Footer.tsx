import Link from "next/link";
import { footerLinks } from "@/data/site";

export function Footer() {
  return (
    <footer className="border-t border-ink/10 bg-cream px-5 py-10 sm:px-8 lg:px-12">
      <div className="container grid gap-8 md:grid-cols-[1.3fr_1fr]">
        <div>
          <p className="font-extrabold">青序计划 <span className="text-sm text-muted">YouthTempo</span></p>
          <p className="mt-3 max-w-xl text-sm leading-7 text-muted">
            面向青少年、家庭与学校的低门槛成长支持平台。我们从日常节律、情绪表达和可信任的人际连接开始，帮助支持更早发生。
          </p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-3 text-sm font-bold text-ink/75 md:justify-end">
          {footerLinks.map((item) => (
            <Link key={item.label} href={item.href} className="hover:text-sage-dark">
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
