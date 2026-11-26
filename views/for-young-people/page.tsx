import Link from "next/link";
import { useTranslation } from "@/lib/i18n/client";

export default function ForYoungPeoplePage() {
  const { t } = useTranslation();
  const paths = [
    { key: "secondary", href: "/garden" },
    { key: "youngAdults", href: "/for-young-adults" },
  ] as const;

  return (
    <section aria-label={t("forYoungPeople.label")} className="section section-muted min-h-[70vh] py-6 sm:py-12">
      <div className="container max-w-5xl">
        <h1 className="max-w-3xl text-balance text-3xl font-extrabold leading-tight tracking-tight text-ink sm:text-5xl">
          {t("forYoungPeople.title")}
        </h1>
        <p className="mt-3 hidden max-w-3xl text-base leading-7 text-muted sm:block">
          {t("forYoungPeople.description")}
        </p>

        <div className="mt-5 grid gap-3 sm:mt-8 sm:gap-5 md:grid-cols-2">
          {paths.map(({ key, href }) => (
            <article key={key} className="card flex min-w-0 flex-col p-4 sm:p-6">
              <p className="text-sm font-bold text-sage-dark">{t(`forYoungPeople.paths.${key}.age`)}</p>
              <h2 className="mt-1 text-balance text-xl font-bold leading-tight text-ink sm:text-2xl">
                {t(`forYoungPeople.paths.${key}.title`)}
              </h2>
              <p className="mt-2 flex-1 text-base leading-6 text-muted">
                {t(`forYoungPeople.paths.${key}.description`)}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <Link href={href} className="button-primary">{t(`forYoungPeople.paths.${key}.action`)}</Link>
                {key === "secondary" && (
                  <Link href="/for-teens" className="text-sm font-bold text-sage-dark underline underline-offset-4">
                    {t("forYoungPeople.paths.secondary.learnMore")}
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>

        <p className="mt-6 text-sm leading-7 text-muted">{t("forYoungPeople.accountNote")}</p>
      </div>
    </section>
  );
}
