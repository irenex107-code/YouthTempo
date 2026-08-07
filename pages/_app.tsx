import type { AppProps } from "next/app";
import Head from "next/head";
import { useRouter } from "next/router";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";
import { I18nProvider, useTranslation } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import "@/views/globals.css";

const translatedPageTitleKeys: Partial<Record<string, TranslationKey>> = {
  "/": "home.metadata.title",
  "/for-teens": "forTeens.metadata.title",
  "/for-parents": "forParents.metadata.title",
  "/for-teachers": "forTeachers.metadata.title",
  "/for-young-adults": "forYoungAdults.metadata.title",
  "/sweet-model": "sweetModel.metadata.title",
  "/check-in": "checkIn.metadata.title",
  "/mood-journal": "moodJournal.metadata.title",
  "/talk": "talk.metadata.title",
  "/worry-time": "worryTime.metadata.title",
  "/referral": "referral.metadata.title",
  "/resources": "resources.metadata.title",
  "/privacy-safety": "privacySafety.metadata.title",
  "/contact": "contact.metadata.title",
  "/community": "community.metadata.title",
  "/account": "account.metadata.title",
  "/feedback": "feedback.metadata.title",
  "/messages": "messages.metadata.title",
};

const remainingPageTitles: Record<string, string> = {
  "/admin": "管理工作台 | YouthTempo",
};

const privateOrUserContentRoutes = new Set([
  "/account", "/admin", "/check-in", "/community", "/feedback", "/messages",
  "/mood-journal", "/talk", "/worry-time",
]);

export default function App({ Component, pageProps }: AppProps) {
  return (
    <I18nProvider>
      <AppContent Component={Component} pageProps={pageProps} />
    </I18nProvider>
  );
}

type AppContentProps = Pick<AppProps, "Component" | "pageProps">;

function AppContent({ Component, pageProps }: AppContentProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const titleKey = translatedPageTitleKeys[router.pathname];
  const title = titleKey ? t(titleKey) : remainingPageTitles[router.pathname] ?? "YouthTempo";

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta
          name="description"
          content={t("common.metadata.description")}
        />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <meta name="theme-color" content="#fbf7ed" />
        {privateOrUserContentRoutes.has(router.pathname) ? (
          <meta name="robots" content="noindex, nofollow, noarchive" />
        ) : null}
      </Head>
      <div className="page-shell">
        <Navbar />
        <main>
          <Component {...pageProps} />
        </main>
        <Footer />
      </div>
    </>
  );
}
