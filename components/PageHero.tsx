type PageHeroProps = {
  label?: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
  aside?: React.ReactNode;
};

export function PageHero({ label, title, subtitle, action, aside }: PageHeroProps) {
  return (
    <section className="section">
      <div className="container grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <h1 className="mt-4 max-w-3xl text-[2rem] font-bold leading-[1.18] tracking-normal text-ink sm:text-5xl lg:text-[3.25rem]">
            {title}
          </h1>
          {label ? <p className="mt-3 text-sm font-bold text-sage">{label}</p> : null}
          <p className="mt-6 max-w-3xl text-base leading-8 text-muted">
            {subtitle}
          </p>
          {action ? <div className="mt-8 flex flex-wrap gap-3">{action}</div> : null}
        </div>
        {aside ? <div>{aside}</div> : null}
      </div>
    </section>
  );
}
