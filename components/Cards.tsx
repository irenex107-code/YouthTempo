type CardProps = {
  title: string;
  label?: string;
  showLabel?: boolean;
  children: React.ReactNode;
};

export function InfoCard({ title, label, showLabel = false, children }: CardProps) {
  return (
    <article className="card group relative h-full overflow-hidden transition duration-200 hover:-translate-y-1 hover:border-sage/25 hover:shadow-lift">
      <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sage via-gold to-clay opacity-70" aria-hidden="true" />
      <h3 className="text-[1.05rem] font-bold leading-snug text-ink sm:text-[1.18rem]">{title}</h3>
      {showLabel && label ? <p className="mt-2 text-xs font-bold tracking-normal text-sage">{label}</p> : null}
      <div className="mt-3 text-[0.95rem] leading-7 text-muted">{children}</div>
    </article>
  );
}

export function StepCard({ number, title, children }: CardProps & { number: number }) {
  return (
    <article className="card h-full transition duration-200 hover:-translate-y-1 hover:shadow-lift">
      <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-sage-dark text-sm font-extrabold text-white shadow-sm">
        {number}
      </div>
      <h3 className="text-[1.05rem] font-bold leading-snug text-ink sm:text-[1.18rem]">{title}</h3>
      <div className="mt-3 text-[0.95rem] leading-7 text-muted">{children}</div>
    </article>
  );
}

export function CTASection({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description: string;
  href: string;
  action: string;
}) {
  return (
    <section className="section">
      <div className="container surface-panel relative overflow-hidden p-8 sm:p-10 lg:flex lg:items-center lg:justify-between lg:gap-10">
        <span className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-clay-soft/70" aria-hidden="true" />
        <div className="relative">
          <h2 className="max-w-3xl text-[1.7rem] font-bold leading-[1.25] text-ink sm:text-[2.1rem]">{title}</h2>
          <p className="mt-4 max-w-3xl text-base leading-8 text-muted">{description}</p>
        </div>
        <a href={href} className="button-primary relative mt-7 shrink-0 lg:mt-0">
          {action}
        </a>
      </div>
    </section>
  );
}
