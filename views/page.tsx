import Link from "next/link";
import { InfoCard } from "@/components/Cards";
import { GardenWelcome } from "@/components/garden/GardenWelcome";
import { SectionHeader } from "@/components/SectionHeader";
import { useTranslation } from "@/lib/i18n/client";

export default function Home() {
  const { t } = useTranslation();
  const audienceCards = [
    { title: t("home.audiences.teens.title"), label: t("home.audiences.teens.label"), text: t("home.audiences.teens.text"), href: "/for-young-people", action: t("home.audiences.teens.action") },
    { title: t("home.audiences.parents.title"), label: t("home.audiences.parents.label"), text: t("home.audiences.parents.text"), href: "/for-parents", action: t("home.audiences.parents.action") },
    { title: t("home.audiences.teachers.title"), label: t("home.audiences.teachers.label"), text: t("home.audiences.teachers.text"), href: "/for-teachers", action: t("home.audiences.teachers.action") },
  ];
  const supportSteps = [
    { title: t("home.support.steps.daily.title"), label: t("home.support.steps.daily.label"), text: t("home.support.steps.daily.text") },
    { title: t("home.support.steps.feelings.title"), label: t("home.support.steps.feelings.label"), text: t("home.support.steps.feelings.text") },
    { title: t("home.support.steps.people.title"), label: t("home.support.steps.people.label"), text: t("home.support.steps.people.text") },
  ];

  return (
    <>
      <GardenWelcome home />

      <section className="section">
        <div className="container">
          <SectionHeader
            label={t("home.dailyChanges.label")}
            title={t("home.dailyChanges.title")}
            description={t("home.dailyChanges.description")}
          />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            label={t("home.audiences.label")}
            title={t("home.audiences.title")}
            description={t("home.audiences.description")}
          />
          <div className="grid gap-6 md:grid-cols-3">
            {audienceCards.map((item) => (
              <Link key={item.title} href={item.href} className="card group flex h-full flex-col transition hover:-translate-y-1 hover:border-sage/30 hover:shadow-lift focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sage/25">
                <p className="eyebrow">{item.label}</p>
                <h3 className="mt-3 text-xl font-bold text-ink">{item.title}</h3>
                <p className="mt-4 flex-1 text-[0.95rem] leading-7 text-muted">{item.text}</p>
                <span className="mt-6 text-sm font-bold text-sage-dark group-hover:text-sage">{item.action} →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted">
        <div className="container">
          <SectionHeader
            label={t("home.support.label")}
            title={t("home.support.title")}
            description={t("home.support.description")}
          />
          <div className="grid gap-6 md:grid-cols-3">
            {supportSteps.map((item) => (
              <InfoCard key={item.title} title={item.title} label={item.label}>
                {item.text}
              </InfoCard>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="section">
        <div className="container grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="eyebrow">{t("home.principles.label")}</p>
            <h2 className="mt-3 max-w-3xl text-[1.8rem] font-bold leading-[1.25] text-ink sm:text-[2.35rem]">
              {t("home.principles.title")}
            </h2>
          </div>
          <InfoCard title={t("home.principles.cardTitle")} label={t("home.principles.cardLabel")}>
            <ol className="space-y-4 font-bold text-ink/80">
              <li>{t("home.principles.items.one")}</li>
              <li>{t("home.principles.items.two")}</li>
              <li>{t("home.principles.items.three")}</li>
            </ol>
          </InfoCard>
        </div>
      </section>
    </>
  );
}
