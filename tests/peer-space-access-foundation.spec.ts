import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  ADULT_PEER_SPACE_CODE,
  INITIAL_PEER_SPACE_RULES_VERSION,
  isEligibleForAdultPeerSpace,
} from "@/lib/peerSpaceAccess";
import { STUDENT_CONSENT_POLICY_VERSION } from "@/lib/studentConsent";

const userId = "00000000-0000-4000-8000-000000000101";
const otherUserId = "00000000-0000-4000-8000-000000000102";
const spaceId = "00000000-0000-4000-8000-000000000018";
const cohortId = "00000000-0000-4000-8000-000000000201";
const now = new Date("2026-09-17T12:00:00.000Z");

function eligibility(overrides: Record<string, unknown> = {}) {
  return {
    authenticatedUserId: userId,
    profileRole: "学生",
    consent: {
      age_band: "18_plus",
      consent_basis: "adult_self",
      policy_version: STUDENT_CONSENT_POLICY_VERSION,
      status: "active",
      student_assented_at: "2026-09-16T12:00:00.000Z",
    },
    membership: {
      id: "00000000-0000-4000-8000-000000000301",
      user_id: userId,
      space_id: spaceId,
      cohort_id: cohortId,
      status: "invited",
      accepted_rules_version: null,
      accepted_rules_at: null,
      created_at: "2026-09-16T12:00:00.000Z",
    },
    space: {
      id: spaceId,
      code: ADULT_PEER_SPACE_CODE,
      age_scope: "18_plus",
      status: "invite_only",
      rules_version: INITIAL_PEER_SPACE_RULES_VERSION,
    },
    cohort: {
      id: cohortId,
      space_id: spaceId,
      status: "active",
      starts_at: "2026-09-01T00:00:00.000Z",
      ends_at: "2026-10-01T00:00:00.000Z",
    },
    now,
    ...overrides,
  } as Parameters<typeof isEligibleForAdultPeerSpace>[0];
}

test("只有有效成年人本人确认和明确试点邀请同时存在时才有资格", () => {
  expect(isEligibleForAdultPeerSpace(eligibility())).toBe(true);
  expect(isEligibleForAdultPeerSpace(eligibility({ membership: null }))).toBe(false);
  expect(isEligibleForAdultPeerSpace(eligibility({
    consent: {
      ...eligibility().consent,
      age_band: "14_17",
      consent_basis: "student_self_pilot",
    },
  }))).toBe(false);
  expect(isEligibleForAdultPeerSpace(eligibility({
    consent: { ...eligibility().consent, status: "withdrawn" },
  }))).toBe(false);
});

test("家长、老师和伪造其他用户 membership 都不能进入", () => {
  expect(isEligibleForAdultPeerSpace(eligibility({ profileRole: "家长" }))).toBe(false);
  expect(isEligibleForAdultPeerSpace(eligibility({ profileRole: "学校支持人员" }))).toBe(false);
  expect(isEligibleForAdultPeerSpace(eligibility({
    membership: { ...eligibility().membership!, user_id: otherUserId },
  }))).toBe(false);
});

test("暂停、过期或尚未开始的批次不授予入口", () => {
  expect(isEligibleForAdultPeerSpace(eligibility({
    cohort: { ...eligibility().cohort!, status: "paused" },
  }))).toBe(false);
  expect(isEligibleForAdultPeerSpace(eligibility({
    cohort: { ...eligibility().cohort!, starts_at: "2026-09-18T00:00:00.000Z" },
  }))).toBe(false);
  expect(isEligibleForAdultPeerSpace(eligibility({
    cohort: { ...eligibility().cohort!, ends_at: "2026-09-17T12:00:00.000Z" },
  }))).toBe(false);
});

test("迁移只建立服务端授权骨架和唯一公共房间", async () => {
  const migrationPath = path.join(
    process.cwd(),
    "supabase/migrations/20260917011148_add_peer_space_access_foundation.sql",
  );
  const [migration, schema] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(path.join(process.cwd(), "supabase/schema.sql"), "utf8"),
  ]);

  for (const sql of [migration, schema]) {
    expect(sql).toContain("create table public.peer_space_memberships");
    expect(sql).toContain("create table public.peer_space_room_memberships");
    expect(sql).toContain("check (room_type = 'everyone')");
    expect(sql).toContain("revoke all on table public.peer_space_memberships from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select, insert, update on table public.peer_space_memberships to service_role");
    expect(sql).toContain("create or replace function public.accept_peer_space_rules");
    expect(sql).not.toContain("create table public.peer_space_messages");
    expect(sql).not.toContain("realtime.messages");
  }
});

test("未登录不能读取资格或确认规则", async ({ request }) => {
  const access = await request.get("/api/peer-space/access");
  expect(access.status()).toBe(401);

  const rules = await request.post("/api/peer-space/rules", {
    data: {
      accepted: true,
      rulesVersion: INITIAL_PEER_SPACE_RULES_VERSION,
    },
  });
  expect(rules.status()).toBe(401);
});

test("规则 API 只把当前 session 用户交给原子数据库操作", async () => {
  const source = await readFile(
    path.join(process.cwd(), "pages/api/peer-space/rules.ts"),
    "utf8",
  );
  expect(source).toContain("p_user_id: user.id");
  expect(source).toContain("p_membership_id: decision.membershipId");
  expect(source).toContain("isPeerSpaceAccessApiEnabled()");
  expect(source).not.toContain("req.body?.userId");
  expect(source).not.toContain("req.body?.schoolId");
});
