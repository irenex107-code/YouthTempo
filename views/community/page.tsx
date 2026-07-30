import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  createCommunityComment,
  createCommunityPost,
  getCurrentUser,
  listCommunityPosts,
  reportCommunityContent,
  type CommunityPost,
  type CommunityRole,
} from "@/lib/cloudRecords";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";

const roleOptions: Array<{ key: CommunityRole; label: string; hint: string }> = [
  { key: "student", label: "学生", hint: "同龄人之间交流和回应" },
  { key: "guardian", label: "家长", hint: "分享陪伴中的经验与困惑" },
  { key: "teacher", label: "老师", hint: "提供校园中的观察和建议" },
  { key: "professional", label: "专业支持者", hint: "由平台确认身份后参与回复" },
];

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function RoleBadge({ label, verified }: { label: string; verified?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-mist px-2.5 py-1 text-xs font-bold text-sage-dark">
      {label}{verified ? " · 已认证" : ""}
    </span>
  );
}

export default function CommunityPage() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [currentRole, setCurrentRole] = useState<CommunityRole>("student");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [viewerRoles, setViewerRoles] = useState<CommunityRole[]>(["student", "guardian", "teacher", "professional"]);
  const [commenterRoles, setCommenterRoles] = useState<CommunityRole[]>(["student", "guardian", "teacher", "professional"]);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const user = await getCurrentUser();
      setLoggedIn(Boolean(user));
      if (!user) return;
      const data = await listCommunityPosts();
      setPosts(data.posts);
      setCurrentRole(data.currentUser.role);
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
          : "已经发布。只有你选择的身份可以看到和参与。",
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
          : "回复已发布。",
      );
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "暂时无法回复。");
    } finally {
      setBusy(false);
    }
  }

  async function report(postId?: string, commentId?: string) {
    const reason = window.prompt("请简单说明举报原因（例如：辱骂、泄露隐私或不当建议）");
    if (!reason?.trim()) return;
    try {
      await reportCommunityContent({ postId, commentId, reason: reason.trim() });
      setNotice("举报已收到，平台会查看这条内容。");
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : "举报提交失败。");
    }
  }

  return (
    <>
      <PageHero
        title="家校医社区"
        subtitle="在这里发起讨论、交换经验，也可以邀请老师和专业支持者一起回应。每次发布时，都由你决定哪些人能看、哪些人能评论。"
        action={
          loggedIn === false ? (
            <Link href="/account?next=/community" className="button-primary">登录后进入社区</Link>
          ) : (
            <a href="#new-post" className="button-primary">发起一个话题</a>
          )
        }
      />

      <section className="section section-muted">
        <div className="container">
          {loggedIn === false ? (
            <div className="card max-w-3xl">
              <h2 className="text-xl font-bold text-ink">社区只向已登录成员开放</h2>
              <p className="mt-3 text-sm leading-7 text-muted">
                登录用于确认学生、家长、老师或专业支持者身份；加入社区不会改变任何 SWEET 记录的查看权限。
              </p>
              <Link href="/account?next=/community" className="button-primary mt-5">登录或创建账户</Link>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[0.86fr_1.14fr]">
              <div id="new-post" className="card h-fit lg:sticky lg:top-28">
                <p className="eyebrow">发起话题</p>
                <h2 className="mt-2 text-2xl font-bold text-ink">今天想和谁聊聊？</h2>
                <label className="mt-6 block text-sm font-bold text-ink">
                  标题
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    maxLength={80}
                    className="mt-2 w-full rounded-2xl border border-ink/10 bg-white px-4 py-3 font-normal outline-none focus:border-sage"
                    placeholder="一句话说清想讨论什么"
                  />
                </label>
                <label className="mt-4 block text-sm font-bold text-ink">
                  内容
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    maxLength={3000}
                    rows={6}
                    className="mt-2 w-full resize-y rounded-2xl border border-ink/10 bg-white px-4 py-3 font-normal leading-7 outline-none focus:border-sage"
                    placeholder="可以分享近况、提问，或写下希望得到怎样的回应。"
                  />
                </label>

                <fieldset className="mt-5">
                  <legend className="text-sm font-bold text-ink">哪些人可以看到？</legend>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {roleOptions.map((role) => (
                      <label key={role.key} className="flex cursor-pointer gap-3 rounded-2xl border border-ink/10 bg-white/75 p-3">
                        <input
                          type="checkbox"
                          checked={viewerRoles.includes(role.key)}
                          onChange={() => toggleViewer(role.key)}
                          className="mt-1 accent-sage"
                        />
                        <span>
                          <span className="block text-sm font-bold text-ink">{role.label}</span>
                          <span className="mt-1 block text-xs leading-5 text-muted">{role.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="mt-5">
                  <legend className="text-sm font-bold text-ink">哪些人可以评论？</legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {roleOptions.map((role) => (
                      <label
                        key={role.key}
                        className={`rounded-full border px-3 py-2 text-xs font-bold ${
                          viewerRoles.includes(role.key)
                            ? "cursor-pointer border-sage/40 bg-white text-ink"
                            : "cursor-not-allowed border-ink/5 bg-cream text-muted/50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mr-2 accent-sage"
                          disabled={!viewerRoles.includes(role.key)}
                          checked={commenterRoles.includes(role.key)}
                          onChange={() => toggleCommenter(role.key)}
                        />
                        {role.label}
                      </label>
                    ))}
                  </div>
                </fieldset>

                <p className="mt-5 rounded-2xl bg-cream px-4 py-3 text-xs leading-6 text-muted">
                  当前可见：{audienceText || "尚未选择"}。辱骂、威胁和泄露他人隐私的内容不能发布。
                </p>
                <button
                  type="button"
                  onClick={() => void submitPost()}
                  disabled={busy || !title.trim() || !body.trim() || !viewerRoles.length}
                  className="button-primary mt-5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "正在发布…" : "发布话题"}
                </button>
              </div>

              <div>
                <SectionHeader
                  title="社区正在聊"
                  description={`你现在以“${roleOptions.find((item) => item.key === currentRole)?.label || "成员"}”身份浏览，只会看到向这个身份开放的内容。`}
                />
                {notice ? <p className="mb-4 rounded-2xl bg-mist px-4 py-3 text-sm text-sage-dark">{notice}</p> : null}
                {error ? <p className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
                {!posts.length && loggedIn ? (
                  <div className="card">
                    <h2 className="text-lg font-bold text-ink">还没有向你开放的话题</h2>
                    <p className="mt-2 text-sm leading-7 text-muted">可以从左侧发起第一个话题，并选择希望一起参与的人。</p>
                  </div>
                ) : null}
                <div className="space-y-5">
                  {posts.map((post) => (
                    <article key={post.id} className="card">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-ink">{post.author_name}</span>
                          <RoleBadge label={post.author_role_label} verified={post.verified_professional} />
                          <span className="text-xs text-muted">{formatTime(post.created_at)}</span>
                        </div>
                        <button type="button" onClick={() => void report(post.id)} className="text-xs font-bold text-muted hover:text-ink">
                          举报
                        </button>
                      </div>
                      <h2 className="mt-4 text-xl font-bold leading-snug text-ink">{post.title}</h2>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted">{post.body}</p>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted">
                        <span className="rounded-full bg-cream px-3 py-1.5">
                          可见：{roleOptions.filter((item) => post.viewer_roles.includes(item.key)).map((item) => item.label).join("、")}
                        </span>
                        <span className="rounded-full bg-cream px-3 py-1.5">
                          可评论：{post.commenter_roles.length
                            ? roleOptions.filter((item) => post.commenter_roles.includes(item.key)).map((item) => item.label).join("、")
                            : "仅阅读"}
                        </span>
                      </div>

                      <div className="mt-5 border-t border-ink/10 pt-5">
                        <h3 className="text-sm font-bold text-ink">回应 {post.comments.length ? `· ${post.comments.length}` : ""}</h3>
                        <div className="mt-3 space-y-3">
                          {post.comments.map((comment) => (
                            <div key={comment.id} className="rounded-2xl bg-cream px-4 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-bold text-ink">{comment.author_name}</span>
                                  <RoleBadge label={comment.author_role_label} verified={comment.verified_professional} />
                                  <span className="text-xs text-muted">{formatTime(comment.created_at)}</span>
                                </div>
                                <button type="button" onClick={() => void report(undefined, comment.id)} className="text-xs text-muted hover:text-ink">
                                  举报
                                </button>
                              </div>
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted">{comment.body}</p>
                            </div>
                          ))}
                        </div>
                        {post.can_comment ? (
                          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                            <textarea
                              value={commentDrafts[post.id] || ""}
                              onChange={(event) => setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))}
                              rows={2}
                              maxLength={1200}
                              className="min-h-12 flex-1 resize-y rounded-2xl border border-ink/10 bg-white px-4 py-3 text-sm leading-6 outline-none focus:border-sage"
                              placeholder="写下温和、具体的回应"
                            />
                            <button
                              type="button"
                              onClick={() => void submitComment(post.id)}
                              disabled={busy || !commentDrafts[post.id]?.trim()}
                              className="button-secondary self-end disabled:opacity-50"
                            >
                              回复
                            </button>
                          </div>
                        ) : (
                          <p className="mt-4 text-xs leading-6 text-muted">这条内容向你开放阅读，但发布者没有向你的身份开放评论。</p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
