import { buildSchoolOperations, schoolOperationsCsv, type OperationsDirectory, type OperationsTrend } from "@/lib/schoolOperations";

type Props = {
  directories: OperationsDirectory[];
  trends: OperationsTrend[];
  attentionQueue: Array<{ school_id: string }>;
};

const readinessStyle = {
  待建档: "bg-cream text-muted",
  补关系: "bg-[#f7e8dc] text-[#824b2d]",
  开始使用: "bg-mist text-[#41677a]",
  稳定试点: "bg-mint text-sage-dark",
} as const;

export function SchoolOperationsOverview(props: Props) {
  const operations = buildSchoolOperations(props);

  function downloadSummary() {
    const blob = new Blob([`\uFEFF${schoolOperationsCsv(operations.rows)}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `YouthTempo-学校试点概览-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section id="operations-analytics" className="section scroll-mt-24">
      <div className="container">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">试点运营</p>
            <h2 className="mt-3 text-[1.6rem] font-bold text-ink">学校合作进展</h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">只看学校层面的参与和关系完整度，不比较学生、不做排名。导出的也是汇总数据，不含姓名、邮箱或原始回答。</p>
          </div>
          <button type="button" className="button-secondary" onClick={downloadSummary} disabled={!operations.rows.length}>导出学校汇总</button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="card"><p className="text-xs font-bold text-sage">试点学校</p><p className="mt-2 text-3xl font-bold text-ink">{operations.totals.schools}</p><p className="mt-2 text-xs text-muted">稳定使用 {operations.totals.stableSchools} 所</p></div>
          <div className="card"><p className="text-xs font-bold text-sage">学生</p><p className="mt-2 text-3xl font-bold text-ink">{operations.totals.students}</p><p className="mt-2 text-xs text-muted">当前学校名单</p></div>
          <div className="card"><p className="text-xs font-bold text-sage">近 4 周参与</p><p className="mt-2 text-3xl font-bold text-ink">{operations.totals.participationRate}%</p><p className="mt-2 text-xs text-muted">{operations.totals.activeStudents} 名学生</p></div>
          <div className="card"><p className="text-xs font-bold text-sage">SWEET 记录</p><p className="mt-2 text-3xl font-bold text-ink">{operations.totals.records}</p><p className="mt-2 text-xs text-muted">滚动近 4 周</p></div>
          <div className="card"><p className="text-xs font-bold text-sage">建议了解</p><p className="mt-2 text-3xl font-bold text-ink">{operations.totals.attentionCount}</p><p className="mt-2 text-xs text-muted">只用于安排支持</p></div>
        </div>

        <div className="mt-6 overflow-hidden rounded-[1.75rem] border border-ink/[0.08] bg-paper shadow-soft">
          <div className="hidden grid-cols-[1.3fr_0.8fr_repeat(5,0.72fr)] gap-3 border-b border-ink/10 bg-cream px-5 py-3 text-xs font-bold text-muted lg:grid">
            <span>学校</span><span>阶段</span><span>学生</span><span>参与</span><span>老师关系</span><span>家庭关系</span><span>待了解</span>
          </div>
          {operations.rows.length ? operations.rows.map((row) => (
            <article key={row.schoolId} className="grid gap-4 border-b border-ink/10 px-5 py-5 last:border-0 lg:grid-cols-[1.3fr_0.8fr_repeat(5,0.72fr)] lg:items-center lg:gap-3">
              <div><p className="font-bold text-ink">{row.schoolName}</p><p className="mt-1 text-xs text-muted">老师 {row.teachers} · 家长 {row.guardians} · 记录 {row.records}</p></div>
              <div><span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${readinessStyle[row.readiness]}`}>{row.readiness}</span></div>
              <p className="text-sm"><span className="text-xs text-muted lg:hidden">学生 </span><strong>{row.students}</strong></p>
              <p className="text-sm"><span className="text-xs text-muted lg:hidden">近 4 周参与 </span><strong>{row.activeStudents}</strong> · {row.participationRate}%</p>
              <p className="text-sm"><span className="text-xs text-muted lg:hidden">老师关系 </span><strong>{row.teacherCoverage}%</strong></p>
              <p className="text-sm"><span className="text-xs text-muted lg:hidden">家庭关系 </span><strong>{row.guardianCoverage}%</strong></p>
              <p className="text-sm"><span className="text-xs text-muted lg:hidden">建议了解 </span><strong>{row.attentionCount}</strong></p>
            </article>
          )) : <p className="px-5 py-8 text-sm text-muted">还没有学校试点数据。</p>}
        </div>
      </div>
    </section>
  );
}
