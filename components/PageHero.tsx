type PageHeroProps = {
  label?: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
  aside?: React.ReactNode;
};

const rhythmItems = [
  ["S", "睡眠", "Sleep"],
  ["W", "醒来", "Wake"],
  ["E", "饮食", "Eat"],
  ["E", "运动", "Exercise"],
  ["T", "投入", "Task"],
] as const;

export function PageHero({ label = "YouthTempo", title, subtitle, action, aside }: PageHeroProps) {
  return (
    <section className="relative isolate overflow-hidden border-b border-ink/5 px-4 py-14 sm:px-8 sm:py-20 lg:px-12 lg:py-24">
      <div className="absolute -left-20 top-10 -z-10 h-56 w-56 rounded-full bg-gold/10 blur-3xl" aria-hidden="true" />
      <div className="absolute -right-20 bottom-0 -z-10 h-72 w-72 rounded-full bg-sage/15 blur-3xl" aria-hidden="true" />
      <div className="container grid items-center gap-9 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
        <div>
          <p className="eyebrow mb-5">{label}</p>
          <h1 className="max-w-3xl text-[2.35rem] font-extrabold leading-[1.08] tracking-[-0.035em] text-ink sm:text-[3.4rem] lg:text-[4rem]">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-8 text-muted sm:mt-6 sm:text-lg sm:leading-9">
            {subtitle}
          </p>
          {action ? <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap">{action}</div> : null}
        </div>
        {aside ? <div>{aside}</div> : <RhythmVisual />}
      </div>
    </section>
  );
}

function RhythmVisual() {
  return (
    <div className="surface-panel relative mx-auto max-w-lg overflow-hidden p-5 sm:p-7" aria-label="SWEET 五个日常节律维度">
      <div className="absolute right-0 top-0 h-32 w-32 rounded-bl-full bg-clay-soft/60" aria-hidden="true" />
      <p className="relative text-xs font-extrabold tracking-[0.12em] text-sage-dark">SWEET DAILY RHYTHM</p>
      <div className="relative mt-5 grid grid-cols-2 gap-3">
        {rhythmItems.map(([letter, title, english], index) => (
          <div key={`${letter}-${english}`} className={`rounded-2xl border border-ink/[0.07] p-4 ${index === 4 ? "col-span-2 bg-sage-dark text-white" : "bg-white/85"}`}>
            <span className={`text-lg font-black ${index === 4 ? "text-gold" : "text-clay"}`}>{letter}</span>
            <p className="mt-2 text-sm font-extrabold">{title}</p>
            <p className={`mt-1 text-[0.68rem] font-bold ${index === 4 ? "text-white/65" : "text-muted"}`}>{english}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
