import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const fixturePath = fileURLToPath(
  new URL("../tests/fixtures/permission-boundary.json", import.meta.url),
);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const cleanup = process.argv.includes("--cleanup");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.E2E_PERMISSION_TEST_PASSWORD;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "需要 NEXT_PUBLIC_SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 才能管理虚拟验收数据。",
  );
}

if (serviceRoleKey.startsWith("sb_publishable_")) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY 不能使用浏览器 publishable key。");
}

if (!cleanup && (!password || password.length < 16)) {
  throw new Error("E2E_PERMISSION_TEST_PASSWORD 至少需要 16 个字符，且不能提交到仓库。");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function assertResult(result, label) {
  if (result.error) throw new Error(`${label}：${result.error.message}`);
  return result.data;
}

async function listAllUsers() {
  const users = [];
  for (let page = 1; page <= 50; page += 1) {
    const data = assertResult(
      await supabase.auth.admin.listUsers({ page, perPage: 200 }),
      "读取 Auth 用户",
    );
    users.push(...data.users);
    if (data.users.length < 200) return users;
  }
  throw new Error("Auth 用户超过测试脚本的安全分页上限，请人工检查后再继续。");
}

async function ensureUsers() {
  const existingByEmail = new Map(
    (await listAllUsers()).flatMap((user) =>
      user.email ? [[user.email.trim().toLowerCase(), user]] : [],
    ),
  );
  const usersByKey = {};

  for (const [key, definition] of Object.entries(fixture.users)) {
    const email = definition.email.toLowerCase();
    const existing = existingByEmail.get(email);
    if (existing) {
      const data = assertResult(
        await supabase.auth.admin.updateUserById(existing.id, {
          password,
          email_confirm: true,
          user_metadata: { display_name: definition.displayName },
        }),
        `更新虚拟账号 ${email}`,
      );
      usersByKey[key] = data.user;
      continue;
    }

    const data = assertResult(
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: definition.displayName },
      }),
      `创建虚拟账号 ${email}`,
    );
    usersByKey[key] = data.user;
  }

  return usersByKey;
}

async function removeFixtures() {
  const fixtureEmails = new Set(
    Object.values(fixture.users).map((definition) => definition.email.toLowerCase()),
  );
  const fixtureUserIds = (await listAllUsers())
    .filter((user) => user.email && fixtureEmails.has(user.email.toLowerCase()))
    .map((user) => user.id);

  assertResult(
    await supabase.from("admin_roles").delete().in("email", [...fixtureEmails]),
    "删除虚拟平台角色",
  );
  for (const userId of fixtureUserIds) {
    assertResult(await supabase.auth.admin.deleteUser(userId), `删除虚拟账号 ${userId}`);
  }
  assertResult(
    await supabase
      .from("schools")
      .delete()
      .in("id", Object.values(fixture.schools).map((school) => school.id)),
    "删除虚拟学校",
  );
  console.log(`已清理 ${fixtureUserIds.length} 个虚拟账号和 2 所 [E2E] 虚拟学校。`);
}

async function createFixtures() {
  assertResult(
    await supabase.from("schools").upsert(
      Object.values(fixture.schools).map((school) => ({
        id: school.id,
        name: school.name,
        status: "active",
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "id" },
    ),
    "创建虚拟学校",
  );

  const users = await ensureUsers();
  const fixtureUserIds = Object.values(users).map((user) => user.id);
  const identifierHashes = fixtureUserIds.map((userId) =>
    createHmac("sha256", process.env.RATE_LIMIT_SECRET || serviceRoleKey)
      .update(`user:${userId}`)
      .digest("hex"),
  );
  assertResult(
    await supabase.from("api_rate_limits").delete().in("identifier_hash", identifierHashes),
    "清理虚拟账号限流计数",
  );
  assertResult(
    await supabase.from("community_restrictions").delete().in("user_id", fixtureUserIds),
    "清理虚拟账号社区限制",
  );

  assertResult(
    await supabase.from("profiles").upsert(
      Object.entries(fixture.users).map(([key, definition]) => ({
        id: users[key].id,
        email: definition.email,
        display_name: definition.displayName,
        role: definition.role,
        school_id: definition.school ? fixture.schools[definition.school].id : null,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "id" },
    ),
    "创建虚拟用户资料",
  );

  assertResult(
    await supabase.from("admin_roles").upsert(
      {
        email: fixture.users.platformAdmin.email,
        role: "管理员",
        status: "active",
        revoked_at: null,
      },
      { onConflict: "email" },
    ),
    "创建虚拟平台管理员",
  );

  assertResult(
    await supabase.from("professional_verifications").upsert(
      {
        user_id: users.professional.id,
        verified_by: users.platformAdmin.id,
        status: "active",
        revoked_at: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    ),
    "创建虚拟专业支持者资质",
  );

  const schoolA = fixture.schools.a.id;
  assertResult(
    await supabase.from("school_members").upsert(
      [
        ["schoolLead", "school_admin"],
        ["teacherOne", "school_support"],
        ["teacherTwo", "school_support"],
      ].map(([key, memberRole]) => ({
        school_id: schoolA,
        user_id: users[key].id,
        email: fixture.users[key].email,
        member_role: memberRole,
        status: "active",
        revoked_at: null,
      })),
      { onConflict: "school_id,user_id" },
    ),
    "创建虚拟学校成员关系",
  );

  assertResult(
    await supabase.from("teacher_student_assignments").upsert(
      [
        ["teacherOne", "studentOne"],
        ["teacherTwo", "studentTwo"],
      ].map(([teacherKey, studentKey]) => ({
        school_id: schoolA,
        teacher_user_id: users[teacherKey].id,
        student_user_id: users[studentKey].id,
        assigned_by: users.schoolLead.id,
        status: "active",
        revoked_at: null,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "school_id,teacher_user_id,student_user_id" },
    ),
    "创建虚拟师生关系",
  );

  assertResult(
    await supabase.from("guardian_student_links").upsert(
      [
        ["guardianOne", "studentOne"],
        ["guardianTwo", "studentTwo"],
      ].map(([guardianKey, studentKey]) => ({
        school_id: schoolA,
        guardian_user_id: users[guardianKey].id,
        student_user_id: users[studentKey].id,
        confirmed_by: users.schoolLead.id,
        status: "active",
        revoked_at: null,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "school_id,guardian_user_id,student_user_id" },
    ),
    "创建虚拟亲子关系",
  );

  const consentedAt = new Date().toISOString();
  assertResult(
    await supabase.from("student_consents").upsert(
      [
        ["studentOne", "guardianOne"],
        ["studentTwo", "guardianTwo"],
      ].map(([studentKey, guardianKey]) => ({
        student_user_id: users[studentKey].id,
        school_id: schoolA,
        age_band: "14_17",
        policy_version: "2026-08-03",
        status: "active",
        student_assented_at: consentedAt,
        guardian_user_id: users[guardianKey].id,
        guardian_consented_at: consentedAt,
        withdrawn_at: null,
        withdrawn_by: null,
        updated_at: consentedAt,
      })),
      { onConflict: "student_user_id" },
    ),
    "创建虚拟学生知情同意",
  );

  assertResult(
    await supabase.from("sweet_records").upsert(
      Object.entries(fixture.records).map(([studentKey, record]) => ({
        id: record.id,
        user_id: users[studentKey].id,
        school_id: fixture.schools[fixture.users[studentKey].school].id,
        records: [
          {
            title: "睡眠",
            fields: [{ label: "昨晚睡眠", value: "[E2E] 仅用于权限验收" }],
          },
        ],
        summary: record.summary,
        small_step: "[E2E] 测试数据，不作真实建议",
        recommended_next_tool: "none",
        created_at: new Date().toISOString(),
      })),
      { onConflict: "id" },
    ),
    "创建虚拟 SWEET 记录",
  );

  console.log("虚拟权限验收数据已就绪：2 所学校、10 个账号、3 条 SWEET 记录。");
  console.log("账号邮箱记录在 tests/fixtures/permission-boundary.json；密码仅来自环境变量。 ");
}

if (cleanup) {
  await removeFixtures();
} else {
  await createFixtures();
}
