type SectionHeaderProps = {
  label?: string;
  title: string;
  description?: string;
};

export function SectionHeader({ label, title, description }: SectionHeaderProps) {
  return (
    <div className="mb-10 max-w-4xl">
      {label ? <p className="eyebrow mb-4">{label}</p> : null}
      <h2 className="max-w-3xl text-[1.8rem] font-extrabold leading-[1.2] tracking-[-0.02em] text-ink sm:text-[2.35rem]">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-base leading-8 text-muted">{description}</p>
      ) : null}
    </div>
  );
}
