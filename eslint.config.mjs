import { readFileSync } from "node:fs";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const reactVersion = JSON.parse(readFileSync(new URL(import.meta.resolve("react/package.json")), "utf8")).version;

// Treat findings consistently as errors so the reviewed, file/rule-count
// baseline can record existing debt while CI rejects new file/rule pairs or
// increased counts. It cannot detect a same-rule replacement within one file.
function strict(configs) {
  return configs.map((entry) => ({
    ...entry,
    ...(entry.rules && {
      rules: Object.fromEntries(Object.entries(entry.rules).map(([rule, value]) => {
        const options = Array.isArray(value) ? value : [value];
        return [rule, options[0] === "warn" || options[0] === 1 ? ["error", ...options.slice(1)] : value];
      })),
    }),
  }));
}

const config = defineConfig([
  ...strict(nextVitals),
  ...strict(nextTypeScript),
  {
    // Next 16.2's auto-detection calls a removed ESLint 10 context API.
    // Use the installed runtime version without changing the framework.
    settings: { react: { version: reactVersion } },
  },
  globalIgnores([
    ".next*/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "deliverables/**",
    "work/**",
    "public/**",
    "supabase/**",
  ]),
]);

export default config;
