import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  createCommunityComment,
  createCommunityPost,
  blockCommunityMember,
  deleteCommunityComment,
  deleteCommunityPost,
  getCurrentUser,
  listCommunityReports,
  listCommunityPosts,
  listCommunityBlocks,
  reportCommunityContent,
  unblockCommunityMember,
  type CommunityBlock,
  type CommunityPost,
  type CommunityReport,
  type CommunityRole,
} from "@/lib/cloudRecords";
import {
  communityReportCategories,
  communityReportCategory,
  type CommunityReportCategory,
} from "@/lib/communityReports";
import { PageHero } from "@/components/PageHero";
import { IllustrationPanel } from "@/components/IllustrationPanel";
import { useTranslation } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

const roleOptions: Array<{ key: CommunityRole; labelKey: TranslationKey; hintKey: TranslationKey }> = [
  { key: "student", labelKey: "community.roles.student.label", hintKey: "community.roles.student.hint" },
  { key: "guardian", labelKey: "community.roles.guardian.label", hintKey: "community.roles.guardian.hint" },
  { key: "teacher", labelKey: "community.roles.teacher.label", hintKey: "community.roles.teacher.hint" },
  { key: "professional", labelKey: "community.roles.professional.label", hintKey: "community.roles.professional.hint" },
];

type DeleteTarget = { type: "post" | "comment"; id: string; postId?: string } | null;
type ReportTarget = { postId?: string; commentId?: string } | null;

const communityRules: Array<[TranslationKey, TranslationKey]> = [
  ["community.rules.respect.title", "community.rules.respect.text"],
  ["community.rules.privacy.title", "community.rules.privacy.text"],
  ["community.rules.harm.title", "community.rules.harm.text"],
  ["community.rules.authentic.title", "community.rules.authentic.text"],
];

const reportCategoryCopy: Record<CommunityReportCategory, { label: TranslationKey; hint: TranslationKey }> = {
  immediate_danger: { label: "community.report.categories.immediateDanger.label", hint: "community.report.categories.immediateDanger.hint" },
  sexual_harm: { label: "community.report.categories.sexualHarm.label", hint: "community.report.categories.sexualHarm.hint" },
  bullying_threat: { label: "community.report.categories.bullying.label", hint: "community.report.categories.bullying.hint" },
  privacy_exposure: { label: "community.report.categories.privacy.label", hint: "community.report.categories.privacy.hint" },
  harmful_content: { label: "community.report.categories.harmful.label", hint: "community.report.categories.harmful.hint" },
  fraud_spam: { label: "community.report.categories.fraud.label", hint: "community.report.categories.fraud.hint" },
  other: { label: "community.report.categories.other.label", hint: "community.report.categories.other.hint" },
};

const reportPriorityCopy: Record<string, TranslationKey> = {
  urgent: "community.report.priority.urgent",
  high: "community.report.priority.high",
  standard: "community.report.priority.standard",
};

function reportStatusKey(status: string): TranslationKey {
  if (status === "resolved") return "community.report.status.resolved";
  if (status === "reviewing") return "community.report.status.reviewing";
  return "community.report.status.submitted";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function Avatar({ name, professional = false }: { name: string; professional?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      aria-hidden="true"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
        professional ? "bg-sage text-white" : "bg-mist text-sage-dark"
      }`}
    >
      {name.trim().slice(0, 1).toUpperCase() || t("community.avatarFallback")}
    </span>
  );
}

function RoleBadge({ label, verified }: { label: string; verified?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-mist px-2.5 py-1 text-[0.7rem] font-bold text-sage-dark">
      {label}{verified ? t("community.verifiedSuffix") : ""}
    </span>
  );
}

function ReportDialog({
  target,
  category,
  details,
  busy,
  onCategoryChange,
  onDetailsChange,
  onCancel,
  onConfirm,
}: {
  target: ReportTarget;
  category: CommunityReportCategory;
  details: string;
  busy: boolean;
  onCategoryChange: (value: CommunityReportCategory) => void;
  onDetailsChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!target) return undefined;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [target, busy, onCancel]);

  if (!target) return null;
  const selected = communityReportCategory(category);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/35 px-4 py-8 backdrop-blur-sm" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="report-community-title" className="w-full max-w-xl rounded-[1.75rem] border border-white/60 bg-white p-6 shadow-2xl sm:p-7">
        <p className="eyebrow">{t("community.report.label")}</p>
        <h2 id="report-community-title" className="mt-3 text-xl font-bold text-ink">{t("community.report.title")}</h2>
        <p className="mt-3 text-sm leading-7 text-muted">{t("community.report.description")}</p>
        <div className="mt-5 grid gap-2">
          {communityReportCategories.map((item) => (
            <label key={item.value} className={`cursor-pointer rounded-2xl border px-4 py-3 ${category === item.value ? "border-sage/45 bg-mint/55" : "border-ink/10"}`}>
              <span className="flex items-start gap-3">
                <input type="radio" name="report-category" value={item.value} checked={category === item.value} onChange={() => onCategoryChange(item.value)} className="mt-1 accent-sage" />
                <span><strong className="block text-sm text-ink">{t(reportCategoryCopy[item.value].label)}</strong><span className="mt-1 block text-xs leading-5 text-muted">{t(reportCategoryCopy[item.value].hint)}</span></span>
              </span>
            </label>
          ))}
        </div>
        <label className="mt-5 grid gap-2 text-sm font-bold text-ink">
          {t("community.report.detailsLabel")}
          <textarea value={details} onChange={(event) => onDetailsChange(event.target.value)} maxLength={500} rows={3} className="resize-y rounded-2xl border border-ink/10 px-4 py-3 font-normal leading-7 outline-none focus:border-sage" placeholder={t("community.report.detailsPlaceholder")} />
        </label>
        <p className="mt-4 rounded-2xl bg-cream px-4 py-3 text-xs leading-6 text-muted">
          {t("community.report.targetPrefix")} <strong className="text-ink">{t("community.report.targetHours", { hours: selected.targetHours })}</strong>{t("community.report.targetSuffix")}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className="button-secondary">{t("community.actions.cancel")}</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="button-primary">{busy ? t("community.actions.submittingReport") : t("community.actions.submitReport")}</button>
        </div>
      </div>
    </div>
  );
}

function DeleteDialog({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: DeleteTarget;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!target) return undefined;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [target, busy, onCancel]);

  if (!target) return null;
  const label = target.type === "post" ? t("community.content.post") : t("community.content.comment");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4 backdrop-blur-sm" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-community-title"
        className="w-full max-w-md rounded-[1.75rem] border border-white/60 bg-white p-6 shadow-2xl sm:p-7"
      >
        <h2 id="delete-community-title" className="mt-5 text-xl font-bold text-ink">{t("community.delete.title", { type: label })}</h2>
        <p className="mt-3 text-sm leading-7 text-muted">
          {t("community.delete.description", { type: label })}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} autoFocus className="button-secondary">{t("community.actions.keep")}</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-rose-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-rose-800 disabled:opacity-50"
          >
            {busy ? t("community.actions.deleting") : t("community.actions.confirmDelete", { type: label })}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CommunityPage() {
  const { t } = useTranslation();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [currentRole, setCurrentRole] = useState<CommunityRole>("student");
  const [currentUserId, setCurrentUserId] = useState("");
  const [blockedMembers, setBlockedMembers] = useState<CommunityBlock[]>([]);
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [viewerRoles, setViewerRoles] = useState<CommunityRole[]>(["student", "guardian", "teacher", "professional"]);
  const [commenterRoles, setCommenterRoles] = useState<CommunityRole[]>(["student", "guardian", "teacher", "professional"]);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleting, setDeleting] = useState(false);
  const [reportTarget, setReportTarget] = useState<ReportTarget>(null);
  const [reportCategory, setReportCategory] = useState<CommunityReportCategory>("bullying_threat");
  const [reportDetails, setReportDetails] = useState("");
  const [reportBusy, setReportBusy] = useState(false);

  async function load() {
    try {
      const user = await getCurrentUser();
      setLoggedIn(Boolean(user));
      if (!user) return;
      const [data, blockData, reportData] = await Promise.all([
        listCommunityPosts(),
        listCommunityBlocks(),
        listCommunityReports(),
      ]);
      setPosts(data.posts);
      setCurrentRole(data.currentUser.role);
      setCurrentUserId(data.currentUser.id);
      setBlockedMembers(blockData.blocks);
      setReports(reportData.reports);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("community.messages.loadFailed"));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const audienceText = useMemo(
    () => roleOptions.filter((item) => viewerRoles.includes(item.key)).map((item) => t(item.labelKey)).join("、"),
    [viewerRoles, t],
  );
  const currentRoleLabel = roleOptions.find((item) => item.key === currentRole)?.labelKey;
  const currentRoleText = currentRoleLabel ? t(currentRoleLabel) : t("community.roles.member");

  function toggleViewer(role: CommunityRole) {
    setViewerRoles((current) => {
      if (current.includes(role)) {
        setCommenterRoles((commenters) => commenters.filter((item) => item !== role));
        return current.filter((item) => item !== role);
      }
      return [...current, role];
    });
  }

  function toggleCommenter(role: CommunityRole) {
    if (!viewerRoles.includes(role)) return;
    setCommenterRoles((current) =>
      current.includes(role) ? current.filter((item) => item !== role) : [...current, role],
    );
  }

  async function submitPost() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await createCommunityPost({ title, body, viewerRoles, commenterRoles });
      setTitle("");
      setBody("");
      setNotice(
        result.safetyNotice
          ? t("community.messages.postSafety")
          : t("community.messages.postPublished"),
      );
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("community.messages.postFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function submitComment(postId: string) {
    const draft = (commentDrafts[postId] || "").trim();
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const result = await createCommunityComment(postId, draft);
      setCommentDrafts((current) => ({ ...current, [postId]: "" }));
      setNotice(
        result.safetyNotice
          ? t("community.messages.commentSafety")
          : t("community.messages.commentPublished"),
      );
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("community.messages.commentFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError("");
    try {
      if (deleteTarget.type === "post") {
        await deleteCommunityPost(deleteTarget.id);
        setPosts((current) => current.filter((post) => post.id !== deleteTarget.id));
      } else {
        await deleteCommunityComment(deleteTarget.id);
        setPosts((current) => current.map((post) =>
          post.id === deleteTarget.postId
            ? { ...post, comments: post.comments.filter((comment) => comment.id !== deleteTarget.id) }
            : post,
        ));
      }
      setNotice(deleteTarget.type === "post" ? t("community.messages.postDeleted") : t("community.messages.commentDeleted"));
      setDeleteTarget(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("community.messages.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  function openReport(postId?: string, commentId?: string) {
    setReportTarget({ postId, commentId });
    setReportCategory("bullying_threat");
    setReportDetails("");
    setError("");
  }

  async function submitReport() {
    if (!reportTarget || reportBusy) return;
    setReportBusy(true);
    try {
      const result = await reportCommunityContent({
        ...reportTarget,
        category: reportCategory,
        details: reportDetails.trim() || undefined,
      });
      setReports((current) => [result.report, ...current]);
      setNotice(result.notice);
      setReportTarget(null);
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : t("community.messages.reportFailed"));
    } finally {
      setReportBusy(false);
    }
  }

  async function blockMember(targetUserId: string, name: string) {
    if (!window.confirm(t("community.block.confirm", { name }))) return;
    setError("");
    try {
      await blockCommunityMember(targetUserId);
      setNotice(t("community.block.blocked", { name }));
      await load();
    } catch (blockError) {
      setError(blockError instanceof Error ? blockError.message : t("community.block.failed"));
    }
  }

  async function unblockMember(targetUserId: string, name: string) {
    setError("");
    try {
      await unblockCommunityMember(targetUserId);
      setNotice(t("community.block.unblocked", { name }));
      await load();
    } catch (blockError) {
      setError(blockError instanceof Error ? blockError.message : t("community.block.unblockFailed"));
    }
  }

  return (
    <>
      <PageHero
        label={t("community.hero.label")}
        title={t("community.hero.title")}
        subtitle={t("community.hero.description")}
        action={
          loggedIn === false ? (
            <Link href="/account?next=/community" className="button-primary">{t("community.actions.signIn")}</Link>
          ) : loggedIn === true ? (
            <a href="#new-post" className="button-primary">{t("community.actions.newTopic")}</a>
          ) : (
            <span className="button-secondary cursor-wait" aria-live="polite">{t("community.actions.checkingIdentity")}</span>
          )
        }
        aside={
          <div>
            <IllustrationPanel
              src="/illustrations/system/feature-community.webp"
              alt={t("community.hero.imageAlt")}
              priority
            />
            <p className="mt-3 px-3 text-xs font-bold leading-5 text-muted">
              {t("community.hero.imageCaption")}
            </p>
          </div>
        }
      />

      <section id="community-rules" className="section pb-8 sm:pb-10">
        <div className="container">
          <div className="rounded-[2rem] border border-sage/20 bg-white p-6 shadow-soft sm:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="eyebrow">{t("community.rules.label")}</p>
                <h2 className="mt-3 text-2xl font-bold text-ink sm:text-3xl">{t("community.rules.title")}</h2>
                <p className="mt-3 text-sm leading-7 text-muted">{t("community.rules.description")}</p>
              </div>
              <Link href="/privacy-safety#community-safety" className="button-secondary shrink-0">{t("community.rules.action")}</Link>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {communityRules.map(([title, text]) => (
                <div key={title} className="rounded-2xl bg-cream px-4 py-4">
                  <h3 className="text-sm font-extrabold text-ink">{t(title)}</h3>
                  <p className="mt-2 text-xs leading-6 text-muted">{t(text)}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-900">{t("community.rules.targets.urgent")}</p>
              <p className="rounded-2xl border border-sage/20 bg-mist px-4 py-3 text-xs leading-6 text-sage-dark">{t("community.rules.targets.high")}</p>
              <p className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-xs leading-6 text-muted">{t("community.rules.targets.standard")}</p>
            </div>
            <p className="mt-4 text-xs leading-6 text-muted">{t("community.rules.targetDisclaimer")}</p>
          </div>
        </div>
      </section>

      <section className="section section-muted pt-8 sm:pt-10">
        <div className="container">
          {loggedIn === null ? (
            <div className="mx-auto max-w-3xl rounded-[1.75rem] border border-ink/10 bg-white p-7 text-center shadow-soft">
              <span className="mx-auto block h-10 w-10 animate-pulse rounded-full bg-mist" />
              <p className="mt-4 text-sm font-bold text-muted">{t("community.loading")}</p>
            </div>
          ) : loggedIn === false ? (
            <div className="mx-auto max-w-3xl rounded-[2rem] border border-sage/25 bg-white p-7 shadow-soft sm:p-10">
              <p className="eyebrow">{t("community.hero.label")}</p>
              <h2 className="mt-3 text-2xl font-bold text-ink">{t("community.visitor.title")}</h2>
              <p className="mt-4 text-sm leading-7 text-muted">
                {t("community.visitor.description")}
              </p>
              <Link href="/account?next=/community" className="button-primary mt-6">{t("community.visitor.action")}</Link>
            </div>
          ) : (
            <>
              <div className="mb-6 flex flex-col gap-4 rounded-[1.5rem] border border-sage/20 bg-white/85 px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Avatar name={currentRoleText} professional={currentRole === "professional"} />
                  <div>
                    <p className="text-sm font-bold text-ink">{t("community.member.role", { role: currentRoleText })}</p>
                    <p className="mt-1 text-xs leading-5 text-muted">{t("community.member.roleDescription")}</p>
                  </div>
                </div>
                <a href="#new-post" className="button-secondary shrink-0 px-4 py-2 text-xs">{t("community.actions.writeTopic")}</a>
              </div>

              {blockedMembers.length ? (
                <details className="mb-6 rounded-[1.5rem] border border-ink/10 bg-white px-5 py-4 shadow-sm">
                  <summary className="cursor-pointer text-sm font-bold text-ink">{t("community.block.summary", { count: blockedMembers.length })}</summary>
                  <p className="mt-3 text-xs leading-6 text-muted">{t("community.block.description")}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {blockedMembers.map((member) => (
                      <button
                        key={member.user_id}
                        type="button"
                        className="rounded-full border border-ink/10 bg-cream px-3 py-2 text-xs font-bold text-ink hover:border-sage"
                        onClick={() => void unblockMember(member.user_id, member.name)}
                      >
                        {t("community.block.unblockAction", { name: member.name })}
                      </button>
                    ))}
                  </div>
                </details>
              ) : null}

              {reports.length ? (
                <details className="mb-6 rounded-[1.5rem] border border-ink/10 bg-white px-5 py-4 shadow-sm">
                  <summary className="cursor-pointer text-sm font-bold text-ink">{t("community.report.progress", { count: reports.length })}</summary>
                  <p className="mt-3 text-xs leading-6 text-muted">{t("community.report.progressDescription")}</p>
                  <div className="mt-4 grid gap-3">
                    {reports.map((report) => (
                      <div key={report.id} className="rounded-2xl bg-cream px-4 py-3 text-xs leading-6 text-muted">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <strong className="text-ink">{t(reportCategoryCopy[report.category].label)}</strong>
                          <span className="rounded-full bg-white px-2.5 py-1 font-bold text-sage-dark">{t(reportStatusKey(report.status))}</span>
                        </div>
                        <p className="mt-2">{t("community.report.progressLine", { type: report.post_id ? t("community.content.post") : t("community.content.reply"), time: formatTime(report.created_at), priority: t(reportPriorityCopy[report.priority]) })}</p>
                        <p>{t("community.report.targetReview", { time: formatTime(report.target_review_at) })}{report.resolved_at ? t("community.report.completedAt", { time: formatTime(report.resolved_at) }) : ""}</p>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}

              {notice ? <p role="status" className="mb-4 rounded-2xl border border-sage/20 bg-mist px-5 py-4 text-sm font-bold text-sage-dark">{notice}</p> : null}
              {error ? <p role="alert" className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</p> : null}

              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_390px] xl:gap-8">
                <section aria-label={t("community.topics.ariaLabel")} className="min-w-0 space-y-5">
                  <div className="flex items-end justify-between gap-4 px-1">
                    <div>
                      <p className="eyebrow">{t("community.topics.label")}</p>
                      <h2 className="mt-2 text-2xl font-bold text-ink">{t("community.topics.title")}</h2>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-muted shadow-sm">{t("community.topics.count", { count: posts.length })}</span>
                  </div>

                  {!posts.length ? (
                    <div className="rounded-[1.75rem] border border-dashed border-sage/35 bg-white/70 p-8 text-center">
                      <h3 className="text-lg font-bold text-ink">{t("community.topics.emptyTitle")}</h3>
                      <p className="mt-2 text-sm leading-7 text-muted">{t("community.topics.emptyText")}</p>
                    </div>
                  ) : null}

                  {posts.map((post) => (
                    <article key={post.id} className="overflow-hidden rounded-[1.75rem] border border-ink/10 bg-white shadow-soft transition hover:border-sage/30">
                      <header className="flex items-start justify-between gap-4 border-b border-ink/5 px-5 py-4 sm:px-6">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar name={post.author_name} professional={post.verified_professional} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-extrabold text-ink">{post.author_name}</span>
                              <RoleBadge label={post.author_role_label} verified={post.verified_professional} />
                            </div>
                            <time className="mt-1 block text-xs text-muted" dateTime={post.created_at}>{formatTime(post.created_at)}</time>
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full bg-cream px-3 py-1.5 text-[0.7rem] font-bold text-muted">
                          {t("community.comments.count", { count: post.comments.length })}
                        </span>
                      </header>

                      <div className="px-5 py-5 sm:px-6 sm:py-6">
                        <h3 className="text-xl font-extrabold leading-snug text-ink sm:text-[1.35rem]">{post.title}</h3>
                        <p className="mt-3 whitespace-pre-wrap text-[0.95rem] leading-8 text-muted">{post.body}</p>
                        <div className="mt-5 flex flex-wrap gap-2 text-[0.7rem] font-bold text-muted">
                          <span className="rounded-full border border-sage/15 bg-mint/45 px-3 py-1.5">
                            {t("community.audience.visiblePrefix")} {roleOptions.filter((item) => post.viewer_roles.includes(item.key)).map((item) => t(item.labelKey)).join("、")}
                          </span>
                          <span className="rounded-full border border-sage/15 bg-mint/45 px-3 py-1.5">
                            {t("community.audience.commentPrefix")} {post.commenter_roles.length
                              ? roleOptions.filter((item) => post.commenter_roles.includes(item.key)).map((item) => t(item.labelKey)).join("、")
                              : t("community.audience.readOnly")}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 border-y border-ink/5 bg-cream/55 px-5 py-3 sm:px-6">
                        <a href={`#reply-${post.id}`} className="inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-bold text-sage-dark hover:bg-mist">
                          {t("community.actions.reply")}
                        </a>
                        {post.author_user_id !== currentUserId ? (
                          <button type="button" onClick={() => openReport(post.id)} className="inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-bold text-muted hover:bg-white hover:text-ink">
                            {t("community.actions.report")}
                          </button>
                        ) : null}
                        {post.author_user_id !== currentUserId ? (
                          <button type="button" onClick={() => void blockMember(post.author_user_id, post.author_name)} className="inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-bold text-muted hover:bg-white hover:text-ink">
                            {t("community.actions.blockMember")}
                          </button>
                        ) : null}
                        {post.can_delete ? (
                          <button type="button" onClick={() => setDeleteTarget({ type: "post", id: post.id })} className="ml-auto inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-bold text-rose-700 hover:bg-rose-50">
                            {t("community.actions.deletePost")}
                          </button>
                        ) : null}
                      </div>

                      <section aria-label={t("community.comments.ariaLabel", { title: post.title })} className="px-5 py-5 sm:px-6">
                        <div className="flex items-center justify-between gap-3">
                          <h4 className="text-sm font-extrabold text-ink">{t("community.comments.title")}</h4>
                          <span className="text-xs text-muted">{post.comments.length ? t("community.comments.total", { count: post.comments.length }) : t("community.comments.empty")}</span>
                        </div>
                        <div className="mt-4 space-y-3">
                          {post.comments.map((comment) => (
                            <div key={comment.id} className="group flex gap-3 rounded-2xl border border-ink/5 bg-cream/65 p-4 transition hover:border-sage/20 hover:bg-cream">
                              <Avatar name={comment.author_name} professional={comment.verified_professional} />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-extrabold text-ink">{comment.author_name}</span>
                                  <RoleBadge label={comment.author_role_label} verified={comment.verified_professional} />
                                  <time className="text-[0.7rem] text-muted" dateTime={comment.created_at}>{formatTime(comment.created_at)}</time>
                                </div>
                                <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted">{comment.body}</p>
                                <div className="mt-3 flex flex-wrap items-center gap-1">
                                  {comment.author_user_id !== currentUserId ? (
                                    <button type="button" onClick={() => openReport(undefined, comment.id)} className="rounded-full px-2.5 py-1.5 text-[0.7rem] font-bold text-muted hover:bg-white hover:text-ink">{t("community.actions.report")}</button>
                                  ) : null}
                                  {comment.author_user_id !== currentUserId ? (
                                    <button type="button" onClick={() => void blockMember(comment.author_user_id, comment.author_name)} className="rounded-full px-2.5 py-1.5 text-[0.7rem] font-bold text-muted hover:bg-white hover:text-ink">{t("community.actions.blockMember")}</button>
                                  ) : null}
                                  {comment.can_delete ? (
                                    <button type="button" onClick={() => setDeleteTarget({ type: "comment", id: comment.id, postId: post.id })} className="rounded-full px-2.5 py-1.5 text-[0.7rem] font-bold text-rose-700 hover:bg-rose-50">{t("community.actions.deleteComment")}</button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {post.can_comment ? (
                          <div id={`reply-${post.id}`} className="mt-5 rounded-2xl border-2 border-sage/20 bg-mint/35 p-4 focus-within:border-sage/55 focus-within:bg-white">
                            <label htmlFor={`comment-${post.id}`} className="text-sm font-extrabold text-ink">{t("community.comments.formLabel")}</label>
                            <p className="mt-1 text-xs leading-5 text-muted">{t("community.comments.formDescription")}</p>
                            <textarea
                              id={`comment-${post.id}`}
                              value={commentDrafts[post.id] || ""}
                              onChange={(event) => setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))}
                              rows={3}
                              maxLength={1200}
                              className="mt-3 w-full resize-y rounded-xl border border-ink/10 bg-white px-4 py-3 text-sm leading-7 outline-none focus:border-sage"
                              placeholder={t("community.comments.placeholder")}
                            />
                            <div className="mt-3 flex items-center justify-between gap-3">
                              <span className="text-[0.7rem] text-muted">{(commentDrafts[post.id] || "").length}/1200</span>
                              <button
                                type="button"
                                onClick={() => void submitComment(post.id)}
                                disabled={busy || !commentDrafts[post.id]?.trim()}
                                className="button-primary px-5 py-2 text-xs disabled:opacity-50"
                              >
                                {busy ? t("community.actions.sending") : t("community.actions.publishReply")}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-4 rounded-2xl bg-cream px-4 py-3 text-xs leading-6 text-muted">{t("community.comments.readOnly")}</p>
                        )}
                      </section>
                    </article>
                  ))}
                </section>

                <aside id="new-post" className="rounded-[1.75rem] border-2 border-sage/25 bg-white p-5 shadow-soft lg:sticky lg:top-24 sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="eyebrow">{t("community.newPost.label")}</p>
                      <h2 className="mt-2 text-xl font-extrabold text-ink">{t("community.newPost.title")}</h2>
                    </div>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sage text-lg font-bold text-white" aria-hidden="true">＋</span>
                  </div>

                  <label className="mt-5 block text-sm font-bold text-ink">
                    {t("community.newPost.titleLabel")}
                    <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} className="mt-2 w-full rounded-xl border border-ink/10 bg-cream/45 px-4 py-3 font-normal outline-none focus:border-sage focus:bg-white" placeholder={t("community.newPost.titlePlaceholder")} />
                  </label>
                  <label className="mt-4 block text-sm font-bold text-ink">
                    {t("community.newPost.bodyLabel")}
                    <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={3000} rows={5} className="mt-2 w-full resize-y rounded-xl border border-ink/10 bg-cream/45 px-4 py-3 font-normal leading-7 outline-none focus:border-sage focus:bg-white" placeholder={t("community.newPost.bodyPlaceholder")} />
                  </label>
                  <div className="mt-2 text-right text-[0.7rem] text-muted">{body.length}/3000</div>

                  <fieldset className="mt-5 border-t border-ink/5 pt-5">
                    <legend className="text-sm font-extrabold text-ink">{t("community.newPost.viewerLegend")}</legend>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {roleOptions.map((role) => (
                        <label key={role.key} className={`cursor-pointer rounded-xl border p-3 transition ${viewerRoles.includes(role.key) ? "border-sage/45 bg-mint/55" : "border-ink/10 bg-white hover:border-sage/25"}`}>
                          <span className="flex items-center gap-2">
                            <input type="checkbox" checked={viewerRoles.includes(role.key)} onChange={() => toggleViewer(role.key)} className="accent-sage" />
                            <span className="text-xs font-extrabold text-ink">{t(role.labelKey)}</span>
                          </span>
                          <span className="mt-1.5 block text-[0.68rem] leading-5 text-muted">{t(role.hintKey)}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className="mt-5">
                    <legend className="text-sm font-extrabold text-ink">{t("community.newPost.commenterLegend")}</legend>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {roleOptions.map((role) => (
                        <label key={role.key} className={`rounded-full border px-3 py-2 text-[0.7rem] font-bold ${viewerRoles.includes(role.key) ? "cursor-pointer border-sage/30 bg-white text-ink" : "cursor-not-allowed border-ink/5 bg-cream text-muted/50"}`}>
                          <input type="checkbox" className="mr-1.5 accent-sage" disabled={!viewerRoles.includes(role.key)} checked={commenterRoles.includes(role.key)} onChange={() => toggleCommenter(role.key)} />
                          {t(role.labelKey)}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div className="mt-5 rounded-xl border border-sage/15 bg-mint/35 px-4 py-3 text-[0.7rem] leading-6 text-muted">
                    <strong className="text-ink">{t("community.newPost.confirmLabel")}</strong> {t("community.newPost.confirmText", { audience: audienceText || t("community.newPost.noAudience") })}
                  </div>
                  <button type="button" onClick={() => void submitPost()} disabled={busy || !title.trim() || !body.trim() || !viewerRoles.length} className="button-primary mt-5 w-full disabled:cursor-not-allowed disabled:opacity-50">
                    {busy ? t("community.actions.publishing") : t("community.actions.publish")}
                  </button>
                </aside>
              </div>
            </>
          )}
        </div>
      </section>

      <DeleteDialog target={deleteTarget} busy={deleting} onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} />
      <ReportDialog
        target={reportTarget}
        category={reportCategory}
        details={reportDetails}
        busy={reportBusy}
        onCategoryChange={setReportCategory}
        onDetailsChange={setReportDetails}
        onCancel={() => setReportTarget(null)}
        onConfirm={() => void submitReport()}
      />
    </>
  );
}
