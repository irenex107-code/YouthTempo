import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { PageHero } from "@/components/PageHero";
import { getSupabase } from "@/lib/supabaseClient";
import type { PilotFeedbackRole, PilotFeedbackRow } from "@/lib/pilotFeedback";

type FormState = {
  overallExperience: number;
  clarity: number;
  safety: number;
  mostHelpful: string;
  hardToUse: string;
  suggestion: string;
  mayContact: boolean;
};

const emptyForm: FormState = {
  overallExperience: 0,
  clarity: 0,
  safety: 0,
  mostHelpful: "",
  hardToUse: "",
  suggestion: "",
  mayContact: false,
};

const roleLabels: Record<PilotFeedbackRole, string> = { student: "学生", guardian: "家长", teacher: "老师" };
const ratingLabels = ["很不顺", "不太顺", "还可以", "比较顺", "很顺"];

function formFromFeedback(feedback: PilotFeedbackRow | null): FormState {
  if (!feedback) return emptyForm;
  return {
    overallExperience: feedback.overall_experience,
    clarity: feedback.clarity,
    safety: feedback.safety,
    mostHelpful: feedback.most_helpful,
    hardToUse: feedback.hard_to_use,
    suggestion: feedback.suggestion,
    mayContact: feedback.may_contact,
  };
}

function RatingQuestion({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <fieldset className="rounded-3xl border border-ink/10 bg-white p-4 sm:p-5">
      <legend className="px-1 text-base font-bold leading-7 text-ink">{label}</legend>
      <div className="mt-3 grid grid-cols-5 gap-2" aria-label={`${label}，1 到 5 分`}>
        {[1, 2, 3, 4, 5].map((rating) => (
          <label key={rating} className={`flex min-h-14 cursor-pointer flex-col items-center justify-center rounded-2xl border px-1 py-2 text-center transition ${value === rating ? "border-sage-dark bg-sage-dark text-white" : "border-ink/10 bg-paper text-ink hover:border-sage"}`}>
            <input className="sr-only" type="radio" name={label} value={rating} checked={value === rating} onChange={() => onChange(rating)} />
            <span className="text-lg font-extrabold">{rating}</span>
            <span className="mt-1 hidden text-[0.65rem] font-bold leading-4 sm:block">{ratingLabels[rating - 1]}</span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted"><span>不太好</span><span>很好</span></div>
    </fieldset>
  );
}

export default function PilotFeedbackPage() {
  const [accessToken, setAccessToken] = useState("");
  const [role, setRole] = useState<PilotFeedbackRole | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [hasSaved, setHasSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const supabase = getSupabase();
        const { data, error: sessionError } = supabase ? await supabase.auth.getSession() : { data: { session: null }, error: null };
        if (sessionError) throw sessionError;
        const token = data.session?.access_token || "";
        setAccessToken(token);
        if (!token) return;
        const response = await fetch("/api/pilot-feedback", { headers: { authorization: `Bearer ${token}` } });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "反馈表暂时没能打开。");
        setRole(body.role as PilotFeedbackRole);
        setForm(formFromFeedback((body.feedback || null) as PilotFeedbackRow | null));
        setHasSaved(Boolean(body.feedback));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "反馈表暂时没能打开。");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.overallExperience || !form.clarity || !form.safety) {
      setError("请为三个问题都选一个分数。");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/pilot-feedback", {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "反馈暂时没能保存，请稍后再试。");
      setForm(formFromFeedback(body.feedback as PilotFeedbackRow));
      setHasSaved(true);
      setNotice(body.notice || "已经收到，谢谢你认真告诉我们。");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "反馈暂时没能保存，请稍后再试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHero
        label="试点反馈"
        title="这次用起来怎么样？"
        subtitle="大约两分钟。说说哪里顺手、哪里卡住，帮助我们把接下来的体验做得更好。"
        action={<Link href="/account" className="button-secondary">返回我的工作台</Link>}
      />

      <section className="section section-muted pt-8 sm:pt-12">
        <div className="container max-w-3xl">
          {notice ? <div className="mb-6 rounded-3xl border border-sage/30 bg-mint p-5" role="status"><p className="text-lg font-bold text-ink">{notice}</p><p className="mt-2 text-sm leading-7 text-muted">之后想补充或修改，随时再打开这份表就可以。</p></div> : null}
          {error ? <p className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">{error}</p> : null}

          {loading ? <div className="card text-sm font-bold text-muted">正在打开反馈表……</div> : null}
          {!loading && !accessToken ? (
            <div className="card text-center">
              <h2 className="text-xl font-bold text-ink">登录后再填写</h2>
              <p className="mt-3 text-sm leading-7 text-muted">这样我们只会保存到你自己的账号，也方便你之后回来修改。</p>
              <Link href="/account?next=/feedback" className="button-primary mt-5">前往登录</Link>
            </div>
          ) : null}

          {!loading && accessToken && role ? (
            <form className="grid gap-5" onSubmit={submitFeedback}>
              <div className="rounded-3xl border border-sage/20 bg-mint/50 p-5">
                <p className="text-sm font-bold text-sage-dark">当前以{roleLabels[role]}身份填写</p>
                <p className="mt-2 text-sm leading-7 text-muted">不会显示给学校负责人、老师、家长或学生。平台只会用这些反馈改善试点；只有你主动同意联系时，平台才会看到登录邮箱。</p>
              </div>

              <RatingQuestion label="整体用起来顺不顺？" value={form.overallExperience} onChange={(value) => setForm((current) => ({ ...current, overallExperience: value }))} />
              <RatingQuestion label="页面和提示看得懂吗？" value={form.clarity} onChange={(value) => setForm((current) => ({ ...current, clarity: value }))} />
              <RatingQuestion label="使用时觉得安心吗？" value={form.safety} onChange={(value) => setForm((current) => ({ ...current, safety: value }))} />

              <div className="card grid gap-5">
                <p className="rounded-2xl bg-cream px-4 py-3 text-sm leading-6 text-muted">请不要写其他人的姓名、联系方式或能认出具体身份的信息。</p>
                {[
                  ["mostHelpful", "哪一部分最有帮助？", "例如：记录以后更容易看懂最近的状态。"],
                  ["hardToUse", "哪里让你停下来，或不太明白？", "例如：某个按钮不好找，或一段说明读不懂。"],
                  ["suggestion", "如果只能改一件事，你希望改什么？", "想到什么就说什么，不用写得很正式。"],
                ].map(([key, label, placeholder]) => (
                  <label key={key} className="grid gap-2 text-sm font-bold text-ink">
                    {label}
                    <textarea
                      className="field-control min-h-28 resize-y font-normal leading-7"
                      maxLength={1000}
                      value={form[key as keyof Pick<FormState, "mostHelpful" | "hardToUse" | "suggestion">] as string}
                      onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                      placeholder={placeholder}
                    />
                  </label>
                ))}
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-ink/10 bg-paper p-4 text-sm leading-6 text-ink">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-sage-dark" checked={form.mayContact} onChange={(event) => setForm((current) => ({ ...current, mayContact: event.target.checked }))} />
                  <span><strong>可以联系我进一步了解</strong><span className="mt-1 block text-muted">如有需要，只通过我的登录邮箱联系；不勾选也可以正常提交。</span></span>
                </label>
              </div>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs leading-6 text-muted">{hasSaved ? "保存后会更新你这次的反馈。" : "提交后，你可以随时回来修改。"}</p>
                <button type="submit" className="button-primary w-full sm:w-auto" disabled={saving}>{saving ? "正在保存……" : hasSaved ? "保存修改" : "提交反馈"}</button>
              </div>
            </form>
          ) : null}
        </div>
      </section>
    </>
  );
}
