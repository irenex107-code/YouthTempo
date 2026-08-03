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
  communityReportPriorityLabels,
  communityReportStatusLabel,
  type CommunityReportCategory,
} from "@/lib/communityReports";
import { PageHero } from "@/components/PageHero";
import { IllustrationPanel } from "@/components/IllustrationPanel";

const roleOptions: Array<{ key: CommunityRole; label: string; hint: string }> = [
  { key: "student", label: "学生", hint: "同龄人之间交流和回应" },
  { key: "guardian", label: "家长", hint: "分享陪伴中的经验与困惑" },
  { key: "teacher", label: "老师", hint: "提供校园中的观察和建议" },
  { key: "professional", label: "专业支持者", hint: "由平台确认身份后参与回复" },
];

type DeleteTarget = { type: "post" | "comment"; id: string; postId?: string } | null;
type ReportTarget = { postId?: string; commentId?: string } | null;

const communityRules = [
  ["尊重，不欺凌", "不辱骂、威胁、诽谤、围攻或恶意损害他人形象；不同意见也要具体、友善地表达。"],
  ["保护自己和他人", "不公开真实姓名、学校班级、住址、联系方式、账号、定位或未经同意的私密经历与影像。"],
  ["不传播危险内容", "不发布色情、暴力、赌博、违法内容，不鼓励自伤自杀，也不诱导他人模仿不安全行为。"],
  ["真实且不牟利", "不冒充专业人士，不诈骗、索要钱款、发布可疑链接、刷屏或借社区营销。"],
];

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function Avatar({ name, professional = false }: { name: string; professional?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
        professional ? "bg-sage text-white" : "bg-mist text-sage-dark"
      }`}
    >
      {name.trim().slice(0, 1).toUpperCase() || "友"}
    </span>
  );
}

function RoleBadge({ label, verified }: { label: string; verified?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-mist px-2.5 py-1 text-[0.7rem] font-bold text-sage-dark">
      {label}{verified ? " · 已认证" : ""}
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
        <p className="eyebrow">社区安全</p>
        <h2 id="report-community-title" className="mt-3 text-xl font-bold text-ink">举报这条内容</h2>
        <p className="mt-3 text-sm leading-7 text-muted">请选择最接近的情况。举报人身份不会向内容作者公开。</p>
        <div className="mt-5 grid gap-2">
          {communityReportCategories.map((item) => (
            <label key={item.value} className={`cursor-pointer rounded-2xl border px-4 py-3 ${category === item.value ? "border-sage/45 bg-mint/55" : "border-ink/10"}`}>
              <span className="flex items-start gap-3">
                <input type="radio" name="report-category" value={item.value} checked={category === item.value} onChange={() => onCategoryChange(item.value)} className="mt-1 accent-sage" />
                <span><strong className="block text-sm text-ink">{item.label}</strong><span className="mt-1 block text-xs leading-5 text-muted">{item.hint}</span></span>
              </span>
            </label>
          ))}
        </div>
        <label className="mt-5 grid gap-2 text-sm font-bold text-ink">
          补充说明（选填）
          <textarea value={details} onChange={(event) => onDetailsChange(event.target.value)} maxLength={500} rows={3} className="resize-y rounded-2xl border border-ink/10 px-4 py-3 font-normal leading-7 outline-none focus:border-sage" placeholder="不用重复粘贴内容，可以说明你担心什么。" />
        </label>
        <p className="mt-4 rounded-2xl bg-cream px-4 py-3 text-xs leading-6 text-muted">
          该类型目标在 <strong className="text-ink">{selected.targetHours} 小时内完成首次复核</strong>。这不是紧急救助渠道；如有人正处于即时危险中，请立刻联系可信任的成年人，并拨打 110 或 120。
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className="button-secondary">取消</button>
          <button type="button" onClick={onConfirm} disabled={busy} className="button-primary">{busy ? "正在提交…" : "提交举报"}</button>
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
  useEffect(() => {
    if (!target) return undefined;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [target, busy, onCancel]);

  if (!target) return null;
  const label = target.type === "post" ? "帖子" : "评论";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4 backdrop-blur-sm" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-community-title"
        className="w-full max-w-md rounded-[1.75rem] border border-white/60 bg-white p-6 shadow-2xl sm:p-7"
      >
        <h2 id="delete-community-title" className="mt-5 text-xl font-bold text-ink">删除这条{label}？</h2>
        <p className="mt-3 text-sm leading-7 text-muted">
          删除后，这条{label}会立即从社区中消失，无法由你自行恢复。
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} autoFocus className="button-secondary">先保留</button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-rose-700 px-5 py-3 text-sm font-bold text-white transition hover:bg-rose-800 disabled:opacity-50"
          >
            {busy ? "正在删除…" : `确认删除${label}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CommunityPage() {
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
      setError(loadError instanceof Error ? loadError.message : "社区内容加载失败。");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const audienceText = useMemo(
    () => roleOptions.filter((item) => viewerRoles.includes(item.key)).map((item) => item.label).join("、"),
    [viewerRoles],
  );
  const currentRoleLabel = roleOptions.find((item) => item.key === currentRole)?.label || "成员";

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
          ? "这段内容可能涉及紧急安全风险，已暂不公开。请同时联系可信任的成年人或专业支持。"
          : "话题已发布，只有你选择的身份可以看到和参与。",
      );
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "暂时无法发布。");
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
          ? "这段回复可能涉及紧急安全风险，已暂不公开。请尽快联系现实中的可信任支持。"
          : "回应已发布。",
      );
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "暂时无法回应。");
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
      setNotice(deleteTarget.type === "post" ? "帖子已删除。" : "评论已删除。");
      setDeleteTarget(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "暂时无法删除。");
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
      setError(reportError instanceof Error ? reportError.message : "举报提交失败。");
    } finally {
      setReportBusy(false);
    }
  }

  async function blockMember(targetUserId: string, name: string) {
    if (!window.confirm(`屏蔽“${name}”后，你们将无法在社区看到彼此的帖子和回应，也不能继续互动。其他 YouthTempo 功能不会受到影响。\n\n确定继续吗？`)) return;
    setError("");
    try {
      await blockCommunityMember(targetUserId);
      setNotice(`已屏蔽 ${name}。你们的社区内容已互相隐藏。`);
      await load();
    } catch (blockError) {
      setError(blockError instanceof Error ? blockError.message : "屏蔽设置保存失败。");
    }
  }

  async function unblockMember(targetUserId: string, name: string) {
    setError("");
    try {
      await unblockCommunityMember(targetUserId);
      setNotice(`已解除对 ${name} 的屏蔽。`);
      await load();
    } catch (blockError) {
      setError(blockError instanceof Error ? blockError.message : "解除屏蔽失败。");
    }
  }

  return (
    <>
      <PageHero
        label="成员社区"
        title="家校医社区"
        subtitle="把真实的困惑说出来，也听听不同位置的人怎么看。你始终可以决定谁能看、谁能回应。"
        action={
          loggedIn === false ? (
            <Link href="/account?next=/community" className="button-primary">登录后进入社区</Link>
          ) : loggedIn === true ? (
            <a href="#new-post" className="button-primary">发布新话题</a>
          ) : (
            <span className="button-secondary cursor-wait" aria-live="polite">正在确认身份…</span>
          )
        }
        aside={
          <div>
            <IllustrationPanel
              src="/illustrations/system/feature-community.webp"
              alt="学生、家长、老师和专业支持者围坐交流，认真倾听一位学生发言"
              priority
            />
            <p className="mt-3 px-3 text-xs font-bold leading-5 text-muted">
              每个人都可以选择自己的内容向谁开放，也可以决定谁能够回应。
            </p>
          </div>
        }
      />

      <section id="community-rules" className="section pb-8 sm:pb-10">
        <div className="container">
          <div className="rounded-[2rem] border border-sage/20 bg-white p-6 shadow-soft sm:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="eyebrow">未成年人社区规则</p>
                <h2 className="mt-3 text-2xl font-bold text-ink sm:text-3xl">先保护人，再讨论问题</h2>
                <p className="mt-3 text-sm leading-7 text-muted">规则适用于帖子和回应。平台会结合系统识别与人工复核，必要时隐藏内容、限制发布或依法报告。</p>
              </div>
              <Link href="/privacy-safety#community-safety" className="button-secondary shrink-0">查看完整安全说明</Link>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {communityRules.map(([title, text]) => (
                <div key={title} className="rounded-2xl bg-cream px-4 py-4">
                  <h3 className="text-sm font-extrabold text-ink">{title}</h3>
                  <p className="mt-2 text-xs leading-6 text-muted">{text}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-900"><strong>紧急优先：</strong>目标 2 小时内首次复核</p>
              <p className="rounded-2xl border border-sage/20 bg-mist px-4 py-3 text-xs leading-6 text-sage-dark"><strong>欺凌、隐私等：</strong>目标 24 小时内首次复核</p>
              <p className="rounded-2xl border border-ink/10 bg-white px-4 py-3 text-xs leading-6 text-muted"><strong>其他违规：</strong>目标 72 小时内首次复核</p>
            </div>
            <p className="mt-4 text-xs leading-6 text-muted">以上是平台服务目标，不是紧急救助时限。有人正处于即时危险时，不要等待平台处理，请联系可信任的成年人并拨打 110 或 120。</p>
          </div>
        </div>
      </section>

      <section className="section section-muted pt-8 sm:pt-10">
        <div className="container">
          {loggedIn === null ? (
            <div className="mx-auto max-w-3xl rounded-[1.75rem] border border-ink/10 bg-white p-7 text-center shadow-soft">
              <span className="mx-auto block h-10 w-10 animate-pulse rounded-full bg-mist" />
              <p className="mt-4 text-sm font-bold text-muted">正在打开社区…</p>
            </div>
          ) : loggedIn === false ? (
            <div className="mx-auto max-w-3xl rounded-[2rem] border border-sage/25 bg-white p-7 shadow-soft sm:p-10">
              <p className="eyebrow">成员社区</p>
              <h2 className="mt-3 text-2xl font-bold text-ink">登录后才能阅读和参与讨论</h2>
              <p className="mt-4 text-sm leading-7 text-muted">
                登录用于确认学生、家长、老师或专业支持者身份；加入社区不会改变任何 SWEET 记录的查看权限。
              </p>
              <Link href="/account?next=/community" className="button-primary mt-6">登录或创建账户</Link>
            </div>
          ) : (
            <>
              <div className="mb-6 flex flex-col gap-4 rounded-[1.5rem] border border-sage/20 bg-white/85 px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Avatar name={currentRoleLabel} professional={currentRole === "professional"} />
                  <div>
                    <p className="text-sm font-bold text-ink">你正在以“{currentRoleLabel}”身份参与</p>
                    <p className="mt-1 text-xs leading-5 text-muted">只显示向这个身份开放的内容；SWEET 记录不会出现在这里。</p>
                  </div>
                </div>
                <a href="#new-post" className="button-secondary shrink-0 px-4 py-2 text-xs">写一个新话题</a>
              </div>

              {blockedMembers.length ? (
                <details className="mb-6 rounded-[1.5rem] border border-ink/10 bg-white px-5 py-4 shadow-sm">
                  <summary className="cursor-pointer text-sm font-bold text-ink">已屏蔽成员（{blockedMembers.length}）</summary>
                  <p className="mt-3 text-xs leading-6 text-muted">你们不会在社区中看到彼此的帖子和回应。解除后，仍需遵守原帖设置的查看和回应范围。</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {blockedMembers.map((member) => (
                      <button
                        key={member.user_id}
                        type="button"
                        className="rounded-full border border-ink/10 bg-cream px-3 py-2 text-xs font-bold text-ink hover:border-sage"
                        onClick={() => void unblockMember(member.user_id, member.name)}
                      >
                        {member.name} · 解除屏蔽
                      </button>
                    ))}
                  </div>
                </details>
              ) : null}

              {reports.length ? (
                <details className="mb-6 rounded-[1.5rem] border border-ink/10 bg-white px-5 py-4 shadow-sm">
                  <summary className="cursor-pointer text-sm font-bold text-ink">我的举报进度（{reports.length}）</summary>
                  <p className="mt-3 text-xs leading-6 text-muted">这里显示最近 30 条举报。目标时间指首次复核，复杂情况可能需要更长时间完成调查。</p>
                  <div className="mt-4 grid gap-3">
                    {reports.map((report) => (
                      <div key={report.id} className="rounded-2xl bg-cream px-4 py-3 text-xs leading-6 text-muted">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <strong className="text-ink">{communityReportCategory(report.category).label}</strong>
                          <span className="rounded-full bg-white px-2.5 py-1 font-bold text-sage-dark">{communityReportStatusLabel(report.status)}</span>
                        </div>
                        <p className="mt-2">{report.post_id ? "帖子" : "回应"} · {formatTime(report.created_at)}提交 · {communityReportPriorityLabels[report.priority]}</p>
                        <p>目标首次复核：{formatTime(report.target_review_at)}{report.resolved_at ? ` · ${formatTime(report.resolved_at)}已完成` : ""}</p>
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}

              {notice ? <p role="status" className="mb-4 rounded-2xl border border-sage/20 bg-mist px-5 py-4 text-sm font-bold text-sage-dark">{notice}</p> : null}
              {error ? <p role="alert" className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error}</p> : null}

              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_390px] xl:gap-8">
                <section aria-label="社区话题" className="min-w-0 space-y-5">
                  <div className="flex items-end justify-between gap-4 px-1">
                    <div>
                      <p className="eyebrow">最新讨论</p>
                      <h2 className="mt-2 text-2xl font-bold text-ink">社区正在聊</h2>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-muted shadow-sm">{posts.length} 个话题</span>
                  </div>

                  {!posts.length ? (
                    <div className="rounded-[1.75rem] border border-dashed border-sage/35 bg-white/70 p-8 text-center">
                      <h3 className="text-lg font-bold text-ink">还没有向你开放的话题</h3>
                      <p className="mt-2 text-sm leading-7 text-muted">可以发布第一个话题，并邀请希望一起参与的人。</p>
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
                          {post.comments.length} 条回应
                        </span>
                      </header>

                      <div className="px-5 py-5 sm:px-6 sm:py-6">
                        <h3 className="text-xl font-extrabold leading-snug text-ink sm:text-[1.35rem]">{post.title}</h3>
                        <p className="mt-3 whitespace-pre-wrap text-[0.95rem] leading-8 text-muted">{post.body}</p>
                        <div className="mt-5 flex flex-wrap gap-2 text-[0.7rem] font-bold text-muted">
                          <span className="rounded-full border border-sage/15 bg-mint/45 px-3 py-1.5">
                            看得到 · {roleOptions.filter((item) => post.viewer_roles.includes(item.key)).map((item) => item.label).join("、")}
                          </span>
                          <span className="rounded-full border border-sage/15 bg-mint/45 px-3 py-1.5">
                            可回应 · {post.commenter_roles.length
                              ? roleOptions.filter((item) => post.commenter_roles.includes(item.key)).map((item) => item.label).join("、")
                              : "仅阅读"}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 border-y border-ink/5 bg-cream/55 px-5 py-3 sm:px-6">
                        <a href={`#reply-${post.id}`} className="inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-bold text-sage-dark hover:bg-mist">
                          回应
                        </a>
                        {post.author_user_id !== currentUserId ? (
                          <button type="button" onClick={() => openReport(post.id)} className="inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-bold text-muted hover:bg-white hover:text-ink">
                            举报
                          </button>
                        ) : null}
                        {post.author_user_id !== currentUserId ? (
                          <button type="button" onClick={() => void blockMember(post.author_user_id, post.author_name)} className="inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-bold text-muted hover:bg-white hover:text-ink">
                            屏蔽该成员
                          </button>
                        ) : null}
                        {post.can_delete ? (
                          <button type="button" onClick={() => setDeleteTarget({ type: "post", id: post.id })} className="ml-auto inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-xs font-bold text-rose-700 hover:bg-rose-50">
                            删除帖子
                          </button>
                        ) : null}
                      </div>

                      <section aria-label={`${post.title}的回应`} className="px-5 py-5 sm:px-6">
                        <div className="flex items-center justify-between gap-3">
                          <h4 className="text-sm font-extrabold text-ink">大家的回应</h4>
                          <span className="text-xs text-muted">{post.comments.length ? `共 ${post.comments.length} 条` : "还没有回应"}</span>
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
                                    <button type="button" onClick={() => openReport(undefined, comment.id)} className="rounded-full px-2.5 py-1.5 text-[0.7rem] font-bold text-muted hover:bg-white hover:text-ink">举报</button>
                                  ) : null}
                                  {comment.author_user_id !== currentUserId ? (
                                    <button type="button" onClick={() => void blockMember(comment.author_user_id, comment.author_name)} className="rounded-full px-2.5 py-1.5 text-[0.7rem] font-bold text-muted hover:bg-white hover:text-ink">屏蔽该成员</button>
                                  ) : null}
                                  {comment.can_delete ? (
                                    <button type="button" onClick={() => setDeleteTarget({ type: "comment", id: comment.id, postId: post.id })} className="rounded-full px-2.5 py-1.5 text-[0.7rem] font-bold text-rose-700 hover:bg-rose-50">删除评论</button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {post.can_comment ? (
                          <div id={`reply-${post.id}`} className="mt-5 rounded-2xl border-2 border-sage/20 bg-mint/35 p-4 focus-within:border-sage/55 focus-within:bg-white">
                            <label htmlFor={`comment-${post.id}`} className="text-sm font-extrabold text-ink">写下你的回应</label>
                            <p className="mt-1 text-xs leading-5 text-muted">具体、友善地说说你的经验，不急着替对方下结论。</p>
                            <textarea
                              id={`comment-${post.id}`}
                              value={commentDrafts[post.id] || ""}
                              onChange={(event) => setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))}
                              rows={3}
                              maxLength={1200}
                              className="mt-3 w-full resize-y rounded-xl border border-ink/10 bg-white px-4 py-3 text-sm leading-7 outline-none focus:border-sage"
                              placeholder="我想回应的是……"
                            />
                            <div className="mt-3 flex items-center justify-between gap-3">
                              <span className="text-[0.7rem] text-muted">{(commentDrafts[post.id] || "").length}/1200</span>
                              <button
                                type="button"
                                onClick={() => void submitComment(post.id)}
                                disabled={busy || !commentDrafts[post.id]?.trim()}
                                className="button-primary px-5 py-2 text-xs disabled:opacity-50"
                              >
                                {busy ? "正在发送…" : "发布回应"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="mt-4 rounded-2xl bg-cream px-4 py-3 text-xs leading-6 text-muted">这条内容向你开放阅读，但发布者没有向你的身份开放回应。</p>
                        )}
                      </section>
                    </article>
                  ))}
                </section>

                <aside id="new-post" className="rounded-[1.75rem] border-2 border-sage/25 bg-white p-5 shadow-soft lg:sticky lg:top-24 sm:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="eyebrow">发布新话题</p>
                      <h2 className="mt-2 text-xl font-extrabold text-ink">今天想和谁聊聊？</h2>
                    </div>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sage text-lg font-bold text-white" aria-hidden="true">＋</span>
                  </div>

                  <label className="mt-5 block text-sm font-bold text-ink">
                    话题标题
                    <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} className="mt-2 w-full rounded-xl border border-ink/10 bg-cream/45 px-4 py-3 font-normal outline-none focus:border-sage focus:bg-white" placeholder="一句话说清想讨论什么" />
                  </label>
                  <label className="mt-4 block text-sm font-bold text-ink">
                    想说的内容
                    <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={3000} rows={5} className="mt-2 w-full resize-y rounded-xl border border-ink/10 bg-cream/45 px-4 py-3 font-normal leading-7 outline-none focus:border-sage focus:bg-white" placeholder="分享近况、提问，或告诉大家你希望得到怎样的回应。" />
                  </label>
                  <div className="mt-2 text-right text-[0.7rem] text-muted">{body.length}/3000</div>

                  <fieldset className="mt-5 border-t border-ink/5 pt-5">
                    <legend className="text-sm font-extrabold text-ink">1. 哪些人可以看到？</legend>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {roleOptions.map((role) => (
                        <label key={role.key} className={`cursor-pointer rounded-xl border p-3 transition ${viewerRoles.includes(role.key) ? "border-sage/45 bg-mint/55" : "border-ink/10 bg-white hover:border-sage/25"}`}>
                          <span className="flex items-center gap-2">
                            <input type="checkbox" checked={viewerRoles.includes(role.key)} onChange={() => toggleViewer(role.key)} className="accent-sage" />
                            <span className="text-xs font-extrabold text-ink">{role.label}</span>
                          </span>
                          <span className="mt-1.5 block text-[0.68rem] leading-5 text-muted">{role.hint}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className="mt-5">
                    <legend className="text-sm font-extrabold text-ink">2. 哪些人可以回应？</legend>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {roleOptions.map((role) => (
                        <label key={role.key} className={`rounded-full border px-3 py-2 text-[0.7rem] font-bold ${viewerRoles.includes(role.key) ? "cursor-pointer border-sage/30 bg-white text-ink" : "cursor-not-allowed border-ink/5 bg-cream text-muted/50"}`}>
                          <input type="checkbox" className="mr-1.5 accent-sage" disabled={!viewerRoles.includes(role.key)} checked={commenterRoles.includes(role.key)} onChange={() => toggleCommenter(role.key)} />
                          {role.label}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <div className="mt-5 rounded-xl border border-sage/15 bg-mint/35 px-4 py-3 text-[0.7rem] leading-6 text-muted">
                    <strong className="text-ink">发布前确认：</strong> {audienceText || "尚未选择可见身份"}可以看到。辱骂、威胁和泄露隐私的内容不能发布。
                  </div>
                  <button type="button" onClick={() => void submitPost()} disabled={busy || !title.trim() || !body.trim() || !viewerRoles.length} className="button-primary mt-5 w-full disabled:cursor-not-allowed disabled:opacity-50">
                    {busy ? "正在发布…" : "发布到社区"}
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
