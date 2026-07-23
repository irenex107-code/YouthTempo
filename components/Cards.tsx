type CardProps = {
  title: string;
  label?: string;
  showLabel?: boolean;
  children: React.ReactNode;
};

export function InfoCard({ title, label, showLabel = false, children }: CardProps) {
  return (
    <article className="card h-full">
      <h3 className="text-[1.05rem] font-bold leading-snug text-ink sm:text-[1.18rem]">{title}</h3>
      {showLabel && label ? <p className="mt-2 text-xs font-bold tracking-normal text-sage">{label}</p> : null}
      <div className="mt-3 text-[0.95rem] leading-7 text-muted">{children}</div>
    </article>
  );
}

export function StepCard({ number, title, children }: CardProps & { number: number }) {
  return (
    <article className="card h-full">
      <div className="mb-5 flex h-8 w-8 items-center justify-center rounded-full bg-mist text-sm font-extrabold text-sage-dark">
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
      <div className="container rounded-3xl border border-ink/10 bg-white/75 p-8 shadow-soft sm:p-10 lg:flex lg:items-center lg:justify-between lg:gap-10">
        <div>
          <h2 className="max-w-3xl text-[1.7rem] font-bold leading-[1.25] text-ink sm:text-[2.1rem]">{title}</h2>
          <p className="mt-4 max-w-3xl text-base leading-8 text-muted">{description}</p>
        </div>
        <a href={href} className="button-primary mt-7 shrink-0 lg:mt-0">
          {action}
        </a>
      </div>
    </section>
  );
}
