import Link from "next/link";
import { PageHero } from "@/components/PageHero";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { SectionHeader } from "@/components/SectionHeader";
import { useTranslation } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

type ResourceItem = {
  titleKey: TranslationKey;
  textKey: TranslationKey;
  href?: string;
  actionKey?: TranslationKey;
};

type ResourceGroup = {
  titleKey: TranslationKey;
  items: ResourceItem[];
};

const resourceGroups: ResourceGroup[] = [
  {
    titleKey: "resources.groups.parents.title",
    items: [
      {
        titleKey: "resources.groups.parents.items.rhythm.title",
        textKey: "resources.groups.parents.items.rhythm.text",
        href: "/for-parents",
        actionKey: "resources.groups.parents.items.rhythm.action",
      },
      {
        titleKey: "resources.groups.parents.items.communication.title",
        textKey: "resources.groups.parents.items.communication.text",
        href: "/for-parents",
        actionKey: "resources.groups.parents.items.communication.action",
      },
      {
        titleKey: "resources.groups.parents.items.support.title",
        textKey: "resources.groups.parents.items.support.text",
        href: "/referral",
        actionKey: "resources.groups.parents.items.support.action",
      },
    ],
  },
  {
    titleKey: "resources.groups.school.title",
    items: [
      {
        titleKey: "resources.groups.school.items.changes.title",
        textKey: "resources.groups.school.items.changes.text",
      },
      {
        titleKey: "resources.groups.school.items.respond.title",
        textKey: "resources.groups.school.items.respond.text",
      },
      {
        titleKey: "resources.groups.school.items.boundaries.title",
        textKey: "resources.groups.school.items.boundaries.text",
      },
    ],
  },
];

export default function ResourcesPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHero
        title={t("resources.hero.title")}
        subtitle={t("resources.hero.description")}
        aside={
          <IllustrationPanel
            src="/illustrations/system/feature-resources.webp"
            alt={t("resources.hero.imageAlt")}
            priority
          />
        }
      />
      <section className="section section-muted pb-0">
        <div className="container grid gap-4 md:grid-cols-2">
          <div className="card">
            <p className="eyebrow">{t("resources.intro.daily.label")}</p>
            <h2 className="mt-2 text-xl font-bold text-ink">{t("resources.intro.daily.title")}</h2>
            <p className="mt-3 text-sm leading-7 text-muted">{t("resources.intro.daily.text")}</p>
          </div>
          <div className="card">
            <p className="eyebrow">{t("resources.intro.help.label")}</p>
            <h2 className="mt-2 text-xl font-bold text-ink">{t("resources.intro.help.title")}</h2>
            <p className="mt-3 text-sm leading-7 text-muted">{t("resources.intro.help.text")}</p>
            <Link href="/referral" className="button-primary mt-5 px-4 py-2 text-xs">{t("resources.intro.help.action")}</Link>
          </div>
        </div>
      </section>
      {resourceGroups.map((group, index) => (
        <section key={group.titleKey} className={`section ${index % 2 === 0 ? "section-muted" : ""}`}>
          <div className="container">
            <SectionHeader title={t(group.titleKey)} />
            <div className="grid gap-4 md:grid-cols-3">
              {group.items.map((item) => (
                <article key={item.titleKey} className="card flex flex-col">
                  <h3 className="text-lg font-bold leading-snug text-ink">{t(item.titleKey)}</h3>
                  <p className="mt-3 flex-1 text-[0.95rem] leading-7 text-muted">{t(item.textKey)}</p>
                  {item.href && item.actionKey ? (
                    <Link href={item.href} className="button-secondary mt-5 w-fit px-4 py-2 text-xs">
                      {t(item.actionKey)}
                    </Link>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </section>
      ))}
      <section className="section section-muted">
        <div className="container rounded-2xl border border-sage/25 bg-white/85 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div>
            <h2 className="text-xl font-bold text-ink">{t("resources.support.title")}</h2>
            <p className="mt-2 text-sm leading-7 text-muted">{t("resources.support.text")}</p>
          </div>
          <Link href="/referral" className="button-primary mt-4 w-full sm:mt-0 sm:w-auto">{t("resources.support.action")}</Link>
        </div>
      </section>
    </>
  );
}
