import type { AppProps } from "next/app";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";
import "@/views/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className="page-shell">
      <Navbar />
      <main>
        <Component {...pageProps} />
      </main>
      <Footer />
    </div>
  );
}
