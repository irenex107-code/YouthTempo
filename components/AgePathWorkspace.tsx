import Link from "next/link";
import { useEffect, useState } from "react";
import { peerSpaceRequest } from "@/lib/peerSpaceClient";
import { useTranslation } from "@/lib/i18n/client";

const minorCards = [
  ["ageWorkspace.minor.cards.quick", "/garden"],
  ["ageWorkspace.minor.cards.people", "/messages"],
  ["ageWorkspace.minor.cards.network", "/support-request"],
  ["ageWorkspace.minor.cards.community", "/community"],
  ["ageWorkspace.minor.cards.garden", "/garden"],
  ["ageWorkspace.minor.cards.urgent", "/resources"],
] as const;

const adultCards = [
  ["ageWorkspace.adult.cards.room", "/peer-space"],
  ["ageWorkspace.adult.cards.peers", "/community"],
  ["ageWorkspace.adult.cards.quick", "/garden"],
  ["ageWorkspace.adult.cards.rhythm", "/garden"],
  ["ageWorkspace.adult.cards.support", "/consultation"],
] as const;

export function AgePathWorkspace({ ageBand }: { ageBand: "14_17" | "18_plus" }) {
  const { locale, t } = useTranslation();
  const isAdult = ageBand === "18_plus";
  const [peerSpaceAvailable, setPeerSpaceAvailable] = useState(false);
  const cards = isAdult
    ? adultCards.filter(([key]) => key !== "ageWorkspace.adult.cards.room" || peerSpaceAvailable)
    : minorCards;

  useEffect(() => {
    setPeerSpaceAvailable(false);
    if (!isAdult) return;
    let active = true;
    peerSpaceRequest<{ available: boolean }>("/api/peer-space/access", locale)
      .then((access) => { if (active) setPeerSpaceAvailable(access.available === true); })
      .catch(() => { if (active) setPeerSpaceAvailable(false); });
    return () => { active = false; };
  }, [isAdult, locale]);

  return (
    <section className="px-4 pb-7 pt-6 sm:px-8 lg:px-12" aria-labelledby="age-path-title">
      <div className="container">
        <p className="eyebrow">{t("ageWorkspace.label")}</p>
        <h2 id="age-path-title" className="mt-3 text-2xl font-bold text-ink sm:text-3xl">
          {t(isAdult ? "ageWorkspace.adult.title" : "ageWorkspace.minor.title")}
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
          {t(isAdult ? "ageWorkspace.adult.description" : "ageWorkspace.minor.description")}
        </p>
        <div className="mt-6 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(([key, href]) => (
            <article key={key} className="card flex min-w-0 flex-col">
              <h3 className="text-lg font-bold text-ink">{t(`${key}.title`)}</h3>
              <p className="mt-2 flex-1 text-sm leading-7 text-muted">{t(`${key}.text`)}</p>
              <Link href={href} className="button-secondary mt-5 w-fit text-sm">
                {t(`${key}.action`)}
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
