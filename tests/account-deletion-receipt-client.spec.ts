import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import * as days from "../lib/sweetRecordDays";
import type { AccountDeletionReceipt } from "../lib/cloudRecords";

const a = "00000000-0000-4000-8000-000000000091";
const b = "00000000-0000-4000-8000-000000000092";
const detail = "PRIVATE_SYNTHETIC_PROVIDER_DETAIL";
async function fixture() {
  const values = new Map<string, string>();
  const requests: Array<{ path: string; init: RequestInit; body: Record<string, unknown> }> = [];
  let actor = a;
  let authReads = 0;
  let storageFailure = false;
  let response: () => Promise<Response> = async () => Response.json({ deleted: true });
  const storage = {
    getItem(key: string) { if (storageFailure) throw new Error(detail); return values.get(key) ?? null; },
    setItem(key: string, value: string) { if (storageFailure) throw new Error(detail); values.set(key, value); },
    removeItem(key: string) { if (storageFailure) throw new Error(detail); values.delete(key); },
  };
  const client = { auth: { getSession: async () => {
    authReads += 1;
    return { data: { session: actor ? { user: { id: actor }, access_token: "SYNTHETIC_TOKEN" } : null }, error: null };
  } } };
  const source = await readFile(path.join(process.cwd(), "lib/cloudRecords.ts"), "utf8");
  const exported = {} as typeof import("../lib/cloudRecords");
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    exports: exported, crypto: webcrypto, Uint8Array, btoa, Event, AbortController, setTimeout, clearTimeout,
    window: { sessionStorage: storage, dispatchEvent() {} },
    fetch: async (url: string, init: RequestInit) => {
      requests.push({ path: url, init, body: JSON.parse(String(init.body)) });
      return response();
    },
    require(name: string) {
      if (name === "@/lib/supabaseClient") return { getSupabase: () => client };
      if (name === "@/lib/sweetRecordDays") return days;
      throw new Error("Unexpected synthetic dependency");
    },
  });
  return { api: exported, values, requests, reads: () => authReads, actor: (id: string) => { actor = id; },
    storageFail: () => { storageFailure = true; }, reply: (fn: () => Promise<Response>) => { response = fn; } };
}
async function errorOf(operation: Promise<unknown>) {
  try { await operation; } catch (error) { return error as { message: string; deletionState: string }; }
  throw new Error("Expected a safe failure");
}

test("实际helper生成32字节能力回执，24小时仅存UUID和secret，保留不同owner并复用原operation", async () => {
  const f = await fixture();
  const first = f.api.createAccountDeletionReceipt(a);
  expect(first.operationId).toMatch(/^[a-f0-9-]{14}4[a-f0-9-]{21}$/);
  expect(Buffer.from(first.secret, "base64url")).toHaveLength(32);
  expect(first.expiresAt - Date.now()).toBeGreaterThan(86_390_000);
  expect(first.expiresAt - Date.now()).toBeLessThanOrEqual(86_400_000);
  expect(Object.keys(first).sort()).toEqual(["expiresAt", "operationId", "secret", "subjectUserId"]);
  expect(f.api.createAccountDeletionReceipt(a)).toEqual(first);
  const second = f.api.createAccountDeletionReceipt(b);
  expect(f.api.listAccountDeletionReceipts().map((value) => value.subjectUserId).sort()).toEqual([a, b]);
  expect(second.secret).not.toBe(first.secret);
  expect(JSON.stringify([...f.values])).not.toContain("email");
  expect(f.requests).toHaveLength(0);
});

test("实际storage故障安全拒绝创建且不发送DELETE，过期/污染字段被清除", async () => {
  const f = await fixture();
  const receipt = f.api.createAccountDeletionReceipt(a);
  f.values.set(f.api.accountDeletionReceiptStorageKey, JSON.stringify([{ ...receipt, expiresAt: Date.now() - 1, email: "synthetic@example.invalid" }]));
  expect(f.api.listAccountDeletionReceipts()).toEqual([]);
  expect(f.values.size).toBe(0);
  f.storageFail();
  let error: unknown;
  try { f.api.createAccountDeletionReceipt(a); } catch (caught) { error = caught; }
  expect(error).toMatchObject({ name: "AccountDeletionError", message: "Account deletion unavailable" });
  expect(String(error)).not.toContain(detail);
  expect(f.requests).toHaveLength(0);
});

test("实际DELETE仍绑定原actor且兼容旧client，receipt不会把subject当客户端授权字段", async () => {
  const f = await fixture();
  const receipt = f.api.createAccountDeletionReceipt(a);
  await f.api.deleteAccountPermanently("synthetic@example.invalid", a, receipt);
  expect(f.requests[0].body).toEqual({ confirmationEmail: "synthetic@example.invalid", acknowledge: true,
    receipt: { operationId: receipt.operationId, secret: receipt.secret } });
  expect(f.requests[0].init.headers).toEqual({ authorization: "Bearer SYNTHETIC_TOKEN", "content-type": "application/json" });
  f.actor(b);
  const changed = await errorOf(f.api.deleteAccountPermanently("synthetic@example.invalid", a, receipt));
  expect(changed.message).toBe("Account deletion unavailable");
  expect(f.requests).toHaveLength(1);
  f.actor(a);
  await f.api.deleteAccountPermanently("synthetic@example.invalid", a);
  expect(f.requests[1].body).toEqual({ confirmationEmail: "synthetic@example.invalid", acknowledge: true });
});

test("DELETE响应未知仍保留原回执，原Auth消失后4种显式状态查询不读session也不重删", async () => {
  const f = await fixture();
  const receipt = f.api.createAccountDeletionReceipt(a);
  f.reply(async () => { throw new Error(detail); });
  const error = await errorOf(f.api.deleteAccountPermanently("synthetic@example.invalid", a, receipt));
  expect(error).toMatchObject({ message: "Account deletion unavailable", deletionState: "unknown" });
  expect(f.api.listAccountDeletionReceipts()).toEqual([receipt]);
  const authReads = f.reads();
  f.actor("");
  for (const state of ["not_deleted", "deleted_cleanup_pending", "completed", "unknown"] as const) {
    f.reply(async () => Response.json({ state }));
    expect(await f.api.checkAccountDeletionStatus(receipt)).toBe(state);
    const request = f.requests.at(-1)!;
    expect(request.path).toBe("/api/account/deletion-status");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toEqual({ "content-type": "application/json" });
    expect(request.body).toEqual({ subjectUserId: a, operationId: receipt.operationId, secret: receipt.secret });
  }
  expect(f.reads()).toBe(authReads);
  expect(f.requests.filter((request) => request.init.method === "DELETE")).toHaveLength(1);
});

test("provider内容、格式错误和网络错误不变成客户端明文或误报not_deleted", async () => {
  const f = await fixture();
  const receipt = f.api.createAccountDeletionReceipt(a);
  f.reply(async () => Response.json({ error: detail }, { status: 500 }));
  expect(await errorOf(f.api.deleteAccountPermanently("synthetic@example.invalid", a, receipt)))
    .toMatchObject({ message: "Account deletion unavailable", deletionState: "unknown" });
  for (const status of [429, 503, 500]) {
    f.reply(async () => Response.json({ state: "not_deleted", error: detail }, { status }));
    expect(await errorOf(f.api.checkAccountDeletionStatus(receipt)))
      .toMatchObject({ message: "Account deletion unavailable", deletionState: "unknown" });
  }
  f.reply(async () => Response.json({ state: "PRIVATE_UNKNOWN_ENUM", error: detail }));
  expect((await errorOf(f.api.checkAccountDeletionStatus(receipt))).message).toBe("Account deletion unavailable");
  f.reply(async () => Response.json({ deletionState: "not_deleted", error: detail }, { status: 409 }));
  expect((await errorOf(f.api.deleteAccountPermanently("synthetic@example.invalid", a, receipt))).deletionState).toBe("not_deleted");
});

test("过期/坏能力只能得到unknown，不能发查询或删除，不能以邮箱推断旧UUID", async () => {
  const f = await fixture();
  const receipt = f.api.createAccountDeletionReceipt(a);
  const expired = { ...receipt, expiresAt: Date.now() - 1 };
  expect(await f.api.checkAccountDeletionStatus(expired)).toBe("unknown");
  const invalid = { ...receipt, secret: "invalid" } as AccountDeletionReceipt;
  expect(await f.api.checkAccountDeletionStatus(invalid)).toBe("unknown");
  expect(await errorOf(f.api.deleteAccountPermanently("synthetic@example.invalid", a, invalid)))
    .toMatchObject({ message: "Account deletion unavailable" });
  expect(f.requests).toHaveLength(0);
});
