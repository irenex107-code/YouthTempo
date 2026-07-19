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
    schools: number;
    schoolMembers: number;
    wechatBindings: number;
  };
  recentRecords: Array<{
    id: string;
    user_id: string;
    school_id: string | null;
    summary: string | null;
    created_at: string;
  }>;
};

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
        subtitle="以学校空间管理 B2B2C 试点：学生属于学校，学校支持人员查看本校学生记录，用于更早支持和跟进。"
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
                  当前权限模型从“学生手动授权”切换为“学校空间”。学校试点开通后，学生账号归属某个学校，学校支持人员天然查看本校学生记录。
                </p>
                <div className="mt-6 grid gap-3">
                  {[
                    ["学生", "填写 SWEET、保存自己的记录；加入学校空间后，记录可被本校支持人员查看。"],
                    ["学校支持人员", "老师、心理老师或项目负责人，查看本校学生记录并用于支持跟进。"],
                    ["家长", "家长端暂时不作为核心数据查看方，后续根据试点协议再扩展。"],
                    ["管理员", "配置学校空间、查看试点概览和后续反馈入口。"],
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
                  <p className="text-xs font-bold text-sage">学校空间</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.schools}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">已创建试点学校数。</p>
                </div>
                <div className="card">
                  <p className="text-xs font-bold text-sage">学校成员</p>
                  <p className="mt-3 text-3xl font-bold text-ink">{overview.counts.schoolMembers}</p>
                  <p className="mt-2 text-sm leading-6 text-muted">已配置学校支持人员数。</p>
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
              title="最近 SWEET 记录"
              description="这里先显示最近云端记录，帮助管理员确认学校空间数据链路是否正常。正式试点前还需要补充学校配置入口和更细的查看权限说明。"
            />
            <div className="grid gap-4">
              {overview.recentRecords.length > 0 ? overview.recentRecords.map((record) => (
                <article key={record.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-ink">SWEET 节律记录</h3>
                      <p className="mt-2 text-sm leading-7 text-muted">
                        {record.summary || "这条记录暂时没有摘要。"}
                      </p>
                      <p className="mt-2 text-xs leading-6 text-muted">学校空间：{record.school_id ? "已关联" : "未关联"}</p>
                    </div>
                    <p className="rounded-full bg-cream px-4 py-2 text-xs font-bold text-sage-dark">{formatDate(record.created_at)}</p>
                  </div>
                </article>
              )) : <div className="card text-sm font-bold text-muted">还没有云端 SWEET 记录。</div>}
            </div>
          </div>
        </section>
      ) : null}

      <section className="section section-muted">
        <div className="container grid gap-6 lg:grid-cols-[1fr_0.7fr]">
          <div className="card">
            <h2 className="text-[1.6rem] font-bold text-ink">下一步：学校配置入口</h2>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">
              当前已经有学校空间的数据结构和权限模型。下一步可以做管理员页面里的“创建学校、添加学校支持人员、把学生分配到学校”。
            </p>
          </div>
          <div className="card">
            <h3 className="text-xl font-bold text-ink">保持边界清楚</h3>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">
              学校查看的是本校空间内的学生记录；家长端先不默认开放数据查看，避免试点阶段管理过散。
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
