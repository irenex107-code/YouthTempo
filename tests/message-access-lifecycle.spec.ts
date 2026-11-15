import { expect, test } from "@playwright/test";
import { messageAccessFixture, messageIds, people, listMessages, id, school, otherSchool, message, type Row, type Operation } from "./fixtures/synthetic-message-access";

for (const locale of ["zh-CN", "en"]) {
  test(`T01/${locale} revoked assignment removes old inbox body despite unchanged teacher session`, async () => {
    const fixture = await messageAccessFixture();
    const before = await fixture.invoke("messages", "GET", {}, locale);
    expect(listMessages(before).map((row) => row.id)).toContain(messageIds.anonymous);
    fixture.revoke();
    const result = await fixture.invoke("messages", "GET", {}, locale);
    expect(result.status).toBe(200);
    expect(listMessages(result).map((row) => row.id)).toEqual([messageIds.second]);
    expect(JSON.stringify(result.body)).not.toContain(messageIds.anonymous);
    expect(fixture.state.actor).toBe(people.teacher);
  });

  test(`T01/${locale} revoked assignment prevents read_at update`, async () => {
    const fixture = await messageAccessFixture(); fixture.revoke();
    const result = await fixture.invoke("messages", "PATCH", { id: messageIds.named }, locale);
    expect(result.status).toBe(404);
    expect(fixture.tables.student_messages.find((row) => row.id === messageIds.named)?.read_at).toBeNull();
  });

  test(`T01/${locale} teacher account download excludes revoked received messages`, async () => {
    const fixture = await messageAccessFixture(); fixture.revoke();
    const result = await fixture.invoke("account", "GET", {}, locale);
    expect(result.status).toBe(200);
    expect(listMessages(result, "account").map((row) => row.id)).toEqual([messageIds.second]);
    expect(JSON.stringify(result.body)).not.toContain(`Synthetic private message ${messageIds.anonymous}`);
  });
}

for (const locale of ["zh-CN", "en"]) {
  test(`T02/${locale} current teacher reads, marks and downloads allowed records without losing anonymous protection`, async () => {
    const fixture = await messageAccessFixture();
    const inbox = await fixture.invoke("messages", "GET", {}, locale);
    expect(inbox.status).toBe(200);
    expect(listMessages(inbox).map((row) => row.id).sort()).toEqual([messageIds.anonymous, messageIds.named, messageIds.second].sort());
    expect(listMessages(inbox).find((row) => row.id === messageIds.anonymous)).toMatchObject({ sender_user_id: null, sender_name: "匿名学生", canRevealSender: false });
    const read = await fixture.invoke("messages", "PATCH", { id: messageIds.named }, locale);
    expect(read.status).toBe(200);
    expect(fixture.tables.student_messages.find((row) => row.id === messageIds.named)?.read_at).toEqual(expect.any(String));
    const exported = await fixture.invoke("account", "GET", {}, locale);
    expect(listMessages(exported, "account").map((row) => row.id).sort()).toEqual([messageIds.anonymous, messageIds.named, messageIds.second].sort());
    expect(listMessages(exported, "account").find((row) => row.id === messageIds.anonymous)?.sender_user_id).toBeNull();
  });

  test(`T03/${locale} new teacher assignment never inherits the previous recipient inbox`, async () => {
    const fixture = await messageAccessFixture(); fixture.revoke();
    fixture.tables.teacher_student_assignments.push({ id: id(70), school_id: school, teacher_user_id: people.newTeacher,
      student_user_id: people.student, status: "active" });
    fixture.state.actor = people.newTeacher;
    expect(listMessages(await fixture.invoke("messages", "GET", {}, locale))).toEqual([]);
    expect(listMessages(await fixture.invoke("account", "GET", {}, locale), "account")).toEqual([]);
    expect((await fixture.invoke("messages", "PATCH", { id: messageIds.named }, locale)).status).toBe(404);
    fixture.state.actor = people.student;
    const posted = await fixture.invoke("messages", "POST", { recipientType: "teacher", recipientUserId: people.newTeacher,
      anonymous: true, body: "Synthetic message addressed only to the new teacher." }, locale);
    expect(posted.status).toBe(201);
    const newId = (posted.body.message as Row).id;
    fixture.state.actor = people.newTeacher;
    expect(listMessages(await fixture.invoke("messages", "GET", {}, locale)).map((row) => row.id)).toEqual([newId]);
    expect(listMessages(await fixture.invoke("account", "GET", {}, locale), "account").map((row) => row.id)).toEqual([newId]);
    expect((await fixture.invoke("messages", "PATCH", { id: newId }, locale)).status).toBe(200);
    fixture.state.actor = people.teacher;
    expect(listMessages(await fixture.invoke("messages", "GET", {}, locale)).map((row) => row.id)).toEqual([messageIds.second]);
    fixture.state.actor = people.student;
    expect(listMessages(await fixture.invoke("account", "GET", {}, locale), "account").map((row) => row.id).sort())
      .toEqual([messageIds.anonymous, messageIds.named, messageIds.self, newId].sort());
  });

  test(`T04/${locale} student owned history survives no assignments, withdrawn consent, former and null schools`, async () => {
    const fixture = await messageAccessFixture();
    const former = id(110), unscoped = id(111);
    fixture.tables.student_messages.push(message(former, { school_id: otherSchool }), message(unscoped, { school_id: null }));
    fixture.tables.sweet_records.push({ id: id(112), user_id: people.student, school_id: null,
      records: [{ value: "Synthetic owned record" }], summary: "Owned history" });
    const expected = fixture.tables.student_messages.filter((row) => row.sender_user_id === people.student);
    fixture.revoke(); fixture.tables.profiles.find((row) => row.id === people.student)!.school_id = null;
    fixture.tables.student_consents.find((row) => row.student_user_id === people.student)!.status = "withdrawn";
    fixture.state.actor = people.student;
    const result = await fixture.invoke("account", "GET", {}, locale);
    expect(result.status).toBe(200);
    const rows = listMessages(result, "account");
    expect(rows.map((row) => row.id).sort()).toEqual(expected.map((row) => row.id).sort());
    for (const original of expected) expect(rows.find((row) => row.id === original.id)).toMatchObject({
      body: original.body, sender_user_id: people.student, anonymous_to_recipient: original.anonymous_to_recipient,
      school_id: original.school_id });
    expect(rows.filter((row) => row.id === messageIds.self)).toHaveLength(1);
    expect((result.body.data as Row).sweetRecords).toHaveLength(1);
    expect((result.body.data as Row).studentAssignments).toHaveLength(1);
    expect(fixture.state.consentCalls).toBe(0);
  });

  test(`T05/${locale} former teacher downgraded to student loses received mail but keeps own sent and self`, async () => {
    const fixture = await messageAccessFixture();
    const own = id(120), self = id(121);
    fixture.tables.student_messages.push(message(own, { sender_user_id: people.teacher, recipient_user_id: people.newTeacher }),
      message(self, { sender_user_id: people.teacher, recipient_type: "self", recipient_user_id: people.teacher, anonymous_to_recipient: false }));
    fixture.revoke();
    Object.assign(fixture.tables.profiles.find((row) => row.id === people.teacher)!, { role: "学生", school_id: null });
    fixture.tables.school_members.find((row) => row.user_id === people.teacher)!.status = "revoked";
    const result = await fixture.invoke("account", "GET", {}, locale);
    expect(result.status).toBe(200);
    expect(listMessages(result, "account").map((row) => row.id).sort()).toEqual([own, self].sort());
    expect((await fixture.invoke("messages", "PATCH", { id: messageIds.named }, locale)).status).toBe(404);
  });

  test(`T06/${locale} student owned export retains historical relation queries without new teacher-scope dependencies`, async () => {
    const fixture = await messageAccessFixture(); fixture.state.actor = people.student;
    fixture.state.failQuery = (operation) => operation.table === "schools"
      || operation.table === "teacher_student_assignments" && operation.filters.some(([op, key, value]) => op === "eq" && key === "status" && value === "active");
    const result = await fixture.invoke("account", "GET", {}, locale);
    expect(result.status).toBe(200);
    expect(listMessages(result, "account").map((row) => row.id).sort()).toEqual([messageIds.anonymous, messageIds.named, messageIds.self].sort());
    expect(fixture.state.queries.some((operation) => operation.table === "teacher_student_assignments"
      && operation.filters.some(([, key]) => key === "student_user_id"))).toBe(true);
    expect(fixture.state.queries.some((operation) => operation.table === "schools")).toBe(false);
    expect(fixture.state.consentCalls).toBe(0);
  });
}

const invalidScopes: Array<[string, (fixture: Awaited<ReturnType<typeof messageAccessFixture>>) => void]> = [
  ["membership revoked", (fixture) => { fixture.tables.school_members.find((row) => row.user_id === people.teacher)!.status = "revoked"; }],
  ["school paused", (fixture) => { fixture.tables.schools.find((row) => row.id === school)!.status = "paused"; }],
  ["teacher changed school", (fixture) => { fixture.tables.profiles.find((row) => row.id === people.teacher)!.school_id = otherSchool; }],
  ["student changed school", (fixture) => { fixture.tables.profiles.find((row) => row.id === people.student)!.school_id = otherSchool; }],
  ["student changed role", (fixture) => { fixture.tables.profiles.find((row) => row.id === people.student)!.role = "学校支持人员"; }],
  ["teacher changed role", (fixture) => { fixture.tables.profiles.find((row) => row.id === people.teacher)!.role = "专业支持者"; }],
  ["student profile missing", (fixture) => { fixture.tables.profiles = fixture.tables.profiles.filter((row) => row.id !== people.student); }],
  ["teacher profile missing", (fixture) => { fixture.tables.profiles = fixture.tables.profiles.filter((row) => row.id !== people.teacher); }],
  ["assignment missing", (fixture) => { fixture.tables.teacher_student_assignments = fixture.tables.teacher_student_assignments.filter((row) => row.student_user_id !== people.student); }],
];
for (const [reason, invalidate] of invalidScopes) {
  test(`T07 ${reason} cannot preserve teacher history access`, async () => {
    const fixture = await messageAccessFixture(); invalidate(fixture);
    const original = structuredClone(fixture.tables.student_messages);
    const inbox = await fixture.invoke("messages");
    expect(inbox.status).toBe(200);
    expect(listMessages(inbox).map((row) => row.id)).not.toContain(messageIds.anonymous);
    const exported = await fixture.invoke("account");
    expect(exported.status).toBe(200);
    expect(listMessages(exported, "account").map((row) => row.id)).not.toContain(messageIds.named);
    expect((await fixture.invoke("messages", "PATCH", { id: messageIds.named })).status).toBe(404);
    expect(fixture.tables.student_messages).toEqual(original);
  });
}
for (const failedTable of ["schools", "teacher_student_assignments"] as const) {
  test(`T07 ${failedTable} scope lookup error fails closed without leaking provider detail`, async () => {
    const fixture = await messageAccessFixture();
    fixture.state.failQuery = (operation) => operation.table === failedTable
      && (failedTable === "schools" || operation.filters.some(([, key, value]) => key === "status" && value === "active"));
    for (const route of ["messages", "account"] as const) {
      const result = await fixture.invoke(route);
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(result.body)).not.toContain(messageIds.anonymous);
    }
    expect((await fixture.invoke("messages", "PATCH", { id: messageIds.named })).status).toBeGreaterThanOrEqual(400);
    expect(fixture.tables.student_messages.find((row) => row.id === messageIds.named)?.read_at).toBeNull();
  });
}

test("T08 revocation and denied requests preserve message contents, receipts and audit history", async () => {
  const fixture = await messageAccessFixture();
  fixture.tables.student_messages[0].read_at = "2026-10-30T01:20:00.000Z";
  fixture.tables.student_message_duty_actions.push({ id: id(130), message_id: messageIds.anonymous,
    note: "Synthetic historical audit", actor_user_id: people.platformAdmin });
  const messagesBefore = structuredClone(fixture.tables.student_messages);
  const auditsBefore = structuredClone(fixture.tables.student_message_duty_actions);
  fixture.revoke();
  await fixture.invoke("messages"); await fixture.invoke("account");
  expect((await fixture.invoke("messages", "PATCH", { id: messageIds.anonymous })).status).toBe(404);
  expect(fixture.tables.student_messages).toEqual(messagesBefore);
  expect(fixture.tables.student_message_duty_actions).toEqual(auditsBefore);
  expect(fixture.state.mutations.filter((operation) => operation.table === "student_messages")).toEqual([]);
  expect(fixture.state.deletes).toBe(0);
  fixture.state.actor = people.student;
  expect(listMessages(await fixture.invoke("messages")).map((row) => row.id).sort())
    .toEqual([messageIds.anonymous, messageIds.named, messageIds.self].sort());
});

test("T09 guessed, absent and zero-row PATCH targets never report success", async () => {
  const fixture = await messageAccessFixture();
  const before = structuredClone(fixture.tables.student_messages);
  fixture.state.actor = people.newTeacher;
  fixture.tables.teacher_student_assignments.push({ id: id(131), school_id: school, teacher_user_id: people.newTeacher,
    student_user_id: people.student, status: "active" });
  const wrongRecipient = await fixture.invoke("messages", "PATCH", { id: messageIds.named });
  const missing = await fixture.invoke("messages", "PATCH", { id: id(99999) });
  expect(wrongRecipient.status).toBe(404); expect(missing.status).toBe(404);
  expect(wrongRecipient.body).toEqual(missing.body);
  fixture.state.actor = people.teacher; fixture.state.zeroUpdate = true;
  expect((await fixture.invoke("messages", "PATCH", { id: messageIds.named })).status).toBe(404);
  expect(fixture.tables.student_messages).toEqual(before);
});

test("T09 student self-message read remains allowed without a teacher relationship", async () => {
  const fixture = await messageAccessFixture(); fixture.state.actor = people.student; fixture.revoke();
  expect((await fixture.invoke("messages", "PATCH", { id: messageIds.self })).status).toBe(200);
  expect(fixture.tables.student_messages.find((row) => row.id === messageIds.self)?.read_at).toEqual(expect.any(String));
});

test("T10 invalid recent inbox prefix does not crowd out valid older messages", async () => {
  const fixture = await messageAccessFixture(); fixture.revoke();
  fixture.tables.student_messages = Array.from({ length: 130 }, (_, index) => message(id(2000 + index), {
    created_at: "2026-10-30T03:00:00.000Z" }));
  fixture.tables.student_messages.push(message(messageIds.second, { sender_user_id: people.secondStudent,
    created_at: "2026-10-29T01:00:00.000Z" }));
  const result = await fixture.invoke("messages");
  expect(result.status).toBe(200);
  expect(listMessages(result).map((row) => row.id)).toEqual([messageIds.second]);
});

test("T10 paged teacher download filters 1001 revoked records while student retains all 1002 owned records once", async () => {
  const fixture = await messageAccessFixture(); fixture.revoke();
  const revokedIds = Array.from({ length: 1001 }, (_, index) => id(3000 + index));
  fixture.tables.student_messages = revokedIds.map((messageId) => message(messageId));
  fixture.tables.student_messages.push(message(messageIds.second, { sender_user_id: people.secondStudent }),
    message(messageIds.self, { recipient_type: "self", recipient_user_id: people.student, anonymous_to_recipient: false }));
  const teacher = await fixture.invoke("account");
  expect(teacher.status).toBe(200);
  expect(listMessages(teacher, "account").map((row) => row.id)).toEqual([messageIds.second]);
  fixture.state.actor = people.student;
  const student = await fixture.invoke("account");
  expect(student.status).toBe(200);
  const ownIds = listMessages(student, "account").map((row) => row.id);
  expect(ownIds).toHaveLength(1002); expect(new Set(ownIds).size).toBe(1002);
  expect(ownIds.slice(0, 2)).toEqual([messageIds.self, revokedIds[0]]);
  expect(ownIds).toContain(revokedIds[1000]);
});

function activeScopeQuery(operation: Operation) {
  return operation.table === "teacher_student_assignments" && operation.kind === "select"
    && operation.filters.some(([, key, value]) => key === "status" && value === "active");
}

test("T10 list loaded under valid scope is rechecked after assignment revocation before response", async () => {
  const fixture = await messageAccessFixture(); let changed = false;
  fixture.state.afterQuery = (operation) => {
    if (!changed && operation.table === "student_messages" && operation.kind === "select") {
      changed = true; fixture.revoke();
    }
  };
  const result = await fixture.invoke("messages");
  expect(changed).toBe(true); expect(result.status).toBe(200);
  expect(listMessages(result).map((row) => row.id)).toEqual([messageIds.second]);
});

test("T10 PATCH rechecks an initial scope snapshot before writing after revocation", async () => {
  const fixture = await messageAccessFixture(); let changed = false;
  fixture.state.afterQuery = (operation) => {
    if (!changed && activeScopeQuery(operation)) { changed = true; fixture.revoke(); }
  };
  const result = await fixture.invoke("messages", "PATCH", { id: messageIds.named });
  expect(changed).toBe(true); expect(result.status).toBe(404);
  expect(fixture.tables.student_messages.find((row) => row.id === messageIds.named)?.read_at).toBeNull();
  expect(fixture.state.mutations.filter((operation) => operation.table === "student_messages")).toEqual([]);
});

test("T10 export rechecks received data after first page is loaded and relation revoked", async () => {
  const fixture = await messageAccessFixture(); let changed = false;
  fixture.tables.student_messages = Array.from({ length: 1001 }, (_, index) => message(id(5000 + index)));
  fixture.tables.student_messages.push(message(messageIds.second, { sender_user_id: people.secondStudent }));
  fixture.state.afterQuery = (operation) => {
    if (!changed && operation.table === "student_messages" && operation.kind === "select"
      && operation.filters.some(([, key]) => key === "recipient_user_id") && operation.from === 0) {
      changed = true; fixture.revoke();
    }
  };
  const result = await fixture.invoke("account");
  expect(changed).toBe(true); expect(result.status).toBe(200);
  expect(listMessages(result, "account").map((row) => row.id)).toEqual([messageIds.second]);
});

test("T10 export final scope recheck rejects revocation after an earlier scope snapshot", async () => {
  const fixture = await messageAccessFixture(); let changed = false;
  fixture.state.afterQuery = (operation) => {
    if (!changed && activeScopeQuery(operation)) { changed = true; fixture.revoke(); }
  };
  const result = await fixture.invoke("account");
  expect(changed).toBe(true); expect(result.status).toBe(200);
  expect(listMessages(result, "account").map((row) => row.id)).toEqual([messageIds.second]);
});

test("T11 teacher download filter does not change DELETE internal history counts or add scope failure dependency", async () => {
  const fixture = await messageAccessFixture(); fixture.revoke();
  const exported = await fixture.invoke("account");
  expect(listMessages(exported, "account").map((row) => row.id)).toEqual([messageIds.second]);
  const beforeMessages = structuredClone(fixture.tables.student_messages);
  fixture.state.queries.length = 0;
  fixture.state.failQuery = (operation) => operation.table === "schools" || activeScopeQuery(operation);
  const deleted = await fixture.invoke("account", "DELETE", { acknowledge: true, confirmationEmail: "teacher@example.invalid" });
  expect(deleted.status).toBe(200); expect(deleted.body).toEqual({ deleted: true });
  expect(fixture.state.deletes).toBe(1); expect(fixture.state.signOutCalls).toBe(0);
  expect(fixture.tables.account_deletion_audits).toHaveLength(1);
  expect(fixture.tables.account_deletion_audits[0].deletion_summary).toMatchObject({ messages: 3, teacherAssignments: 2 });
  expect(fixture.state.queries.some((operation) => operation.table === "schools" || activeScopeQuery(operation))).toBe(false);
  // The fixture's Auth delete is a recorded dependency double, not a claim of real FK execution.
  expect(fixture.tables.student_messages).toEqual(beforeMessages);
});

test("T12 anonymous received export nulls identity while original message data and operational audit remain intact", async () => {
  const fixture = await messageAccessFixture();
  fixture.tables.student_message_duty_actions.push({ id: id(140), message_id: messageIds.anonymous,
    note: "Synthetic audit history", actor_user_id: people.platformAdmin });
  const before = structuredClone(fixture.tables.student_messages);
  const audits = structuredClone(fixture.tables.student_message_duty_actions);
  const result = await fixture.invoke("account");
  expect(listMessages(result, "account").find((row) => row.id === messageIds.anonymous)?.sender_user_id).toBeNull();
  expect(fixture.tables.student_messages).toEqual(before);
  expect(fixture.tables.student_message_duty_actions).toEqual(audits);
  expect(fixture.state.mutations).toEqual([]);
});

test("T14 school and platform safety branches keep their independent scope after teacher revocation", async () => {
  const fixture = await messageAccessFixture(); fixture.revoke();
  const safetyId = id(150), otherSchoolSafety = id(151), dutyId = id(152);
  fixture.tables.student_messages.push(message(safetyId, { moderation_status: "safety_review" }),
    message(otherSchoolSafety, { moderation_status: "safety_review", school_id: otherSchool }),
    message(dutyId, { moderation_status: "safety_review", recipient_type: "pilot_duty", recipient_user_id: null,
      school_id: null, duty_status: "new", anonymous_to_recipient: false }));
  fixture.state.actor = people.schoolLead;
  const schoolSafety = await fixture.invoke("messages");
  expect(listMessages(schoolSafety).map((row) => row.id)).toEqual([safetyId]);
  expect(listMessages(schoolSafety)[0]).toMatchObject({ sender_user_id: people.student, canRevealSender: true });
  fixture.state.actor = people.platformAdmin;
  const platform = await fixture.invoke("messages");
  expect(listMessages(platform).map((row) => row.id)).toEqual([dutyId]);
  const queue = await fixture.invoke("duty");
  expect(queue.status).toBe(200);
  expect(listMessages(queue).map((row) => row.id)).toEqual([dutyId]);
  expect(listMessages(queue)[0].sender_user_id).toBe(people.student);
  const handled = await fixture.invoke("duty", "PATCH", { messageId: dutyId, status: "in_progress", note: "Synthetic operational record" });
  expect(handled.status).toBe(200); expect(fixture.state.rpcCalls).toHaveLength(1);
  expect(fixture.tables.student_message_duty_actions).toHaveLength(1);
});

test("T14 teacher cannot use platform status handling or alert retry regardless of assignment", async () => {
  const fixture = await messageAccessFixture();
  for (const revoked of [false, true]) {
    if (revoked) fixture.revoke();
    const handled = await fixture.invoke("duty", "PATCH", { messageId: messageIds.named, status: "resolved", note: "Synthetic attempt" });
    const retried = await fixture.invoke("duty", "POST", { messageId: messageIds.named });
    expect(handled.status).toBe(403); expect(retried.status).toBe(403);
  }
  expect(fixture.state.rpcCalls).toEqual([]); expect(fixture.state.alertCalls).toBe(0);
  expect(fixture.tables.student_message_duty_actions).toEqual([]);
});

test("T10 more than 1000 active assignments preserve a valid sender on the final scope page", async () => {
  const fixture = await messageAccessFixture();
  const studentIds = Array.from({ length: 1001 }, (_, index) => id(20000 + index));
  fixture.tables.profiles.push(...studentIds.map((studentId) => ({ id: studentId, role: "学生", school_id: school,
    email: "synthetic-scope-student@example.invalid", display_name: "Synthetic scope student" })));
  fixture.tables.teacher_student_assignments = studentIds.map((studentId, index) => ({ id: id(30000 + index),
    school_id: school, teacher_user_id: people.teacher, student_user_id: studentId, status: "active" }));
  const lastMessage = id(40000);
  fixture.tables.student_messages = [message(lastMessage, { sender_user_id: studentIds[1000] })];
  const result = await fixture.invoke("messages");
  expect(result.status).toBe(200);
  expect(listMessages(result).map((row) => row.id)).toEqual([lastMessage]);
  expect(listMessages(result)[0].sender_user_id).toBeNull();
});

test("T10 batched sender scopes preserve global newest 100 and stay within ordinary URL limits", async () => {
  const fixture = await messageAccessFixture();
  const studentIds = Array.from({ length: 301 }, (_, index) => id(50000 + index));
  fixture.tables.profiles.push(...studentIds.map((studentId) => ({ id: studentId, role: "学生", school_id: school,
    email: "synthetic-batched-student@example.invalid", display_name: "Synthetic batched student" })));
  fixture.tables.teacher_student_assignments = studentIds.map((studentId, index) => ({ id: id(51000 + index),
    school_id: school, teacher_user_id: people.teacher, student_user_id: studentId, status: "active" }));
  const recentId = id(62000);
  fixture.tables.student_messages = Array.from({ length: 150 }, (_, index) => message(id(60000 + index), {
    sender_user_id: studentIds[0], created_at: new Date(Date.UTC(2026, 9, 30, 1, index)).toISOString(),
  }));
  fixture.tables.student_messages.push(message(recentId, { sender_user_id: studentIds[300], created_at: "2026-10-30T23:00:00.000Z" }));
  const result = await fixture.invoke("messages");
  expect(result.status).toBe(200);
  const ids = listMessages(result).map((row) => row.id);
  expect(ids).toHaveLength(100);
  expect(ids[0]).toBe(recentId);
  expect(ids.slice(1)).toEqual(Array.from({ length: 99 }, (_, index) => id(60149 - index)));
  for (const operation of fixture.state.queries.filter((query) => query.filters.some(([op]) => op === "in"))) {
    const query = new URLSearchParams({ select: operation.columns });
    for (const [op, key, value] of operation.filters) {
      query.append(key, `${op}.${op === "in" ? `(${(value as unknown[]).join(",")})` : String(value)}`);
    }
    // This is a query-size guard, not a claim that the fixture executed an actual HTTP request.
    expect(`https://synthetic.example.invalid/rest/v1/${operation.table}?${query}`.length).toBeLessThan(8000);
  }
});
