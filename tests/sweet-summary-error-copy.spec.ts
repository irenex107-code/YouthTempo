import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import zh from "../locales/zh-CN.json";
import en from "../locales/en.json";
import { SweetPersistenceError } from "../lib/sweetPersistenceProtocol";

// Execute the actual page error mapper in its lexical translation context.
// This tests opaque SDK failures separately from the browser transport paths.
for (const [locale, dictionary] of [["zh-CN", zh], ["en", en]] as const) {
  test(`${locale} B opaque credential/read error cannot settle earlier unknown write`, () => {
    const source = ts.createSourceFile("page.tsx", readFileSync("views/check-in/page.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let node: ts.FunctionDeclaration | undefined;
    function visit(candidate: ts.Node) {
      if (ts.isFunctionDeclaration(candidate) && candidate.name?.text === "recordSaveErrorMessage") node = candidate;
      else ts.forEachChild(candidate, visit);
    }
    visit(source); expect(node).toBeDefined();
    const actual = node!.getText(source);
    const output = ts.transpileModule(`${actual}; exports.map = recordSaveErrorMessage;`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const exported: { map?: (error: unknown) => string } = {};
    vm.runInNewContext(output, { exports: exported, Error, SweetPersistenceError, t: (key: string) => {
      let value: unknown = dictionary;
      for (const part of key.split(".")) value = (value as Record<string, unknown>)[part];
      return value;
    } });
    for (const error of [new Error("Synthetic credential lookup unavailable"), { message: "Synthetic opaque SDK error" }]) {
      expect(exported.map!(error)).toBe(dictionary.checkIn.messages.persistenceUnavailable);
    }
    expect(exported.map!(new SweetPersistenceError("outcome_unknown"))).toBe(dictionary.checkIn.messages.persistenceUnknown);
    expect(exported.map!(new SweetPersistenceError("write_rejected"))).toBe(dictionary.checkIn.messages.saveFailed);
    expect(exported.map!(new SweetPersistenceError("conflict"))).toBe(dictionary.checkIn.messages.persistenceConflict);
  });
}
