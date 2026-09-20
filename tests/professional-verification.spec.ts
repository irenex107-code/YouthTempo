import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  parseProfessionalVerificationReview,
  parseProfessionalVerificationSubmission,
} from "@/lib/professionalVerification";

const migrationPath = path.resolve(
  process.cwd(),
  "supabase/migrations/20260805065134_add_professional_verification_workflow.sql",
);
const defaultMigrationPath = path.resolve(
  process.cwd(),
  "supabase/migrations/20260805065912_set_professional_verification_pending_default.sql",
);
const individualApplicantMigrationPath = path.resolve(
  process.cwd(),
  "supabase/migrations/20260912161714_allow_individual_professional_applicants.sql",
);

const validSubmission = {
  institutionName: "青少年心理支持中心",
  positionTitle: "心理咨询师",
  credentialType: "专业能力证书",
  credentialNumber: "YT-2026-001",
  credentialIssuer: "专业登记机构",
  credentialExpiresOn: null,
  evidenceReference: "平台核验材料编号 YT-E2E-001",
  applicantStatement: "主要参与青少年支持工作。",
};

test("专业身份申请会清理文本并接受没有到期日的长期资质", () => {
  expect(parseProfessionalVerificationSubmission({
    ...validSubmission,
    institutionName: "  青少年心理支持中心  ",
  })).toMatchObject({
    institutionName: "青少年心理支持中心",
    credentialExpiresOn: null,
  });
});

test("个人专业申请可以不填写所属机构", () => {
  expect(parseProfessionalVerificationSubmission({
    ...validSubmission,
    institutionName: "   ",
  })).toMatchObject({
    institutionName: null,
    positionTitle: "心理咨询师",
  });
});

test("专业身份申请拒绝不完整或已经过期的资质", () => {
  expect(() => parseProfessionalVerificationSubmission({
    ...validSubmission,
    credentialNumber: "",
  })).toThrow("请填写资质编号");
  expect(() => parseProfessionalVerificationSubmission({
    ...validSubmission,
    credentialExpiresOn: "2020-01-01",
  })).toThrow("已过期");
});

test("非通过类审核必须留下具体说明", () => {
  expect(() => parseProfessionalVerificationReview({
    userId: "00000000-0000-4000-8000-000000000001",
    action: "reject",
    note: "不行",
  })).toThrow("至少 5 个字");
  expect(parseProfessionalVerificationReview({
    userId: "00000000-0000-4000-8000-000000000001",
    action: "request_changes",
    note: "请补充机构公开人员页面。",
  })).toMatchObject({ action: "request_changes" });
});

test("迁移启用服务端专用 RLS、审核约束、到期索引和审计事件", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  expect(sql).toContain("professional_verification_events_server_only");
  expect(sql).toContain("revoke all on table public.professional_verification_events from anon, authenticated");
  expect(sql).toContain("professional_verifications_active_review_check");
  expect(sql).toContain("professional_verifications_active_expiry_idx");
  expect(sql).toContain("youthtempo-expire-professional-verifications");
  expect(sql).toContain("create or replace function public.expire_professional_verifications()");
  expect(sql).toContain("grant execute on function public.submit_professional_verification");
  expect(sql).toContain("grant execute on function public.review_professional_verification");
  expect(sql).toContain("to service_role");
  expect(sql).not.toMatch(/grant execute[^;]+to authenticated/is);
});

test("审核通过会同步专业角色，其他结论会撤销专业角色", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  expect(sql).toContain("set role = '专业支持者'");
  expect(sql).toContain("set role = '学生'");
  expect(sql).toContain("where id = p_user_id");
});

test("新专业身份记录在迁移与完整结构中都默认等待审核", () => {
  const migration = fs.readFileSync(defaultMigrationPath, "utf8");
  const schema = fs.readFileSync(path.resolve(process.cwd(), "supabase/schema.sql"), "utf8");
  expect(migration).toContain("alter column status set default 'pending'");
  expect(schema).toContain("status text not null default 'pending'");
});

test("个人申请审核不再以机构信息作为通过前提", () => {
  const migration = fs.readFileSync(individualApplicantMigrationPath, "utf8");
  const schema = fs.readFileSync(path.resolve(process.cwd(), "supabase/schema.sql"), "utf8");
  for (const sql of [migration, schema]) {
    expect(sql).not.toContain("or verification.institution_name is null");
    expect(sql).toContain("institution_verified = p_action = 'approve' and institution_name is not null");
    expect(sql).toContain("and credential_verified");
    expect(sql).toContain("and credential_type is not null");
    expect(sql).toContain("and credential_number is not null");
    expect(sql).toContain("and credential_issuer is not null");
  }
  expect(migration).toContain("security invoker");
  expect(migration).toContain("revoke all on function public.review_professional_verification");
  expect(migration).toContain("to service_role");
});

test("个人申请表和审核台都把机构信息视为选填", () => {
  const card = fs.readFileSync(path.resolve(process.cwd(), "components/ProfessionalVerificationCard.tsx"), "utf8");
  const queue = fs.readFileSync(path.resolve(process.cwd(), "components/ProfessionalVerificationQueue.tsx"), "utf8");
  const institutionInput = card.match(/<input[^>]+value=\{form\.institutionName\}[^>]+\/>/)?.[0] || "";
  expect(institutionInput).not.toContain("required");
  expect(queue).toContain("机构信息可以不填");
  expect(queue).not.toContain("item.institution_name && item.position_title");
});

test("社区专业标记会排除已过期资质", () => {
  const identity = fs.readFileSync(path.resolve(process.cwd(), "lib/community.ts"), "utf8");
  const posts = fs.readFileSync(path.resolve(process.cwd(), "pages/api/community/posts.ts"), "utf8");
  expect(identity).toContain("credential_expires_on.is.null,credential_expires_on.gte");
  expect(posts).toContain("credential_expires_on.is.null,credential_expires_on.gte");
});
