import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { InfoCard } from "@/components/Cards";
import { PageHero } from "@/components/PageHero";
import { SectionHeader } from "@/components/SectionHeader";
import {
  DemoProfile,
  SavedSweetRecord,
  clearSweetRecords,
  deleteSweetRecord,
  getDemoProfile,
  getSavedSweetRecords,
  saveDemoProfile,
} from "@/lib/localRecords";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function recordPreview(record: SavedSweetRecord) {
  return record.records
    .map((step) => {
      const filled = step.fields.filter((field) =>
        Array.isArray(field.value) ? field.value.length > 0 : field.value.trim().length > 0,
      );
      return `${step.label} ${filled.length}/${step.fields.length}`;
    })
    .join(" / ");
}

export default function AccountPage() {
  const [profile, setProfile] = useState<DemoProfile | null>(null);
  const [records, setRecords] = useState<SavedSweetRecord[]>([]);
  const [name, setName] = useState("");
  const [role, setRole] = useState("学生");
  const [notice, setNotice] = useState("");

  function refreshRecords() {
    setRecords(getSavedSweetRecords());
  }

  useEffect(() => {
    const savedProfile = getDemoProfile();
    setProfile(savedProfile);
    setName(savedProfile?.name || "");
    setRole(savedProfile?.role || "学生");
    refreshRecords();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setNotice("可以先填写一个昵称，方便演示登录状态。");
      return;
    }
    saveDemoProfile({ name: name.trim(), role });
    setProfile(getDemoProfile());
    setNotice("已保存原型登录信息。");
  }

  function handleDelete(recordId: string) {
    deleteSweetRecord(recordId);
    refreshRecords();
  }

  function handleClear() {
    clearSweetRecords();
    refreshRecords();
  }

  return (
    <>
      <PageHero
        label="Account Prototype"
        title="我的记录"
        subtitle="这是青序计划的登录与数据保存原型。当前记录只保存在这台设备的浏览器中，用于演示“填写、保存、回看”的产品闭环。"
      />

      <section className="section section-muted">
        <div className="container grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="card">
            <p className="eyebrow">Demo Login</p>
            <h2 className="mt-3 text-[1.7rem] font-bold leading-[1.25] text-ink">原型登录</h2>
            <p className="mt-4 text-[0.95rem] leading-7 text-muted">
              这里不会创建真实线上账号，也不会上传个人信息。它用于先展示未来账号系统的基本体验。
            </p>
            <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
              <label className="grid gap-2 text-sm font-bold text-ink">
                昵称
                <input
                  className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：Irene"
                />
              </label>
              <label className="grid gap-2 text-sm font-bold text-ink">
                角色
                <select
                  className="rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-sm outline-none focus:border-sage"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                >
                  <option>学生</option>
                  <option>家长</option>
                  <option>老师</option>
                  <option>学校合作方</option>
                </select>
              </label>
              <button type="submit" className="button-primary w-fit">
                保存登录状态
              </button>
            </form>
            {notice ? <p className="mt-4 text-sm font-bold text-sage-dark">{notice}</p> : null}
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <InfoCard title={profile ? profile.name : "未登录"} label="Current profile">
              {profile ? `当前角色：${profile.role}。这个状态只保存在本机浏览器中。` : "填写左侧昵称后，可以看到一个原型登录状态。"}
            </InfoCard>
            <InfoCard title={`${records.length} 条`} label="Saved SWEET records">
              已保存的 SWEET 记录会出现在下方，方便回看最近的生活节律变化。
            </InfoCard>
            <InfoCard title="本地保存" label="Privacy note">
              当前原型不会把记录上传到服务器。换设备、清除浏览器数据后，记录可能消失。
            </InfoCard>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeader
            title="已保存的 SWEET 记录"
            description="填写 SWEET 节律记录并生成小结后，可以在结果页点击“保存到我的记录”。"
          />
          {records.length > 0 ? (
            <div className="grid gap-5">
              {records.map((record) => (
                <article key={record.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-sage">{formatDate(record.createdAt)}</p>
                      <h3 className="mt-2 text-xl font-bold text-ink">SWEET 节律记录</h3>
                    </div>
                    <button type="button" className="button-secondary px-4 py-2 text-xs" onClick={() => handleDelete(record.id)}>
                      删除
                    </button>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-muted">{recordPreview(record)}</p>
                  {record.summary ? <p className="mt-4 text-[0.95rem] leading-7 text-muted">{record.summary}</p> : null}
                  {record.smallStep ? (
                    <p className="mt-4 rounded-2xl bg-cream p-4 text-sm font-bold leading-7 text-sage-dark">
                      可以先做的一件小事：{record.smallStep}
                    </p>
                  ) : null}
                  {record.recommendedNextTool ? (
                    <p className="mt-3 text-sm leading-7 text-muted">推荐下一步：{record.recommendedNextTool}</p>
                  ) : null}
                </article>
              ))}
              <button type="button" className="button-secondary w-fit" onClick={handleClear}>
                清空所有本地记录
              </button>
            </div>
          ) : (
            <div className="card">
              <h3 className="text-xl font-bold text-ink">还没有保存记录</h3>
              <p className="mt-4 text-[0.95rem] leading-7 text-muted">
                可以先完成一次 SWEET 节律记录，生成小结后保存到这里。
              </p>
              <Link href="/check-in" className="button-primary mt-6">
                开始 SWEET 节律记录
              </Link>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
