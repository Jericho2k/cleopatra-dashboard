import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Legacy Supabase payloads are still being typed incrementally. Keep the
    // debt visible without making unrelated production fixes fail the gate.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn",
      // A leading underscore is this codebase's existing way of saying "this
      // parameter is part of the signature and deliberately unread" — the
      // reconcile(reason) call sites document WHY a refresh fired even though
      // the body does not branch on it. Everything without the underscore is
      // an error, because an unused binding is usually a half-finished edit.
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      // Correctness-class rules, fatal rather than advisory. These are the
      // ones that have actually produced bugs here: FE-007 was an effect
      // depending on state it mutated, and app/scripts had the same shape.
      "react-hooks/rules-of-hooks": "error",
      "@typescript-eslint/no-unused-expressions": "error",
      "jsx-a11y/alt-text": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
