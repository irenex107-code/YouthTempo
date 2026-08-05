import type { AppProps } from "next/app";
import Head from "next/head";
import { useRouter } from "next/router";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";
import { I18nProvider } from "@/lib/i18n/client";
import "@/views/globals.css";

const pageTitles: Record<string, string> = {
  "/": "YouthTempo | 更早开始的青少年支持",
  "/for-teens": "青少年入口 | YouthTempo",
  "/for-parents": "家长入口 | YouthTempo",
  "/for-teachers": "老师入口 | YouthTempo",
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
  const router = useRouter();
  const title = pageTitles[router.pathname] ?? "YouthTempo";

  return (
    <I18nProvider>
      <Head>
        <title>{title}</title>
        <meta
          name="description"
          content="YouthTempo 从日常节律开始，帮助青少年看见状态、表达感受，并更容易连接可信任的支持。"
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
    </I18nProvider>
  );
}
