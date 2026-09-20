import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { getAccountStatus } from "@/lib/cloudRecords";
import { useTranslation } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

const previewRoles = ["minor", "adult", "guardian", "teacher", "schoolLead", "professional"] as const;
type PreviewRole = (typeof previewRoles)[number];

type PublicPage = { href: string; label: TranslationKey };

const publicPages: Record<PreviewRole, PublicPage[]> = {
  minor: [
    { href: "/for-teens", label: "adminRolePreview.pages.teen" },
    { href: "/check-in", label: "adminRolePreview.pages.checkIn" },
    { href: "/garden", label: "adminRolePreview.pages.garden" },
    { href: "/mood-journal", label: "adminRolePreview.pages.mood" },
    { href: "/worry-time", label: "adminRolePreview.pages.worry" },
    { href: "/community", label: "adminRolePreview.pages.community" },
    { href: "/support-request", label: "adminRolePreview.pages.supportRequest" },
  ],
  adult: [
    { href: "/for-young-adults", label: "adminRolePreview.pages.adult" },
    { href: "/check-in", label: "adminRolePreview.pages.checkIn" },
    { href: "/garden", label: "adminRolePreview.pages.garden" },
    { href: "/peer-space", label: "adminRolePreview.pages.peerSpace" },
    { href: "/consultation", label: "adminRolePreview.pages.consultation" },
  ],
  guardian: [
    { href: "/for-parents", label: "adminRolePreview.pages.parent" },
    { href: "/talk", label: "adminRolePreview.pages.talk" },
    { href: "/resources", label: "adminRolePreview.pages.resources" },
  ],
  teacher: [
    { href: "/for-teachers", label: "adminRolePreview.pages.teacher" },
    { href: "/community", label: "adminRolePreview.pages.community" },
    { href: "/referral", label: "adminRolePreview.pages.referral" },
    { href: "/resources", label: "adminRolePreview.pages.resources" },
  ],
  schoolLead: [
    { href: "/for-teachers", label: "adminRolePreview.pages.teacher" },
    { href: "/resources", label: "adminRolePreview.pages.resources" },
  ],
  professional: [
    { href: "/support/apply", label: "adminRolePreview.pages.apply" },
    { href: "/referral", label: "adminRolePreview.pages.referral" },
    { href: "/resources", label: "adminRolePreview.pages.resources" },
  ],
};

export default function AdminRolePreviewPage() {
  const { t } = useTranslation();
  const [access, setAccess] = useState<"loading" | "allowed" | "denied">("loading");
  const [role, setRole] = useState<PreviewRole>("minor");

  useEffect(() => {
    let active = true;
    getAccountStatus()
      .then((status) => {
        if (active) setAccess(status.adminAccess?.scope === "platform" ? "allowed" : "denied");
      })
      .catch(() => { if (active) setAccess("denied"); });
    return () => { active = false; };
  }, []);

  return (
    <>
      <PageHero
        label={t("adminRolePreview.label")}
        title={t("adminRolePreview.title")}
        subtitle={t("adminRolePreview.description")}
        action={<Link href="/admin" className="button-secondary">{t("adminRolePreview.back")}</Link>}
      />
      <section className="section section-muted">
        <div className="container max-w-6xl">
          {access === "loading" ? <p className="card" role="status">{t("adminRolePreview.loading")}</p> : null}
          {access === "denied" ? (
            <div className="card max-w-2xl">
              <h2 className="text-2xl font-bold text-ink">{t("adminRolePreview.deniedTitle")}</h2>
              <p className="mt-3 text-sm leading-7 text-muted">{t("adminRolePreview.deniedDescription")}</p>
              <Link href="/account" className="button-primary mt-5">{t("adminRolePreview.signIn")}</Link>
            </div>
          ) : null}
          {access === "allowed" ? (
            <>
              <p className="rounded-2xl border border-sage/25 bg-mint/50 px-5 py-4 text-sm leading-7 text-sage-dark" role="note">
                {t("adminRolePreview.notice")}
              </p>
              <div className="mt-8">
                <h2 className="text-xl font-bold text-ink">{t("adminRolePreview.chooseRole")}</h2>
                <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t("adminRolePreview.chooseRole")}>
                  {previewRoles.map((candidate) => (
                    <button
                      key={candidate}
                      type="button"
                      aria-pressed={role === candidate}
                      className={`rounded-full border px-4 py-2 text-sm font-bold transition ${role === candidate ? "border-sage-dark bg-sage-dark text-white" : "border-ink/10 bg-white text-ink hover:border-sage"}`}
                      onClick={() => setRole(candidate)}
                    >
                      {t(`adminRolePreview.roles.${candidate}.title`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <article className="card min-w-0">
                  <p className="eyebrow">{t("adminRolePreview.exampleLabel")}</p>
                  <h2 className="mt-3 text-2xl font-bold text-ink">{t(`adminRolePreview.roles.${role}.workspace`)}</h2>
                  <p className="mt-3 text-sm leading-7 text-muted">{t(`adminRolePreview.roles.${role}.description`)}</p>
                  <div className="mt-6 grid gap-3">
                    {(["first", "second", "third"] as const).map((step) => (
                      <div key={step} className="rounded-2xl border border-ink/10 bg-cream/70 px-4 py-4 text-sm leading-7 text-ink">
                        {t(`adminRolePreview.roles.${role}.${step}`)}
                      </div>
                    ))}
                  </div>
                </article>
                <aside className="card min-w-0">
                  <h2 className="text-xl font-bold text-ink">{t("adminRolePreview.publicPages")}</h2>
                  <p className="mt-2 text-sm leading-7 text-muted">{t("adminRolePreview.publicPagesNote")}</p>
                  <div className="mt-5 grid gap-2">
                    {publicPages[role].map((page) => (
                      <Link key={page.href} href={page.href} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-ink/10 bg-white px-4 py-3 text-sm font-bold text-sage-dark transition hover:border-sage">
                        <span>{t(page.label)}</span><span aria-hidden="true">↗</span>
                      </Link>
                    ))}
                  </div>
                  <p className="mt-5 text-xs leading-6 text-muted">{t("adminRolePreview.realAccessNote")}</p>
                </aside>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </>
  );
}
