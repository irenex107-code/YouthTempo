import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import type { NextApiRequest, NextApiResponse } from "next";
import * as protocol from "../../lib/sweetPersistenceProtocol";
import zh from "../../locales/zh-CN.json";
import en from "../../locales/en.json";

/** Actual bridge, synthetic trusted RPC/Auth only. Never connects to a database. */
export function syntheticSweetBridge(actor: string, rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>, locale: "zh-CN" | "en" = "zh-CN") {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const exported = {} as typeof import("../../lib/sweetPersistenceServer");
  const output = ts.transpileModule(readFileSync("lib/sweetPersistenceServer.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { exports: exported, require(name: string) {
    if (name === "./supabaseServer") return { getAuthenticatedUser: async () => ({ id: actor }),
      getSupabaseAdmin: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args: structuredClone(args) }); return rpc(name, args);
      } }) };
    if (name === "./sweetPersistenceProtocol") return protocol;
    if (name === "./i18n/server") return { getRequestLocale: () => locale, getServerTranslator: () => (key: string) => {
      let value: unknown = locale === "en" ? en : zh;
      for (const part of key.split(".")) value = (value as Record<string, unknown>)[part];
      return value;
    } };
    if (name === "./operationalMonitoring") return { reportOperationalError: () => {} };
    throw new Error(`Unexpected offline bridge dependency: ${name}`);
  } });
  return { calls, async run(body: unknown, mini = false) {
    let status = 0; let packet: Record<string, unknown> = {};
    const res = { setHeader() {}, status(code: number) { status = code; return res; },
      json(data: Record<string, unknown>) { packet = data; return res; } };
    await exported.handleSweetPersistence({ method: "POST", body, query: {}, cookies: {}, headers: {} } as NextApiRequest,
      res as unknown as NextApiResponse, mini);
    return { status, body: packet };
  } };
}
