import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { expect, test } from "@playwright/test";

// Real handlers, Auth validation, consent predicates and account scope helpers.
// SDK, database rows and operational sinks are synthetic and cannot use network.
// This proves handler contracts only, never effective ACL/RLS or SQL persistence.
type Row = Record<string, unknown>;
type Filter = { op: string; key: string; value: unknown };
type Query = { table: string; action: string; columns: string; filters: Filter[]; patch: Row;
  orders: Array<{ key: string; ascending: boolean }>; range: [number, number] | null; max: number | null; affected: number | null };
type Options = { flag?: boolean; actor?: string; authThrow?: boolean; noEmail?: boolean;
  failTable?: string; failConsentOrdinal?: number; withdrawOnScopeConsent?: number; raceCommunityStatus?: string };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = uuid(1), B = uuid(2), T = uuid(3), S = uuid(4);
const POST = uuid(11), COMMENT = uuid(12), PEER = uuid(13), CONTROL = uuid(14), ROOM = uuid(15);
const OTHER_POST = uuid(21), OTHER_COMMENT = uuid(22), OTHER_PEER = uuid(23), OTHER_CONTROL = uuid(24);
const NOW = "2026-11-04T01:00:00.000Z";
const DETAIL = "SYNTHETIC PRIVATE PROVIDER DETAIL";
const POSTS = "pages/api/community/posts.ts", COMMENTS = "pages/api/community/comments.ts";
const PEERS = "pages/api/peer-space/messages.ts", CONTROLS = "pages/api/peer-space/controls.ts", ACCOUNT = "pages/api/account/data.ts";
const endpoints = [
  { label: "community post", file: POSTS, key: "postId", id: POST, otherId: OTHER_POST, table: "community_posts", result: "ok", nonOwner: 403, action: "update", ownerField: "author_user_id" },
  { label: "community comment", file: COMMENTS, key: "commentId", id: COMMENT, otherId: OTHER_COMMENT, table: "community_comments", result: "ok", nonOwner: 403, action: "update", ownerField: "author_user_id" },
  { label: "peer message", file: PEERS, key: "messageId", id: PEER, otherId: OTHER_PEER, table: "peer_space_messages", result: "deleted", nonOwner: 404, action: "update", ownerField: "author_user_id" },
  { label: "peer control", file: CONTROLS, key: "controlId", id: CONTROL, otherId: OTHER_CONTROL, table: "peer_space_user_controls", result: "removed", nonOwner: 404, action: "delete", ownerField: "actor_user_id" },
] as const;

const consent = (id: string, patch: Row = {}): Row => ({ student_user_id: id, age_band: "14_17", consent_basis: "student_self_pilot",
  status: "active", policy_version: "2026-08-28", student_assented_at: NOW, guardian_user_id: null, guardian_consented_at: null, ...patch });
const content = (id: string, author: string, patch: Row = {}): Row => ({ id, author_user_id: author, author_role: "student",
  title: `Synthetic title ${id}`, body: `Synthetic retained text ${id}`, moderation_status: "published", viewer_roles: ["student", "teacher", "guardian", "professional"],
  commenter_roles: ["student"], room_id: ROOM, post_id: POST, created_at: NOW, updated_at: NOW, deleted_at: null, ...patch });

function fixture(options: Options = {}) {
  const actor = options.actor || A;
  const rows: Record<string, Row[]> = {
    profiles: [A, B].map(id => ({ id, role: "学生", display_name: `Synthetic ${id}`, email: `${id}@example.invalid`, school_id: S, created_at: NOW })),
    student_consents: [consent(A), consent(B)],
    community_posts: [content(POST, A), content(OTHER_POST, B)],
    community_comments: [content(COMMENT, A), content(OTHER_COMMENT, B, { post_id: OTHER_POST })],
    peer_space_messages: [content(PEER, A, { moderation_status: "visible" }), content(OTHER_PEER, B, { moderation_status: "visible" })],
    peer_space_user_controls: [
      { id: CONTROL, room_id: ROOM, actor_user_id: A, target_user_id: B, control_type: "mute", created_at: NOW },
      { id: OTHER_CONTROL, room_id: ROOM, actor_user_id: B, target_user_id: A, control_type: "block", created_at: NOW },
    ],
    admin_roles: [], school_members: [], professional_verifications: [], community_blocks: [],
  };
  const queries: Query[] = [], operational: unknown[] = [];
  let networkCalls = 0, authCalls = 0, consentReads = 0, scopeConsentReads = 0;
  const token = (id: string, exp = 9999999999) => `e30.${Buffer.from(JSON.stringify({ sub: id, exp })).toString("base64url")}.synthetic`;
  function matches(row: Row, filter: Filter): boolean {
    const value = row[filter.key];
    if (filter.op === "in") return (filter.value as unknown[]).includes(value);
    if (filter.op === "neq") return value !== filter.value;
    if (filter.op === "gt") return String(value) > String(filter.value);
    if (filter.op === "gte") return String(value) >= String(filter.value);
    if (filter.op === "contains") return Array.isArray(value) && (filter.value as unknown[]).every(v => value.includes(v));
    if (filter.op === "or") return true; // Only expiration alternatives, with no fixture verification rows.
    return value === filter.value;
  }
  const sdk = {
    auth: { getUser: async (value: string) => {
      ++authCalls;
      if (options.authThrow) throw new Error(DETAIL);
      const id = [A, B, T].find(candidate => token(candidate) === value);
      return id ? { data: { user: { id, email: options.noEmail ? null : `${id}@example.invalid`, created_at: NOW } }, error: null }
        : { data: { user: null }, error: { status: 401 } };
    } },
    from(table: string) {
      const query: Query = { table, action: "select", columns: "", filters: [], patch: {}, orders: [], range: null, max: null, affected: null };
      let single = false;
      const builder = {
        select(columns: string) { query.columns = columns; return builder; },
        eq(key: string, value: unknown) { query.filters.push({ op: "eq", key, value }); return builder; },
        neq(key: string, value: unknown) { query.filters.push({ op: "neq", key, value }); return builder; },
        is(key: string, value: unknown) { query.filters.push({ op: "is", key, value }); return builder; },
        in(key: string, value: unknown[]) { query.filters.push({ op: "in", key, value }); return builder; },
        contains(key: string, value: unknown[]) { query.filters.push({ op: "contains", key, value }); return builder; },
        gt(key: string, value: unknown) { query.filters.push({ op: "gt", key, value }); return builder; },
        gte(key: string, value: unknown) { query.filters.push({ op: "gte", key, value }); return builder; },
        or(value: string) { query.filters.push({ op: "or", key: "", value }); return builder; },
        order(key: string, value?: { ascending?: boolean }) { query.orders.push({ key, ascending: value?.ascending !== false }); return builder; },
        range(from: number, to: number) { query.range = [from, to]; return builder; },
        limit(max: number) { query.max = max; return builder; },
        maybeSingle() { single = true; return builder; }, single() { single = true; return builder; },
        update(patch: Row) { query.action = "update"; query.patch = patch; return builder; },
        delete() { query.action = "delete"; return builder; },
        insert() { throw new Error("Unexpected content insertion in this handler-contract fixture"); },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve().then(() => {
            const recorded = JSON.parse(JSON.stringify(query)) as Query;
            queries.push(recorded);
            if (table === "student_consents") {
              ++consentReads;
              if (query.filters.some(f => f.op === "in")) {
                ++scopeConsentReads;
                if (options.withdrawOnScopeConsent === scopeConsentReads) {
                  const existing = rows.student_consents.find(r => r.student_user_id === A);
                  if (existing) existing.status = "withdrawn";
                }
              }
              if (options.failConsentOrdinal === consentReads) return { data: null, error: { message: DETAIL } };
            }
            if (options.failTable === table) return { data: null, error: { message: DETAIL } };
            if (options.raceCommunityStatus && query.action === "update" && ["community_posts", "community_comments"].includes(table)) {
              const target = rows[table].find(row => row.id === query.filters.find(f => f.key === "id")?.value);
              if (target) target.moderation_status = options.raceCommunityStatus;
            }
            let selected = (rows[table] || []).filter(row => query.filters.every(filter => matches(row, filter)));
            if (query.action !== "select") {
              recorded.affected = selected.length;
              if (query.action === "update") for (const row of selected) Object.assign(row, query.patch);
              if (query.action === "delete") rows[table] = (rows[table] || []).filter(row => !selected.includes(row));
            }
            selected.sort((left, right) => {
              for (const order of query.orders) {
                const result = String(left[order.key] ?? "").localeCompare(String(right[order.key] ?? ""));
                if (result) return order.ascending ? result : -result;
              }
              return 0;
            });
            if (query.max !== null) selected = selected.slice(0, query.max);
            if (query.range) selected = selected.slice(query.range[0], query.range[1] + 1);
            if (query.columns && query.columns !== "*") selected = selected.map(row => Object.fromEntries(query.columns.split(",").map(key => [key, row[key]])));
            return { data: single ? selected[0] || null : selected, error: null };
          }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const forbidden = () => { ++networkCalls; throw new Error("Network forbidden"); };
  const unexpected = () => { throw new Error("Unexpected privileged operation in read-only account export"); };
  const mocks: Record<string, unknown> = {
    "node:crypto": { createHash },
    "@supabase/supabase-js": { createClient: (url: string, key: string) => {
      if (url !== "https://synthetic.invalid" || key !== "synthetic-server-key") throw new Error("Non-synthetic SDK configuration forbidden");
      return sdk;
    } },
    "@/lib/operationalMonitoring": { reportOperationalError: async (value: unknown) => { operational.push(value); } },
    "@/lib/messageSafety": { moderateCommunityContent: unexpected },
    "@/lib/peerSpaceSafety": { classifyPeerSpaceMessage: unexpected, classifyPeerSpaceMessageWithAi: unexpected },
    "@/lib/rateLimit": { enforceUserRateLimit: unexpected },
    "@/lib/supportWorkflow": { transitionSupportCase: unexpected },
    "@/lib/accountDeletionReceiptServer": { authAccountState: unexpected, completeDeletionAudit: unexpected,
      parseDeletionReceipt: unexpected, prepareDeletionAudit: unexpected, DeletionAttemptBusy: class extends Error {}, DeletionReceiptConflict: class extends Error {} },
    "@/lib/i18n/server": { getRequestLocale: () => "zh-CN", getServerTranslator: () => () => "User-safe localized error" },
  };
  const allowed = new Set([POSTS, COMMENTS, PEERS, CONTROLS, ACCOUNT,
    "lib/supabaseServer.ts", "lib/studentConsent.ts", "lib/community.ts", "lib/peerSpaceAccess.ts", "lib/peerSpaceChat.ts",
    "lib/studentMessageAccess.ts", "lib/accountDataPolicy.ts", "lib/guardianAccessPolicy.ts", "lib/i18n/config.ts"]);
  const cache = new Map<string, Record<string, unknown>>();
  function load(file: string): Record<string, unknown> {
    const cached = cache.get(file);
    if (cached) return cached;
    if (!allowed.has(file)) throw new Error(`Unmocked import forbidden: ${file}`);
    const loadedModule = { exports: {} as Record<string, unknown> };
    cache.set(file, loadedModule.exports);
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    vm.runInNewContext(compiled, {
      module: loadedModule, exports: loadedModule.exports, Buffer, URL, Date, Error,
      process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-server-key",
        PEER_SPACE_ACCESS_API_ENABLED: options.flag === false ? "false" : "true" } },
      require: (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : load(name.replace(/^@\//, "") + ".ts"),
      fetch: forbidden, XMLHttpRequest: forbidden, WebSocket: forbidden,
    }, { filename: file });
    return loadedModule.exports;
  }
  async function request(file: string, method = "DELETE", body: Row = {}, auth: string | null = token(actor), query: Row = {}) {
    const result = { status: 0, body: {} as Row, headers: {} as Record<string, string> };
    const res = { setHeader: (key: string, value: string) => { result.headers[key] = value; },
      status: (status: number) => { result.status = status; return res; }, json: (value: Row) => { result.body = value; return res; } };
    await (load(file).default as (req: unknown, res: unknown) => Promise<unknown>)({
      method, headers: { authorization: auth ? `Bearer ${auth}` : "" }, body, query, cookies: {},
    }, res);
    expect(networkCalls).toBe(0);
    return result;
  }
  return { rows, queries, operational, request, token, authCalls: () => authCalls };
}

const has = (q: Query, key: string, value: unknown, op = "eq") => q.filters.some(f => f.op === op && f.key === key && f.value === value);
const writes = (f: ReturnType<typeof fixture>) => f.queries.filter(q => q.action !== "select");
const exported = (response: { body: Row }) => response.body.data as Record<string, Row[]>;

for (const endpoint of endpoints) {
  test(`${endpoint.label}: withdrawn owner uses original DELETE contract`, async () => {
    const f = fixture({ flag: false }); f.rows.student_consents[0].status = "withdrawn";
    const original = JSON.parse(JSON.stringify(f.rows[endpoint.table])) as Row[];
    const result = await f.request(endpoint.file, "DELETE", { [endpoint.key]: endpoint.id, locale: "en" });
    expect(result.status).toBe(200); expect(result.body).toEqual({ [endpoint.result]: true });
    expect(f.authCalls()).toBe(1); expect(writes(f)).toHaveLength(1);
    expect(writes(f)[0].table).toBe(endpoint.table); expect(writes(f)[0].action).toBe(endpoint.action);
    expect(has(writes(f)[0], "id", endpoint.id)).toBe(true);
    if (endpoint.file === PEERS || endpoint.file === CONTROLS) expect(has(writes(f)[0], endpoint.ownerField, A)).toBe(true);
    const after = f.rows[endpoint.table].find(row => row.id === endpoint.id);
    if (endpoint.file === CONTROLS) expect(after).toBeUndefined();
    else {
      expect(after?.body).toBe(original[0].body);
      expect(after?.moderation_status).toBe(endpoint.file === PEERS ? "deleted" : "removed");
      expect(writes(f)[0].patch.body).toBeUndefined();
    }
    expect(f.rows[endpoint.table].find(row => row.id === endpoint.otherId)).toEqual(original[1]);
    expect(f.queries.some(q => q.table === "student_consents")).toBe(false);
    expect(f.queries.some(q => q.table.startsWith("peer_space_room") || q.table === "peer_space_memberships")).toBe(false);
  });

  for (const [label, auth] of [["absent", null], ["malformed", "not-a-jwt"], ["expired", "expired"], ["invalid auth provider token", "invalid"]] as const) {
    test(`${endpoint.label}: ${label} bearer does not touch content`, async () => {
      const f = fixture();
      const value = auth === "expired" ? f.token(A, 1) : auth === "invalid" ? f.token(uuid(99)) : auth;
      const result = await f.request(endpoint.file, "DELETE", { [endpoint.key]: endpoint.id }, value);
      expect(result.status).toBe(401); expect(f.queries).toHaveLength(0); expect(writes(f)).toHaveLength(0);
    });
  }

  test(`${endpoint.label}: authentication operational failure is sanitized and never writes`, async () => {
    const f = fixture({ authThrow: true });
    const result = await f.request(endpoint.file, "DELETE", { [endpoint.key]: endpoint.id });
    expect(result.status).toBe(endpoint.file === PEERS || endpoint.file === CONTROLS ? 503 : 500);
    expect(JSON.stringify(result.body)).not.toContain(DETAIL); expect(writes(f)).toHaveLength(0);
  });

  test(`${endpoint.label}: missing original ID parameter is refused`, async () => {
    const f = fixture(); const result = await f.request(endpoint.file, "DELETE", { id: endpoint.id });
    expect(result.status).toBe(400); expect(writes(f)).toHaveLength(0);
  });

  test(`${endpoint.label}: non-string original ID is refused`, async () => {
    const f = fixture(); const result = await f.request(endpoint.file, "DELETE", { [endpoint.key]: [endpoint.id] });
    expect(result.status).toBe(400); expect(writes(f)).toHaveLength(0);
  });

  test(`${endpoint.label}: another ordinary owner's object is denied or unmatched`, async () => {
    const f = fixture({ flag: false }); const before = JSON.stringify(f.rows[endpoint.table]);
    const result = await f.request(endpoint.file, "DELETE", { [endpoint.key]: endpoint.otherId });
    expect(result.status).toBe(endpoint.nonOwner); expect(JSON.stringify(f.rows[endpoint.table])).toBe(before);
    expect(writes(f).every(q => q.affected === 0)).toBe(true);
  });

  test(`${endpoint.label}: forged owner and role do not grant another user's object`, async () => {
    const f = fixture({ flag: false }); const before = JSON.stringify(f.rows[endpoint.table]);
    const result = await f.request(endpoint.file, "DELETE", { [endpoint.key]: endpoint.otherId,
      owner: B, owner_user_id: B, author_user_id: B, actor_user_id: B, role: "admin", canModerate: true });
    expect(result.status).toBe(endpoint.nonOwner); expect(JSON.stringify(f.rows[endpoint.table])).toBe(before);
  });

  test(`${endpoint.label}: no match is not successful removal`, async () => {
    const f = fixture(); const result = await f.request(endpoint.file, "DELETE", { [endpoint.key]: uuid(999) });
    expect(result.status).toBe(404); expect(result.body[endpoint.result]).not.toBe(true);
  });

  test(`${endpoint.label}: database failure does not expose provider detail`, async () => {
    const f = fixture({ failTable: endpoint.table });
    const result = await f.request(endpoint.file, "DELETE", { [endpoint.key]: endpoint.id });
    expect(result.status).toBe(endpoint.file === PEERS || endpoint.file === CONTROLS ? 503 : 500);
    expect(JSON.stringify(result.body)).not.toContain(DETAIL);
  });
}

for (const endpoint of endpoints.slice(0, 2)) {
  for (const status of ["published", "safety_review"]) {
    test(`${endpoint.label}: existing ${status} body is retained on author removal`, async () => {
      const f = fixture(); f.rows[endpoint.table][0].moderation_status = status;
      const body = f.rows[endpoint.table][0].body;
      expect((await f.request(endpoint.file, "DELETE", { [endpoint.key]: endpoint.id })).status).toBe(200);
      expect(f.rows[endpoint.table][0].moderation_status).toBe("removed"); expect(f.rows[endpoint.table][0].body).toBe(body);
    });
  }
  test(`${endpoint.label}: already removed returns 404 without another write`, async () => {
    const f = fixture(); f.rows[endpoint.table][0].moderation_status = "removed";
    expect((await f.request(endpoint.file, "DELETE", { [endpoint.key]: endpoint.id })).status).toBe(404);
    expect(writes(f)).toHaveLength(0);
  });
  test(`${endpoint.label}: original verified platform administrator exception remains`, async () => {
    const f = fixture(); f.rows.admin_roles = [{ id: uuid(88), email: `${A}@example.invalid`, status: "active" }];
    const result = await f.request(endpoint.file, "DELETE", { [endpoint.key]: endpoint.otherId });
    expect(result.status).toBe(200); expect(f.rows[endpoint.table][1].moderation_status).toBe("removed");
    expect(writes(f)[0].patch.moderation_reason).toBe("平台管理员删除");
  });
  test(`${endpoint.label}: CAS zero rows remains acknowledgement until independent reread`, async () => {
    const f = fixture({ raceCommunityStatus: "safety_review" });
    const result = await f.request(endpoint.file, "DELETE", { [endpoint.key]: endpoint.id });
    expect(result.status).toBe(200); expect(result.body).toEqual({ ok: true });
    expect(writes(f)[0].affected).toBe(0); expect(f.rows[endpoint.table][0].moderation_status).toBe("safety_review");
    const reread = await f.request(ACCOUNT, "GET"); expect(reread.status).toBe(200);
    const key = endpoint.file === POSTS ? "communityPosts" : "communityComments";
    expect(exported(reread)[key].find(row => row.id === endpoint.id)?.moderation_status).not.toBe("removed");
    expect(writes(f)).toHaveLength(1); // This test never repeats DELETE after a zero-row acknowledgement.
  });
}

for (const status of ["visible", "safety_review", "hidden"]) {
  test(`peer message: ${status} removal is allowed with service disabled and retains text`, async () => {
    const f = fixture({ flag: false }); f.rows.peer_space_messages[0].moderation_status = status;
    const body = f.rows.peer_space_messages[0].body;
    const result = await f.request(PEERS, "DELETE", { messageId: PEER });
    expect(result.status).toBe(200); expect(result.body).toEqual({ deleted: true });
    expect(f.rows.peer_space_messages[0].body).toBe(body); expect(f.rows.peer_space_messages[0].deleted_at).toEqual(expect.any(String));
    expect(writes(f)[0].filters.find(f => f.key === "moderation_status")?.value).toEqual(["visible", "safety_review", "hidden"]);
  });
}
test("peer message: already deleted returns 404 and cannot confirm a new removal", async () => {
  const f = fixture({ flag: false }); f.rows.peer_space_messages[0].moderation_status = "deleted";
  const result = await f.request(PEERS, "DELETE", { messageId: PEER });
  expect(result.status).toBe(404); expect(writes(f)[0].affected).toBe(0);
});
for (const endpoint of endpoints.slice(2)) {
  test(`${endpoint.label}: malformed UUID is refused even with service disabled`, async () => {
    const f = fixture({ flag: false }); const result = await f.request(endpoint.file, "DELETE", { [endpoint.key]: "invalid-id" });
    expect(result.status).toBe(400); expect(writes(f)).toHaveLength(0);
  });
  for (const method of ["GET", "POST"]) {
    test(`${endpoint.label}: disabled service ${method} stops before room access or content reads`, async () => {
      const f = fixture({ flag: false });
      const result = await f.request(endpoint.file, method, { roomId: ROOM, body: "Synthetic input", messageId: PEER, controlType: "mute" }, undefined, { roomId: ROOM });
      expect(result.status).toBe(404); expect(f.authCalls()).toBe(1); expect(f.queries).toHaveLength(0);
    });
    test(`${endpoint.label}: enabled service ${method} still rejects withdrawn participation`, async () => {
      const f = fixture(); f.rows.student_consents[0] = consent(A, { age_band: "18_plus", consent_basis: "adult_self", status: "withdrawn" });
      const result = await f.request(endpoint.file, method, { roomId: ROOM, body: "Synthetic input", messageId: PEER, controlType: "mute" }, undefined, { roomId: ROOM });
      expect(result.status).toBe(403); expect(writes(f)).toHaveLength(0);
      expect(f.queries.some(q => q.table === "peer_space_messages" || q.table === "peer_space_user_controls")).toBe(false);
    });
  }
}

const invalidConsents: Array<[string, Row | null]> = [
  ["missing", null], ["withdrawn", { status: "withdrawn" }], ["pending guardian", { status: "pending_guardian" }],
  ["ineligible", { status: "ineligible" }], ["old version", { policy_version: "2026-08-27" }],
  ["missing assent", { student_assented_at: null }], ["empty assent", { student_assented_at: "" }],
  ["under14", { age_band: "under_14" }], ["adult with minor basis", { age_band: "18_plus" }],
  ["minor with adult basis", { consent_basis: "adult_self" }],
  ["guardian without identity", { consent_basis: "student_guardian", guardian_consented_at: NOW }],
  ["guardian without confirmation", { consent_basis: "student_guardian", guardian_user_id: B }],
];
for (const [label, patch] of invalidConsents) {
  test(`student feed: ${label} stops before information-flow queries`, async () => {
    const f = fixture();
    if (patch === null) f.rows.student_consents = f.rows.student_consents.filter(row => row.student_user_id !== A);
    else Object.assign(f.rows.student_consents[0], patch);
    const result = await f.request(POSTS, "GET"); expect(result.status).toBe(403);
    expect(f.queries.some(q => q.table === "community_posts" || q.table === "community_comments")).toBe(false);
    expect(writes(f)).toHaveLength(0);
  });
}
for (const [label, patch] of [["minor self", {}], ["adult self", { age_band: "18_plus", consent_basis: "adult_self" }],
  ["minor guardian", { consent_basis: "student_guardian", guardian_user_id: B, guardian_consented_at: NOW }]] as Array<[string, Row]>) {
  test(`student feed: complete ${label} consent retains original visible feed`, async () => {
    const f = fixture(); Object.assign(f.rows.student_consents[0], patch);
    const result = await f.request(POSTS, "GET"); expect(result.status).toBe(200);
    expect((result.body.posts as Row[]).map(row => row.id).sort()).toEqual([POST, OTHER_POST].sort());
    expect(f.queries.some(q => q.table === "student_consents")).toBe(true); expect(writes(f)).toHaveLength(0);
  });
}
test("student feed: consent dependency failure is sanitized and does not read posts", async () => {
  const f = fixture({ failTable: "student_consents" }); const result = await f.request(POSTS, "GET");
  expect(result.status).toBe(500); expect(JSON.stringify(result.body)).not.toContain(DETAIL);
  expect(f.queries.some(q => q.table === "community_posts" || q.table === "community_comments")).toBe(false);
});
for (const role of ["家长", "学校支持人员", "专业支持者"]) {
  test(`nonstudent feed: original ${role} behavior does not add a student consent requirement`, async () => {
    const f = fixture({ failTable: "student_consents" }); f.rows.profiles[0].role = role;
    const result = await f.request(POSTS, "GET"); expect(result.status).toBe(200);
    expect(f.queries.some(q => q.table === "student_consents")).toBe(false); expect(writes(f)).toHaveLength(0);
  });
}
for (const file of [POSTS, COMMENTS]) {
  test(`${file}: withdrawn new creation remains blocked before moderation or insert`, async () => {
    const f = fixture(); f.rows.student_consents[0].status = "withdrawn";
    const result = await f.request(file, "POST", { title: "Synthetic", body: "Synthetic", postId: POST, viewerRoles: ["student"] });
    expect(result.status).toBe(403); expect(writes(f)).toHaveLength(0);
  });
}

test("account GET: withdrawn owner reads four existing arrays with independent server owner filters", async () => {
  const f = fixture({ flag: false }); f.rows.student_consents[0].status = "withdrawn";
  const result = await f.request(ACCOUNT, "GET", { owner: B, role: "admin" });
  expect(result.status).toBe(200); expect((result.body.account as Row).id).toBe(A);
  expect(result.headers["Cache-Control"]).toBe("no-store, max-age=0");
  const data = exported(result);
  for (const [key, table, ownerField, id] of [
    ["communityPosts", "community_posts", "author_user_id", POST], ["communityComments", "community_comments", "author_user_id", COMMENT],
    ["peerSpaceMessages", "peer_space_messages", "author_user_id", PEER], ["peerSpaceControls", "peer_space_user_controls", "actor_user_id", CONTROL],
  ]) {
    expect(data[key].map(row => row.id)).toEqual([id]);
    const actual = f.queries.filter(q => q.table === table); expect(actual.length).toBeGreaterThan(0);
    expect(actual.every(q => has(q, ownerField, A) && q.range?.[1] === 499)).toBe(true);
  }
  expect(writes(f)).toHaveLength(0); expect(f.authCalls()).toBe(1);
  expect(f.queries.some(q => q.table === "pilot_feedback")).toBe(true); // Full export dependency remains intentional.
  expect(f.queries.some(q => q.table === "peer_space_rooms" || q.table === "peer_space_room_memberships")).toBe(false);
});
test("account GET: current own controls fields are sufficient and target identity is not added", async () => {
  const f = fixture(); const result = await f.request(ACCOUNT, "GET"); const row = exported(result).peerSpaceControls[0];
  expect(Object.keys(row).sort()).toEqual(["id", "room_id", "control_type", "created_at"].sort());
  expect(row.id).toBe(CONTROL); expect(row.target_user_id).toBeUndefined(); expect(row.targetLabel).toBeUndefined();
});
test("account GET: removed/deleted text remains in the own export", async () => {
  const f = fixture(); f.rows.community_posts[0].moderation_status = "removed"; f.rows.community_comments[0].moderation_status = "removed";
  f.rows.peer_space_messages[0].moderation_status = "deleted"; f.rows.peer_space_messages[0].deleted_at = NOW;
  const result = await f.request(ACCOUNT, "GET"); expect(result.status).toBe(200); const data = exported(result);
  for (const key of ["communityPosts", "communityComments", "peerSpaceMessages"]) {
    expect(data[key]).toHaveLength(1); expect(data[key][0].body).toContain("Synthetic retained text");
  }
  expect(writes(f)).toHaveLength(0);
});
test("account GET: unrelated export failure fails the complete read without partial data", async () => {
  const f = fixture({ failTable: "pilot_feedback" }); const result = await f.request(ACCOUNT, "GET");
  expect(result.status).toBe(500); expect(result.body.data).toBeUndefined(); expect(JSON.stringify(result.body)).not.toContain(DETAIL);
  expect(writes(f)).toHaveLength(0);
});
test("account GET: absent email is rejected before unrelated export queries", async () => {
  const f = fixture({ noEmail: true }); const result = await f.request(ACCOUNT, "GET");
  expect(result.status).toBe(401); expect(f.queries).toHaveLength(0);
});
test("account GET: every separate read authenticates again", async () => {
  const f = fixture(); expect((await f.request(ACCOUNT, "GET")).status).toBe(200);
  expect((await f.request(ACCOUNT, "GET")).status).toBe(200); expect(f.authCalls()).toBe(2);
});

function teacherFixture(options: Options = {}) {
  const f = fixture({ ...options, actor: T });
  f.rows.profiles.push({ id: T, role: "学校支持人员", display_name: "Synthetic teacher", school_id: S });
  f.rows.schools = [{ id: S, status: "active" }];
  f.rows.school_members = [{ id: uuid(40), user_id: T, school_id: S, member_role: "school_support", status: "active" }];
  f.rows.teacher_student_assignments = [{ id: uuid(41), teacher_user_id: T, student_user_id: A, school_id: S, status: "active" }];
  f.rows.student_messages = [{ id: uuid(42), sender_user_id: A, recipient_user_id: T, recipient_type: "teacher",
    school_id: S, body: "Synthetic teacher received body", anonymous_to_recipient: true, created_at: NOW }];
  return f;
}
test("account GET dependency: original teacher recipient and active scope remain limited with anonymous masking", async () => {
  const f = teacherFixture(); const result = await f.request(ACCOUNT, "GET"); expect(result.status).toBe(200);
  expect(exported(result).messages).toHaveLength(1); expect(exported(result).messages[0].sender_user_id).toBeNull();
  const teacherQueries = f.queries.filter(q => q.table === "student_messages" && has(q, "recipient_type", "teacher"));
  expect(teacherQueries).toHaveLength(1); expect(has(teacherQueries[0], "recipient_user_id", T)).toBe(true);
  expect(has(teacherQueries[0], "school_id", S)).toBe(true);
  expect(teacherQueries[0].filters.find(filter => filter.key === "sender_user_id" && filter.op === "in")?.value).toEqual([A]);
  expect(writes(f)).toHaveLength(0);
});
test("account GET dependency: teacher final fresh scope excludes newly withdrawn sender", async () => {
  const f = teacherFixture({ withdrawOnScopeConsent: 2 }); const result = await f.request(ACCOUNT, "GET");
  expect(result.status).toBe(200); expect(exported(result).messages).toHaveLength(0);
  expect(f.queries.filter(q => q.table === "student_consents" && q.filters.some(filter => filter.op === "in"))).toHaveLength(2);
  expect(writes(f)).toHaveLength(0);
});
test("account GET dependency: teacher fresh consent failure fails completely, without old body or deletionAudit fallback", async () => {
  // Export's own student_consents read is ordinal 1; teacher first/fresh scope reads are 2/3.
  const f = teacherFixture({ failConsentOrdinal: 3 }); const result = await f.request(ACCOUNT, "GET");
  expect(result.status).toBe(500); expect(result.body.data).toBeUndefined();
  expect(JSON.stringify(result.body)).not.toContain("Synthetic teacher received body");
  expect(JSON.stringify(result.body)).not.toContain(DETAIL); expect(writes(f)).toHaveLength(0);
});
