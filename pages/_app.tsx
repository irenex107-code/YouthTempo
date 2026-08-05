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
};

const remainingPageTitles: Record<string, string> = {
  "/sweet-model": "SWEET 模型 | YouthTempo",
  "/check-in": "SWEET 节律记录 | YouthTempo",
  "/mood-journal": "心情拼图 | YouthTempo",
  "/talk": "陪我捋一捋 | YouthTempo",
  "/messages": "悄悄话信箱 | YouthTempo",
  "/worry-time": "今晚先放下 | YouthTempo",
  "/referral": "下一步找谁 | YouthTempo",
  "/resources": "家校陪伴指南 | YouthTempo",
  "/community": "家校医社区 | YouthTempo",
  "/privacy-safety": "隐私与安全 | YouthTempo",
  "/contact": "联系我们 | YouthTempo",
  "/account": "账号 | YouthTempo",
  "/feedback": "试点反馈 | YouthTempo",
  "/admin": "管理工作台 | YouthTempo",
};

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
