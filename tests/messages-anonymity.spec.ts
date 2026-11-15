import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "@playwright/test";

type Row = Record<string, unknown>;
type Filter = ["eq" | "neq" | "in" | "is" | "gt" | "gte" | "lt" | "lte", string, unknown];
type Result = { data: Row | Row[] | null; error: null };
type Query = {
  select(columns: string): Query;
  insert(row: Row): Query;
  update(row: Row): Query;
  eq(key: string, value: unknown): Query;
  neq(key: string, value: unknown): Query;
  in(key: string, values: unknown[]): Query;
  is(key: string, value: unknown): Query;
  gt(key: string, value: unknown): Query;
  gte(key: string, value: unknown): Query;
  lt(key: string, value: unknown): Query;
  lte(key: string, value: unknown): Query;
  order(key: string, options?: { ascending?: boolean }): Query;
  limit(value: number): Query;
  range(from: number, to: number): Query;
  maybeSingle(): Query;
  single(): Query;
  then(resolve: (result: Result) => unknown, reject?: (reason: unknown) => unknown): Promise<unknown>;
};
type ResponseBody = {
  messages?: Row[];
  message?: Row;
  error?: string;
  safetyNotice?: boolean;
  dutyEscalated?: boolean;
  dutyAlertStatus?: string | null;
  pilotDutyAvailable?: boolean;
  pilotDutyEmailConfigured?: boolean;
};

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const actors = { studentOne: id(1), studentTwo: id(2), studentOtherSchool: id(3), teacher: id(4),
  otherTeacher: id(5), teacherOtherSchool: id(6), schoolLead: id(7), otherSchoolLead: id(8),
  platformAdmin: id(9), guardian: id(10) };
const schoolA = id(20), schoolB = id(21);
const createdAt = "2026-10-30T01:00:00.000Z";
const messageIds = { anonymousOne: id(101), anonymousTwo: id(102), repeat: id(103), named: id(104),
  safety: id(105), otherSchool: id(106), self: id(107), duty: id(108) };
const responseKeys = ["id", "school_id", "sender_user_id", "recipient_type", "recipient_user_id",
  "anonymous_to_recipient", "body", "moderation_status", "duty_status", "alert_delivery_status",
  "read_at", "created_at", "sender_name", "recipient_name", "canRevealSender"].sort();

function message(messageId: string, sender = actors.studentOne, changes: Row = {}): Row {
  return { id: messageId, school_id: schoolA, sender_user_id: sender, recipient_type: "teacher",
    recipient_user_id: actors.teacher, anonymous_to_recipient: true, body: "Synthetic routine reflection.",
    moderation_status: "sent", duty_status: "not_applicable", alert_delivery_status: "not_requested",
    read_at: null, created_at: createdAt, ...changes };
}

/** Actual route execution with in-memory Auth/database doubles. No real SDK or network is loaded. */
async function harness() {
  const profiles: Row[] = Object.entries(actors).map(([key, userId]) => ({ id: userId,
    email: `${key}@example.invalid`, display_name: `Synthetic ${key}`,
    role: key.startsWith("student") ? "学生" : key === "guardian" ? "家长" : "学校支持人员",
    school_id: [actors.studentOtherSchool, actors.teacherOtherSchool, actors.otherSchoolLead].includes(userId) ? schoolB : schoolA }));
  const tables: Record<string, Row[]> = {
    profiles,
    schools: [{ id: schoolA, status: "active" }, { id: schoolB, status: "active" }],
    school_members: [actors.teacher, actors.otherTeacher, actors.platformAdmin].map((userId) => ({
      school_id: schoolA, user_id: userId, member_role: "school_support", status: "active",
    })).concat([
      { school_id: schoolB, user_id: actors.teacherOtherSchool, member_role: "school_support", status: "active" },
      { school_id: schoolA, user_id: actors.schoolLead, member_role: "school_admin", status: "active" },
      { school_id: schoolB, user_id: actors.otherSchoolLead, member_role: "school_admin", status: "active" },
    ]),
    teacher_student_assignments: [actors.studentOne, actors.studentTwo].map((studentId) => ({
      school_id: schoolA, teacher_user_id: actors.teacher, student_user_id: studentId, status: "active",
    })),
    admin_roles: [{ id: id(30), email: "platformAdmin@example.invalid".toLowerCase(), status: "active" }],
    student_messages: [
      message(messageIds.anonymousOne), message(messageIds.anonymousTwo, actors.studentTwo),
      message(messageIds.repeat), message(messageIds.named, actors.studentOne, { anonymous_to_recipient: false }),
      message(messageIds.safety, actors.studentTwo, { moderation_status: "safety_review" }),
      message(messageIds.otherSchool, actors.studentOtherSchool, { school_id: schoolB,
        recipient_user_id: actors.teacherOtherSchool, moderation_status: "safety_review" }),
      message(messageIds.self, actors.studentOne, { recipient_type: "self", recipient_user_id: actors.studentOne,
        anonymous_to_recipient: false }),
      message(messageIds.duty, actors.studentOne, { school_id: null, recipient_type: "pilot_duty",
        recipient_user_id: null, anonymous_to_recipient: false, moderation_status: "safety_review", duty_status: "new" }),
    ],
  };
  const state = { actor: actors.teacher as string | null, unexpectedColumns: false,
    moderation: "sent" as "sent" | "safety_review", moderationLocales: [] as string[], alertCalls: 0,
    operations: [] as Array<{ table: string; kind: string; columns: string; filters: Filter[] }> };
  const admin = {
    from(table: string): Query {
      if (!Object.hasOwn(tables, table)) throw new Error(`Unexpected table: ${table}`);
      const filters: Filter[] = [];
      let columns = "", kind = "select", input: Row | undefined, single = false, maximum = Infinity;
      let from = 0, to = Infinity;
      const sorts: Array<{ key: string; ascending: boolean }> = [];
      let pending: Promise<Result> | undefined;
      const chain: Query = {
        select(value) { columns = value; return chain; },
        insert(value) { kind = "insert"; input = value; return chain; },
        update(value) { kind = "update"; input = value; return chain; },
        eq(key, value) { filters.push(["eq", key, value]); return chain; },
        neq(key, value) { filters.push(["neq", key, value]); return chain; },
        in(key, values) { filters.push(["in", key, values]); return chain; },
        is(key, value) { filters.push(["is", key, value]); return chain; },
        gt(key, value) { filters.push(["gt", key, value]); return chain; },
        gte(key, value) { filters.push(["gte", key, value]); return chain; },
        lt(key, value) { filters.push(["lt", key, value]); return chain; },
        lte(key, value) { filters.push(["lte", key, value]); return chain; },
        order(key, options) { sorts.push({ key, ascending: options?.ascending !== false }); return chain; },
        limit(value) { maximum = value; return chain; },
        range(start, end) { from = start; to = end; return chain; },
        maybeSingle() { single = true; return chain; },
        single() { single = true; return chain; },
        then(resolve, reject) {
          pending ??= Promise.resolve().then(() => {
            state.operations.push({ table, kind, columns, filters: structuredClone(filters) });
            let rows = tables[table].filter((row) => filters.every(([operator, key, value]) => {
              if (operator === "in") return (value as unknown[]).includes(row[key]);
              if (operator === "neq") return row[key] !== value;
              if (operator === "gt") return String(row[key]) > String(value);
              if (operator === "gte") return String(row[key]) >= String(value);
              if (operator === "lt") return String(row[key]) < String(value);
              if (operator === "lte") return String(row[key]) <= String(value);
              return row[key] === value;
            }));
            if (kind === "insert") {
              const row = { id: id(200 + tables[table].length), created_at: createdAt, ...structuredClone(input) };
              tables[table].push(row);
              rows = [row];
            }
            if (kind === "update") rows.forEach((row) => Object.assign(row, structuredClone(input)));
            rows = [...rows].sort((left, right) => {
              for (const sort of sorts) {
                const comparison = String(left[sort.key]).localeCompare(String(right[sort.key]));
                if (comparison) return comparison * (sort.ascending ? 1 : -1);
              }
              return 0;
            });
            const projected = rows.slice(from, Math.min(to + 1, from + maximum)).map((row) => {
              const selected = columns === "*" ? { ...row } : Object.fromEntries(columns.split(",").map((key) => [key, row[key]]));
              // Model an accidental future SELECT expansion: the response serializer must still enforce its own allowlist.
              if (state.unexpectedColumns && table === "student_messages" && kind === "select") {
                const sender = profiles.find((profile) => profile.id === row.sender_user_id)!;
                Object.assign(selected, { sender_email: sender.email, sender_profile: sender,
                  sender_avatar: `https://example.invalid/avatar/${String(row.sender_user_id)}`,
                  sender_hash: `stable-${String(row.sender_user_id)}`, relationship_id: id(301),
                  sender_openid: `openid-${String(row.sender_user_id)}` });
              }
              return selected;
            });
            return { data: single ? projected[0] ?? null : projected, error: null };
          });
          return pending.then(resolve, reject);
        },
      };
      return chain;
    },
  };
  const imports: Record<string, unknown> = {
    "@/lib/supabaseServer": { getSupabaseAdmin: () => admin, getAuthenticatedUser: async () =>
      state.actor ? profiles.find((profile) => profile.id === state.actor) ?? null : null },
    "@/lib/messageSafety": { moderateStudentMessage: (_body: string, locale: string) => {
      state.moderationLocales.push(locale); return { status: state.moderation, reason: state.moderation === "safety_review" ? "Synthetic safety review." : null };
    } },
    "@/lib/studentConsent": { requireActiveStudentConsent: async () => ({ age_band: "14_17", status: "active" }) },
    "@/lib/guardianAccessPolicy": { CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_ENABLED: false,
      CURRENT_PILOT_GUARDIAN_RELATIONSHIPS_MESSAGE: "Synthetic guardian flow unavailable.", isAdultWithoutGuardianFlow: () => false },
    "@/lib/i18n/config": { normalizeLocale: (locale: string) => locale === "en" ? "en" : "zh-CN" },
    "@/lib/rateLimit": { enforceUserRateLimit: async () => true },
    "@/lib/pilotDutyAlerts": { isPilotDutyEnabled: () => false, isPilotDutyEmailConfigured: () => false,
      sendPilotDutyAlert: async () => { state.alertCalls++; throw new Error("No external alert may be sent"); } },
    "@/lib/operationalMonitoring": { reportOperationalError: () => {} },
  };
  async function load(file: string) {
    const source = await readFile(path.resolve(file), "utf8");
    const loadedModule = { exports: {} as Record<string, unknown> };
    const output = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    vm.runInNewContext(output, { module: loadedModule, exports: loadedModule.exports, Date,
      require(name: string) {
        if (!Object.hasOwn(imports, name)) throw new Error(`Unexpected import: ${name}`);
        return imports[name];
      },
    }, { filename: file, timeout: 2_000 });
    return loadedModule.exports;
  }
  imports["@/lib/studentMessageAccess"] = await load("lib/studentMessageAccess.ts");
  const route = await load("pages/api/messages.ts") as {
    default: (request: unknown, response: unknown) => Promise<unknown>;
  };
  return { state, tables, async invoke(method = "GET", body: Row = {}, locale = "zh-CN") {
    const result = { status: 200, body: {} as ResponseBody };
    const response = { setHeader() {}, status(value: number) { result.status = value; return response; },
      json(value: ResponseBody) { result.body = JSON.parse(JSON.stringify(value)) as ResponseBody; return response; } };
    await route.default({ method, headers: {}, body, query: { locale }, cookies: { NEXT_LOCALE: locale } }, response);
    expect(state.alertCalls).toBe(0);
    return result;
  } };
}

function assertValidTeacherFixture(mock: Awaited<ReturnType<typeof harness>>) {
  expect(mock.tables.schools).toContainEqual({ id: schoolA, status: "active" });
  expect(mock.tables.school_members).toContainEqual({ school_id: schoolA, user_id: actors.teacher, member_role: "school_support", status: "active" });
  for (const studentId of [actors.studentOne, actors.studentTwo]) {
    expect(mock.tables.teacher_student_assignments).toContainEqual({ school_id: schoolA,
      teacher_user_id: actors.teacher, student_user_id: studentId, status: "active" });
  }
}

for (const locale of ["zh-CN", "en"]) {
  test(`${locale} S01合法老师确实收到两位学生和重复匿名留言，但响应不含发送者身份`, async () => {
    const mock = await harness();
    assertValidTeacherFixture(mock);
    const ids = [messageIds.anonymousOne, messageIds.anonymousTwo, messageIds.repeat];
    mock.tables.student_messages = mock.tables.student_messages.filter((row) => ids.includes(String(row.id)));
    const result = await mock.invoke("GET", {}, locale);
    expect(result.status).toBe(200);
    expect(result.body.messages?.map((row) => row.id).sort()).toEqual([...ids].sort());
    expect(Object.keys(result.body).sort()).toEqual(["messages", "pilotDutyAvailable", "pilotDutyEmailConfigured"].sort());
    for (const row of result.body.messages!) {
      expect(row.sender_user_id).toBeNull();
      expect(row.sender_name).toBe("匿名学生");
      expect(row.canRevealSender).toBe(false);
      expect(Object.keys(row).sort()).toEqual(responseKeys);
      expect(row).toMatchObject({ school_id: schoolA, recipient_user_id: actors.teacher,
        recipient_type: "teacher", body: "Synthetic routine reflection.", anonymous_to_recipient: true,
        created_at: createdAt, read_at: null, moderation_status: "sent" });
    }
    const serialized = JSON.stringify(result.body);
    for (const sender of mock.tables.profiles.filter((row) => [actors.studentOne, actors.studentTwo].includes(String(row.id)))) {
      for (const field of ["id", "email", "display_name"]) expect(serialized).not.toContain(String(sender[field]));
    }
  });

  test(`${locale} S01实名留言保留既有授权身份和内容字段`, async () => {
    const mock = await harness();
    mock.tables.student_messages = mock.tables.student_messages.filter((row) => row.id === messageIds.named);
    const result = await mock.invoke("GET", {}, locale);
    expect(result.status).toBe(200);
    expect(result.body.messages).toHaveLength(1);
    expect(result.body.messages![0]).toMatchObject({ id: messageIds.named, sender_user_id: actors.studentOne,
      sender_name: "Synthetic studentOne", recipient_name: "Synthetic teacher", anonymous_to_recipient: false,
      body: "Synthetic routine reflection.", created_at: createdAt, moderation_status: "sent" });
    expect(Object.keys(result.body.messages![0]).sort()).toEqual(responseKeys);
  });

  for (const anonymous of [false, true]) {
    test(`${locale} S01${anonymous ? "匿名" : "实名"}发送仍按认证学生写入且POST只返回原有三个消息字段`, async () => {
      const mock = await harness();
      assertValidTeacherFixture(mock);
      mock.state.actor = actors.studentOne;
      const result = await mock.invoke("POST", { recipientType: "teacher", recipientUserId: actors.teacher,
        anonymous, body: "Synthetic new reflection.", locale, sender_user_id: actors.studentTwo }, locale);
      expect(result.status).toBe(201);
      expect(Object.keys(result.body.message!).sort()).toEqual(["id", "created_at", "moderation_status"].sort());
      expect(result.body).toMatchObject({ safetyNotice: false, dutyEscalated: false, dutyAlertStatus: null });
      const saved = mock.tables.student_messages.find((row) => row.id === result.body.message!.id)!;
      expect(saved).toMatchObject({ sender_user_id: actors.studentOne, recipient_user_id: actors.teacher,
        anonymous_to_recipient: anonymous, body: "Synthetic new reflection.", moderation_status: "sent", school_id: schoolA });
      expect(mock.state.moderationLocales).toEqual([locale]);
    });
  }
}

test("S01意外新增身份列也不会绕过响应白名单，匿名姓名不回退到邮箱", async () => {
  const mock = await harness();
  assertValidTeacherFixture(mock);
  mock.state.unexpectedColumns = true;
  const sender = mock.tables.profiles.find((row) => row.id === actors.studentOne)!;
  sender.display_name = "";
  mock.tables.student_messages = mock.tables.student_messages.filter((row) => row.id === messageIds.anonymousOne);
  const result = await mock.invoke();
  expect(result.status).toBe(200);
  expect(result.body.messages).toHaveLength(1);
  const row = result.body.messages![0];
  expect(row.id).toBe(messageIds.anonymousOne);
  expect(Object.keys(row).sort()).toEqual(responseKeys);
  expect(row).toMatchObject({ sender_user_id: null, sender_name: "匿名学生", canRevealSender: false });
  for (const secret of [actors.studentOne, String(sender.email), "stable-", "openid-", "avatar/", id(301)]) {
    expect(JSON.stringify(result.body)).not.toContain(secret);
  }
});

test("S01发送者查看本人匿名历史仍保留本人身份和原有self收件标签", async () => {
  const mock = await harness();
  mock.state.actor = actors.studentOne;
  const result = await mock.invoke();
  expect(result.status).toBe(200);
  expect(result.body.messages?.map((row) => row.id)).toContain(messageIds.anonymousOne);
  for (const row of result.body.messages!) {
    expect(row.sender_user_id).toBe(actors.studentOne);
    expect(row.sender_name).toBe("Synthetic studentOne");
  }
  expect(result.body.messages!.find((row) => row.id === messageIds.self)?.recipient_name).toBe("写给自己");
});

test("S01普通负责老师可读safety_review但不能据此识别匿名发送者", async () => {
  const mock = await harness();
  assertValidTeacherFixture(mock);
  const result = await mock.invoke();
  expect(result.status).toBe(200);
  const row = result.body.messages!.find((item) => item.id === messageIds.safety);
  expect(row).toMatchObject({ id: messageIds.safety, moderation_status: "safety_review",
    sender_user_id: null, sender_name: "匿名学生", canRevealSender: false });
});

test("S01本校active学校负责人只保留原有本校安全审核身份揭示", async () => {
  const mock = await harness();
  mock.state.actor = actors.schoolLead;
  const result = await mock.invoke();
  expect(result.status).toBe(200);
  expect(result.body.messages).toHaveLength(1);
  expect(result.body.messages![0]).toMatchObject({ id: messageIds.safety, school_id: schoolA,
    sender_user_id: actors.studentTwo, sender_name: "Synthetic studentTwo", canRevealSender: true });
});

test("S01他校学校负责人不能通过学校身份获得本校匿名消息", async () => {
  const mock = await harness();
  mock.state.actor = actors.otherSchoolLead;
  const result = await mock.invoke();
  expect(result.status).toBe(200);
  expect(result.body.messages).toHaveLength(1);
  expect(result.body.messages![0]).toMatchObject({ id: messageIds.otherSchool, school_id: schoolB,
    sender_user_id: actors.studentOtherSchool, canRevealSender: true });
  for (const messageId of [messageIds.anonymousOne, messageIds.safety]) {
    expect(result.body.messages!.map((row) => row.id)).not.toContain(messageId);
  }
});

test("S01active平台管理员保留值班范围身份揭示，不获得普通留言列表", async () => {
  const mock = await harness();
  mock.state.actor = actors.platformAdmin;
  mock.tables.student_messages.find((row) => row.id === messageIds.anonymousOne)!.duty_status = "new";
  const result = await mock.invoke();
  expect(result.status).toBe(200);
  expect(result.body.messages?.map((row) => row.id).sort()).toEqual([messageIds.anonymousOne, messageIds.duty].sort());
  expect(result.body.messages!.find((row) => row.id === messageIds.anonymousOne)).toMatchObject({
    sender_user_id: actors.studentOne, sender_name: "Synthetic studentOne", canRevealSender: true,
  });
});

test("S01撤销平台身份后，作为普通收件人的账号不能继续揭示匿名身份", async () => {
  const mock = await harness();
  mock.state.actor = actors.platformAdmin;
  mock.tables.admin_roles[0].status = "revoked";
  mock.tables.student_messages = [message(messageIds.anonymousOne, actors.studentOne, { recipient_user_id: actors.platformAdmin })];
  mock.tables.teacher_student_assignments.push({ school_id: schoolA, teacher_user_id: actors.platformAdmin,
    student_user_id: actors.studentOne, status: "active" });
  const result = await mock.invoke();
  expect(result.status).toBe(200);
  expect(result.body.messages).toHaveLength(1);
  expect(result.body.messages![0]).toMatchObject({ id: messageIds.anonymousOne,
    sender_user_id: null, sender_name: "匿名学生", canRevealSender: false });
});

test("S01客户端伪造角色或学校参数不能代替active揭示权限", async () => {
  const mock = await harness();
  const result = await mock.invoke("GET", { role: "平台管理员", school_id: schoolA,
    canRevealSender: true, admin: true });
  expect(result.status).toBe(200);
  const row = result.body.messages!.find((item) => item.id === messageIds.anonymousOne);
  expect(row).toMatchObject({ id: messageIds.anonymousOne, sender_user_id: null,
    sender_name: "匿名学生", canRevealSender: false });
});

for (const [label, actor, expectedStatus] of [["未登录", null, 401], ["家长", actors.guardian, 403]] as const) {
  test(`S01${label}继续被拒绝且没有留言或身份载荷`, async () => {
    const mock = await harness();
    mock.state.actor = actor;
    const result = await mock.invoke();
    expect(result.status).toBe(expectedStatus);
    expect(result.body.error).toEqual(expect.any(String));
    expect(result.body.messages).toBeUndefined();
    expect(mock.state.operations.filter((operation) => operation.table === "student_messages")).toEqual([]);
  });
}

test("S01不是收件人的普通老师不能读取或关联另一老师的匿名留言", async () => {
  const mock = await harness();
  mock.state.actor = actors.otherTeacher;
  const result = await mock.invoke();
  expect(result.status).toBe(200);
  expect(result.body.messages).toEqual([]);
});

test("S01匿名POST保留已有安全审核状态且不会发送外部提醒", async () => {
  const mock = await harness();
  mock.state.actor = actors.studentOne;
  mock.state.moderation = "safety_review";
  const result = await mock.invoke("POST", { recipientType: "teacher", recipientUserId: actors.teacher,
    anonymous: true, body: "Synthetic review fixture.", locale: "en" });
  expect(result.status).toBe(201);
  expect(result.body).toMatchObject({ safetyNotice: true, dutyEscalated: false,
    message: { moderation_status: "safety_review" } });
  const saved = mock.tables.student_messages.find((row) => row.id === result.body.message!.id)!;
  expect(saved).toMatchObject({ sender_user_id: actors.studentOne, anonymous_to_recipient: true,
    moderation_status: "safety_review", moderation_reason: "Synthetic safety review." });
});
