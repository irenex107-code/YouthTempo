import Link from "next/link";
import { useState } from "react";
import { InfoCard } from "@/components/Cards";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { useTranslation } from "@/lib/i18n/client";

export default function Home() {
  const { t } = useTranslation();
  const audienceCards = [
    { title: t("home.audiences.teens.title"), label: t("home.audiences.teens.label"), text: t("home.audiences.teens.text"), href: "/for-teens", action: t("home.audiences.teens.action") },
    { title: t("home.audiences.parents.title"), label: t("home.audiences.parents.label"), text: t("home.audiences.parents.text"), href: "/for-parents", action: t("home.audiences.parents.action") },
    { title: t("home.audiences.teachers.title"), label: t("home.audiences.teachers.label"), text: t("home.audiences.teachers.text"), href: "/for-teachers", action: t("home.audiences.teachers.action") },
  ];
  const supportSteps = [
    { title: t("home.support.steps.daily.title"), label: t("home.support.steps.daily.label"), text: t("home.support.steps.daily.text") },
    { title: t("home.support.steps.feelings.title"), label: t("home.support.steps.feelings.label"), text: t("home.support.steps.feelings.text") },
    { title: t("home.support.steps.people.title"), label: t("home.support.steps.people.label"), text: t("home.support.steps.people.text") },
  ];
  const demoOptions = [
    { id: "steady", label: t("home.demo.options.steady.label"), summary: t("home.demo.options.steady.summary"), step: t("home.demo.options.steady.step") },
    { id: "slow", label: t("home.demo.options.slow.label"), summary: t("home.demo.options.slow.summary"), step: t("home.demo.options.slow.step") },
    { id: "stuck", label: t("home.demo.options.stuck.label"), summary: t("home.demo.options.stuck.summary"), step: t("home.demo.options.stuck.step") },
  ] as const;
  const [demoChoice, setDemoChoice] = useState<(typeof demoOptions)[number]["id"]>("slow");
  const demoResult = demoOptions.find((item) => item.id === demoChoice) ?? demoOptions[1];

  return (
    <>
      <PageHero
        label={t("home.hero.label")}
        title={t("home.hero.title")}
        subtitle={t("home.hero.description")}
        action={
          <>
            <Link href="/check-in" className="button-primary">{t("home.hero.primaryAction")}</Link>
            <Link href="/sweet-model" className="button-secondary">{t("home.hero.secondaryAction")}</Link>
          </>
        }
        aside={
          <IllustrationPanel
            src="/illustrations/system/hero-home-journey.webp"
            alt={t("home.hero.imageAlt")}
            priority
          />
        }
      />

      <section className="section section-muted">
        <div className="container grid items-center gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-12">
          <div>
            <p className="eyebrow">{t("home.demo.eyebrow")}</p>
            <h2 className="mt-3 max-w-2xl text-[1.8rem] font-bold leading-[1.25] text-ink sm:text-[2.35rem]">
              {t("home.demo.title")}
            </h2>
            <p className="mt-4 max-w-2xl text-[0.95rem] leading-7 text-muted">
              {t("home.demo.description")}
            </p>
            <ol className="mt-6 grid gap-3 text-sm font-bold text-ink/80 sm:grid-cols-3 lg:grid-cols-1">
              <li className="rounded-2xl bg-white/75 px-4 py-3"><span className="mr-2 text-sage">1</span>{t("home.demo.progress.choose")}</li>
              <li className="rounded-2xl bg-white/75 px-4 py-3"><span className="mr-2 text-sage">2</span>{t("home.demo.progress.notice")}</li>
              <li className="rounded-2xl bg-white/75 px-4 py-3"><span className="mr-2 text-sage">3</span>{t("home.demo.progress.act")}</li>
            </ol>
          </div>

          <div className="card">
            <p className="text-xs font-extrabold text-sage-dark">{t("home.demo.panel.chooseLabel")}</p>
            <p className="mt-2 text-base font-bold text-ink">{t("home.demo.panel.question")}</p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label={t("home.demo.panel.ariaLabel")}>
              {demoOptions.map((item) => {
                const selected = demoChoice === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`min-h-12 rounded-2xl border px-4 py-3 text-sm font-bold transition ${
                      selected
                        ? "border-sage bg-mist text-sage-dark"
                        : "border-ink/10 bg-white text-ink/70 hover:border-sage/50"
                    }`}
                    aria-pressed={selected}
                    onClick={() => setDemoChoice(item.id)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-5 border-t border-ink/10 pt-5" aria-live="polite">
              <p className="text-xs font-extrabold text-sage-dark">{t("home.demo.panel.noticeLabel")}</p>
              <p className="mt-2 text-base font-bold leading-7 text-ink">{demoResult.summary}</p>
              <div className="mt-4 rounded-2xl bg-cream-deep/65 p-4">
                <p className="text-xs font-extrabold text-sage-dark">{t("home.demo.panel.actLabel")}</p>
                <p className="mt-2 text-[0.95rem] font-bold leading-7 text-ink/80">{demoResult.step}</p>
              </div>
            </div>
            <Link href="/check-in" className="button-primary mt-5 w-full sm:w-auto">{t("home.demo.panel.fullAction")}</Link>
          </div>
        </div>
      </section>

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
