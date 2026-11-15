import type { GetServerSideProps } from "next";
import { isReportUiPreviewEnabled } from "@/lib/reportPreview";
import ReportsPreviewPage from "@/views/reports-preview/page";

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader("Cache-Control", "private, no-store, max-age=0, must-revalidate");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (!isReportUiPreviewEnabled()) return { notFound: true };
  return { props: {} };
};

export default ReportsPreviewPage;
