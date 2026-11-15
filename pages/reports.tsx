import type { GetServerSideProps } from "next";
import { isReportsLocalIntegrationEnabled } from "@/lib/reports/availability";
import ReportsPage from "@/views/reports/page";

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (!isReportsLocalIntegrationEnabled()) return { notFound: true };
  return { props: {} };
};

export default ReportsPage;
