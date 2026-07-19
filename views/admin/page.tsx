import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import { getSupabase } from "@/lib/supabaseClient";
import { handleAuthRedirect } from "@/lib/cloudRecords";

type AdminOverview = {
  admin: { email: string; role: string; status: string };
  counts: {
    profiles: number;
    sweetRecords: number;
    permissions: number;
    wechatBindings: number;
  };
  recentPermissions: Array<{
    id: string;
    grantee_email: string;
    permission_type: string;
    status: string;
    created_at: string;
  }>;
};

function permissionLabel(value: string) {
  if (value === "guardian_view") return "家长查看摘要";
  if (value === "school_support") return "学校支持协作";
  return "试点反馈研究";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function AdminPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadAdminOverview() {
      setLoading(true);
      setError("");
      try {
        await handleAuthRedirect();
        const supabase = getSupabase();
        if (!supabase) throw new Error("Supabase 还没有配置完成。");
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const token = data.session?.access_token;
        if (!token) throw new Error("请先登录管理员账号，再进入试点管理台。");

        const response = await fetch("/api/admin/overview", {
          headers: { authorization: `Bearer ${token}` },
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "管理员概览加载失败。");
        setOverview(payload as AdminOverview);
      } catch (adminError) {
        setError(adminError instanceof Error ? adminError.message : "管理员概览加载失败。");
      } finally {
        setLoading(false);
      }
    }

    loadAdminOverview();
  }, []);

  return (
    <>
      <PageHero
        label="Pilot Admin"
        title="试点管理台"
        subtitle="用一个轻量入口查看试点概览、家校授权和后续反馈，不把青少年用户卷进复杂权限。"
      />

      <section className="section section-muted">
        <div className="container">
          {loading ? <div className="card text-sm font-bold text-muted">正在检查管理员权限……</div> : null}
          {!loading && error ? (
            <div className="card max-w-3xl">
              <p className="eyebrow">Access</p>
              <h2 className="mt-3 text-[1.6rem] font-bold text-ink">需要管理员权限</h2>
              <p className="mt-4 text-[0.95rem] leading-7 text-muted">{error}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/account" className="button-primary">去登录 / 我的记录</Link>
                <Link href="/contact" className="button-secondary">查看联系入口</Link>
              </div>
            </div>
          ) : null}

          {overview ? (
            <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr] lg:gap-8">
              <div className="card">
                <p className="eyebrow">Signed in as admin</p>
                <h2 className="mt-3 text-[1.6rem] font-bold leading-tight text-ink">{overview.admin.email}</h2>
                <p className="mt-4 text-[0.95rem] leading-7 text-muted">
                  前台角色保持清楚：学生、家长、学校支持人员。管理员不出现在用户选择里，只由后台权限表控制。
                </p>
                <div className="mt-6 grid gap-3">
                  {[
                    ["学生", "填写 SWEET、保存自己的记录、主动决定是否授权家长或学校查看摘要。"],
                    ["家长", "围绕孩子授权的信息参与支持，不默认看到孩子全部记录。"],
                    ["学校支持人员", "适合试点学校、老师或心理老师，用于被授权后的协作支持。"],
                    ["管理员", "查看试点概览、授权关系和后续反馈入口。"],
                  ].map(([title, text]) => (
                    <div key={title} className="rounded-2xl bg-cream px-4 py-4">
                      <p className="text-sm font-bold text-ink">{title}</p>
                      <p className="mt-2 text-sm leading-6 text-muted">{text}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="card">
                  <p className="text-xs font-bold text-sage">用户资料</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.profiles}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">已创建账户资料数。</p>
                </div>
                <div className="card">
                  <p className="text-xs font-bold text-sage">SWEET 记录</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.sweetRecords}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">云端保存的节律记录。</p>
                </div>
                <div className="card">
                  <p className="text-xs font-bold text-sage">家校授权</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.permissions}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">用户主动创建的家长或学校授权。</p>
                </div>
                <div className="card">
                  <p className="text-xs font-bold text-sage">微信绑定</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.wechatBindings}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">已绑定微信身份数量。</p>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {overview ? (
        <section className="section">
          <div className="container">
            <SectionHeader
              title="最近家校授权"
              description="这里先显示最近创建的家长或学校授权，帮助你在试点阶段检查权限是否清楚、是否可撤销。"
            />
            <div className="grid gap-4">
              {overview.recentPermissions.length > 0 ? overview.recentPermissions.map((permission) => (
                <article key={permission.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-ink">{permission.grantee_email}</h3>
                      <p className="mt-2 text-sm leading-7 text-muted">
                        {permissionLabel(permission.permission_type)} / 状态：{permission.status}
                      </p>
                    </div>
                    <p className="rounded-full bg-cream px-4 py-2 text-xs font-bold text-sage-dark">{formatDate(permission.created_at)}</p>
                  </div>
                </article>
              )) : <div className="card text-sm font-bold text-muted">还没有家校授权关系。</div>}
            </div>
          </div>
        </section>
      ) : null}

      <section className="section section-muted">
        <div className="container grid gap-6 lg:grid-cols-[1fr_0.7fr]">
          <div className="card">
            <h2 className="text-[1.6rem] font-bold text-ink">下一步再接入反馈表</h2>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">
              当前管理台先处理账号、记录和授权概览。后续可以把联系我们、学校试点报名、用户反馈统一保存到数据库，再在这里显示处理状态。
            </p>
          </div>
          <div className="card">
            <h3 className="text-xl font-bold text-ink">保持简单</h3>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">
              学校先作为“学校支持人员”接入，通过学生主动授权参与，不先做复杂班级或组织架构。
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
