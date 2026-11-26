import Link from "next/link";
import { StudentActions } from "@/components/StudentActions";
import { useEffect, useState } from "react";
import { peerSpaceRequest } from "@/lib/peerSpaceClient";
import { useTranslation } from "@/lib/i18n/client";

const minorCards = [
  ["ageWorkspace.minor.cards.people", "/messages"],
  ["ageWorkspace.minor.cards.network", "/support-request"],
  ["ageWorkspace.minor.cards.community", "/community"],
  ["ageWorkspace.minor.cards.urgent", "/resources"],
] as const;

const adultCards = [
  ["ageWorkspace.adult.cards.room", "/peer-space"],
  ["ageWorkspace.adult.cards.peers", "/community"],
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
        <h2 id="age-path-title" className="mt-3 text-2xl font-bold text-ink sm:text-3xl">
          {t(isAdult ? "ageWorkspace.adult.title" : "ageWorkspace.minor.title")}
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
          {t(isAdult ? "ageWorkspace.adult.description" : "ageWorkspace.minor.description")}
        </p>
        <StudentActions adult={isAdult} recordHref={isAdult ? "/garden?audience=adult" : "/garden"} />
        <details>
          <summary className="w-fit cursor-pointer text-sm font-bold text-sage-dark">{t("studentActions.more")}</summary>
          <div className="mt-3 flex flex-wrap gap-4">
            {cards.map(([key, href]) => <Link key={key} href={href} className="text-sm underline">{t(`${key}.title`)}</Link>)}
            <Link href="/worry-time" className="text-sm underline">{t("forTeens.start.cards.worry.title")}</Link>
          </div>
        </details>
      </div>
    </section>
  );
}
