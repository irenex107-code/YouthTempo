import Link from "next/link";
import { useTranslation } from "@/lib/i18n/client";

export default function ForYoungPeoplePage() {
  const { t } = useTranslation();
  const paths = [
    { key: "secondary", href: "/for-teens" },
    { key: "youngAdults", href: "/for-young-adults" },
  ] as const;

  return (
    <section className="section section-muted min-h-[70vh]">
      <div className="container max-w-5xl">
        <p className="eyebrow">{t("forYoungPeople.label")}</p>
        <h1 className="mt-4 max-w-3xl text-[2.35rem] font-extrabold leading-[1.08] tracking-[-0.035em] text-ink sm:text-[3.4rem]">
          {t("forYoungPeople.title")}
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-8 text-muted sm:text-lg">
          {t("forYoungPeople.description")}
        </p>

        <div className="mt-9 grid gap-5 md:grid-cols-2">
          {paths.map(({ key, href }) => (
            <article key={key} className="card flex min-w-0 flex-col p-6 sm:p-8">
              <p className="eyebrow">{t(`forYoungPeople.paths.${key}.age`)}</p>
              <h2 className="mt-3 text-2xl font-bold text-ink">
                {t(`forYoungPeople.paths.${key}.title`)}
              </h2>
              <p className="mt-4 flex-1 text-sm leading-7 text-muted sm:text-base">
                {t(`forYoungPeople.paths.${key}.description`)}
              </p>
              <Link href={href} className="button-primary mt-6 w-fit">
                {t(`forYoungPeople.paths.${key}.action`)}
              </Link>
            </article>
          ))}
        </div>

        <p className="mt-6 text-sm leading-7 text-muted">{t("forYoungPeople.accountNote")}</p>
      </div>
    </section>
  );
}
