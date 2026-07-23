type SectionHeaderProps = {
  label?: string;
  title: string;
  description?: string;
};

export function SectionHeader({ title, description }: SectionHeaderProps) {
  return (
    <div className="mb-10 max-w-4xl">
      <h2 className="max-w-3xl text-[1.7rem] font-bold leading-[1.25] text-ink sm:text-[2.15rem]">
        {title}
      </h2>
      {description ? (
        <p className="mt-4 text-base leading-8 text-muted">{description}</p>
      ) : null}
    </div>
  );
}
