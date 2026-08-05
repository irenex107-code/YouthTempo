import Link from "next/link";
import { InfoCard } from "@/components/Cards";
import { FeatureIllustration, IllustrationPanel } from "@/components/IllustrationPanel";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { useTranslation } from "@/lib/i18n/client";

export default function ForParentsPage() {
  const { t } = useTranslation();
  const sweetObservations = [
    { letter: "S", title: t("forParents.sweet.items.sleep.title"), question: t("forParents.sweet.items.sleep.question"), text: t("forParents.sweet.items.sleep.text") },
    { letter: "W", title: t("forParents.sweet.items.wake.title"), question: t("forParents.sweet.items.wake.question"), text: t("forParents.sweet.items.wake.text") },
    { letter: "E", title: t("forParents.sweet.items.eat.title"), question: t("forParents.sweet.items.eat.question"), text: t("forParents.sweet.items.eat.text") },
    { letter: "E", title: t("forParents.sweet.items.exercise.title"), question: t("forParents.sweet.items.exercise.question"), text: t("forParents.sweet.items.exercise.text") },
    { letter: "T", title: t("forParents.sweet.items.task.title"), question: t("forParents.sweet.items.task.question"), text: t("forParents.sweet.items.task.text") },
  ];
  const aidetSteps = [
    { step: "01", title: "Acknowledge", label: t("forParents.aidet.items.acknowledge.label"), example: t("forParents.aidet.items.acknowledge.example") },
    { step: "02", title: "Introduce", label: t("forParents.aidet.items.introduce.label"), example: t("forParents.aidet.items.introduce.example") },
    { step: "03", title: "Duration", label: t("forParents.aidet.items.duration.label"), example: t("forParents.aidet.items.duration.example") },
    { step: "04", title: "Explanation", label: t("forParents.aidet.items.explanation.label"), example: t("forParents.aidet.items.explanation.example") },
    { step: "05", title: "Thank you", label: t("forParents.aidet.items.thankYou.label"), example: t("forParents.aidet.items.thankYou.example") },
  ];
  const phrases = [
    t("forParents.conversation.phrases.one"),
    t("forParents.conversation.phrases.two"),
    t("forParents.conversation.phrases.three"),
    t("forParents.conversation.phrases.four"),
  ];
  const parentStarts = [
    { title: t("forParents.starts.items.daily.title"), text: t("forParents.starts.items.daily.text"), illustration: "/illustrations/system/parent-observe-sweet-v3.webp", alt: t("forParents.starts.items.daily.alt") },
    { title: t("forParents.starts.items.listen.title"), text: t("forParents.starts.items.listen.text"), illustration: "/illustrations/system/parent-safe-listening.webp", alt: t("forParents.starts.items.listen.alt") },
    { title: t("forParents.starts.items.conversation.title"), text: t("forParents.starts.items.conversation.text"), illustration: "/illustrations/system/parent-aidet-conversation.webp", alt: t("forParents.starts.items.conversation.alt") },
    { title: t("forParents.starts.items.support.title"), text: t("forParents.starts.items.support.text"), illustration: "/illustrations/system/parent-connect-support.webp", alt: t("forParents.starts.items.support.alt") },
  ];

  return (
    <>
      <PageHero
        label={t("forParents.hero.label")}
        title={t("forParents.hero.title")}
        subtitle={t("forParents.hero.description")}
        action={
          <>
            <Link href="/account" className="button-primary">{t("forParents.hero.primaryAction")}</Link>
            <Link href="/sweet-model" className="button-secondary">{t("forParents.hero.secondaryAction")}</Link>
          </>
        }
        aside={
          <IllustrationPanel
            src="/illustrations/system/role-parent.webp"
            alt={t("forParents.hero.imageAlt")}
            priority
          />
        }
      />

      <section className="section section-muted">
        <div className="container grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <InfoCard title={t("forParents.intro.visibleTitle")}>
            {t("forParents.intro.visibleText")}
          </InfoCard>
          <InfoCard title={t("forParents.intro.concreteTitle")}>
            {t("forParents.intro.concreteText")}
          </InfoCard>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            title={t("forParents.starts.title")}
            description={t("forParents.starts.description")}
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {parentStarts.map((item) => (
              <article key={item.title} className="card flex h-full flex-col">
                <FeatureIllustration src={item.illustration} alt={item.alt} compact />
                <h3 className="mt-5 text-[1.05rem] font-bold leading-snug text-ink sm:text-[1.18rem]">{item.title}</h3>
                <p className="mt-3 text-[0.95rem] leading-7 text-muted">{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-muted pt-8 sm:pt-12">
        <div className="container rounded-2xl border border-sage/25 bg-white/85 p-5 shadow-soft sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div>
            <h2 className="text-xl font-bold text-ink">{t("forParents.messages.title")}</h2>
            <p className="mt-2 text-sm leading-7 text-muted">{t("forParents.messages.description")}</p>
          </div>
          <Link href="/messages" className="button-primary mt-4 w-full sm:mt-0 sm:w-auto">{t("forParents.messages.action")}</Link>
        </div>
      </section>

      <section className="section pt-8 sm:pt-12">
        <div className="container rounded-[1.75rem] border border-sage/20 bg-white p-5 shadow-soft sm:flex sm:items-center sm:justify-between sm:gap-6 sm:p-6">
          <div><h2 className="text-lg font-bold text-ink">{t("forParents.feedback.title")}</h2><p className="mt-2 text-sm leading-7 text-muted">{t("forParents.feedback.description")}</p></div>
          <Link href="/feedback" className="button-secondary mt-4 w-full sm:mt-0 sm:w-auto">{t("forParents.feedback.action")}</Link>
        </div>
      </section>

      <section className="section section-muted" data-section="sweet-observations">
        <div className="container">
          <SectionHeader
            title={t("forParents.sweet.title")}
            description={t("forParents.sweet.description")}
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {sweetObservations.map((item) => (
              <article
                key={item.title}
                className="group flex flex-col rounded-[1.75rem] border border-ink/[0.08] bg-white/90 p-5 shadow-soft transition hover:-translate-y-1 hover:border-sage/30 hover:bg-white hover:shadow-lift lg:min-h-[19rem]"
              >
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex h-12 min-w-12 items-center justify-center rounded-2xl bg-mist px-3 text-xl font-extrabold text-sage-dark">{item.letter}</span>
                  <span className="text-xs font-extrabold tracking-[0.16em] text-sage-dark">SWEET</span>
                </div>
                <h3 className="text-[1.05rem] font-extrabold leading-snug text-ink">{item.title}</h3>
                <p className="mt-3 text-[0.95rem] font-bold leading-7 text-sage-dark">{item.question}</p>
                <div className="mt-5 flex-1 rounded-2xl bg-mist/55 p-4">
                  <p className="text-[0.92rem] leading-7 text-ink/75">{item.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section" data-section="aidet-conversation">
        <div className="container">
          <SectionHeader
            title={t("forParents.aidet.title")}
            description={t("forParents.aidet.description")}
          />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {aidetSteps.map((item) => (
              <article
                key={item.title}
                className="group flex flex-col rounded-[1.75rem] border border-ink/[0.08] bg-white/90 p-5 shadow-soft transition hover:-translate-y-1 hover:border-sage/30 hover:bg-white hover:shadow-lift lg:min-h-[19rem]"
              >
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex h-12 min-w-12 items-center justify-center rounded-2xl bg-cream-deep/75 px-3 text-sm font-extrabold text-sage-dark">{item.step}</span>
                  <span className="text-xs font-extrabold tracking-[0.16em] text-sage-dark">AIDET</span>
                </div>
                <h3 className="text-[1.05rem] font-extrabold leading-snug text-ink">{item.title}</h3>
                <p className="mt-3 text-[0.95rem] font-bold leading-7 text-sage-dark">{item.label}</p>
                <div className="mt-5 flex-1 rounded-2xl bg-cream-deep/65 p-4">
                  <p className="text-[0.92rem] font-bold leading-7 text-ink/75">“{item.example}”</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="conversation" className="section section-muted scroll-mt-24">
        <div className="container">
          <SectionHeader
            title={t("forParents.conversation.title")}
            description={t("forParents.conversation.description")}
          />
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {phrases.map((phrase) => (
              <blockquote key={phrase} className="rounded-2xl border border-ink/10 bg-white/80 p-5 text-[0.95rem] font-bold leading-7 text-ink/80 shadow-soft">
                “{phrase}”
              </blockquote>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container grid gap-6 lg:grid-cols-[1fr_0.7fr]">
          <InfoCard title={t("forParents.furtherSupport.title")} label={t("forParents.furtherSupport.label")}>
            {t("forParents.furtherSupport.text")}
          </InfoCard>
          <div className="card">
            <h3 className="text-xl font-bold text-ink">{t("forParents.oneThing.title")}</h3>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">
              {t("forParents.oneThing.text")}
            </p>
          </div>
          <div className="card lg:col-span-2">
            <h3 className="text-xl font-bold text-ink">{t("forParents.resources.title")}</h3>
            <p className="mt-4 max-w-3xl text-[0.95rem] leading-7 text-muted">
              {t("forParents.resources.text")}
            </p>
            <Link href="/resources" className="button-secondary mt-6">
              {t("forParents.resources.action")}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
