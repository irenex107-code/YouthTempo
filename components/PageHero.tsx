type PageHeroProps = {
  label?: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
  aside?: React.ReactNode;
};

export function PageHero({ title, subtitle, action, aside }: PageHeroProps) {
  return (
    <section className="section">
      <div className="container grid items-center gap-7 lg:grid-cols-[1.1fr_0.9fr] lg:gap-10">
        <div>
          <h1 className="max-w-3xl text-[2rem] font-bold leading-[1.18] tracking-normal text-ink sm:text-5xl lg:text-[3.25rem]">
            {title}
          </h1>
          <p className="mt-4 max-w-3xl text-[0.95rem] leading-7 text-muted sm:mt-6 sm:text-base sm:leading-8">
            {subtitle}
          </p>
          {action ? <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap">{action}</div> : null}
        </div>
        {aside ? <div>{aside}</div> : null}
      </div>
    </section>
  );
}
