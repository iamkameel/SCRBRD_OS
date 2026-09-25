/**
 * ESLint — rules that catch bugs, not rules about taste.
 *
 * `js.configs.recommended` is the base: undefined names, unreachable code,
 * duplicate keys and cases, self-assignment, constant conditions — each one a
 * defect that runs, passes review, and does the wrong thing. On top of it:
 * eqeqeq (with the `== null` idiom this codebase uses on purpose), the React
 * hooks rules for the client, and nothing stylistic. Formatting is not linted.
 *
 * `pnpm lint` fails on errors only. Warnings are the queue of things worth a
 * look that are not yet known to be wrong — exhaustive-deps above all, where
 * a missing dependency is sometimes a stale closure and sometimes the point.
 */
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import { strictList, prefixOf, excludedList } from "./tools/typecheck.mjs";

// The typecheck's strict list (tsconfig.json `include`) is also where lint is
// strictest. One list, so a package that joins one joins both — and a file
// excluded from one (tsconfig.json `exclude`) is excluded from both.
const STRICT = strictList().map((g) => `${prefixOf(g)}**`);
const HOLES = excludedList();

const UNUSED = {
  args: "after-used",
  argsIgnorePattern: "^_",
  varsIgnorePattern: "^_",
  caughtErrors: "none",
  destructuredArrayIgnorePattern: "^_",
  ignoreRestSiblings: true,
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "apps/web/public/assets/generated/**",
      "scrbrd-supabase-*.sql",
      ".claude/**",
    ],
  },

  js.configs.recommended,

  {
    files: ["**/*.{js,mjs,cjs,jsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      // Server, tools and packages run on Node; packages/* also ship to the
      // browser (the outbox uses IndexedDB), and the client's tests run under
      // Node. So both, everywhere, except where narrowed below.
      globals: { ...globals.node, ...globals.browser },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      // An unused variable is usually a finished refactor, sometimes a
      // forgotten call. `_` marks the deliberate ones. A WARNING outside the
      // strict list: there were ~85 on the day this landed, all dead code
      // rather than defects, and clearing them is its own change. An error
      // inside it (below).
      "no-unused-vars": ["warn", UNUSED],
      // Same reasoning: a dead store is untidy, rarely wrong.
      "no-useless-assignment": "warn",
      // `x == null` covers null and undefined together and is used that way
      // throughout; every other loose comparison is a coercion waiting to bite.
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "no-throw-literal": "error",
      "no-template-curly-in-string": "error",
      "no-unmodified-loop-condition": "error",
      "no-constructor-return": "error",
      "no-new-native-nonconstructor": "error",
      "array-callback-return": ["error", { allowImplicit: true }],
      // An empty catch is a deliberate "this may fail and that is fine" here
      // (best-effort cleanup, optional storage); an empty block elsewhere is not.
      "no-empty": ["error", { allowEmptyCatch: true }],
      // The CSV code documents the BOM and em-dashes it handles, in comments.
      "no-irregular-whitespace": ["error", { skipComments: true, skipStrings: true, skipTemplates: true, skipRegExps: true }],
      // Style. A regex with two literal spaces is matching two spaces.
      "no-regex-spaces": "off",
    },
  },

  {
    files: STRICT,
    ignores: HOLES,
    rules: {
      "no-unused-vars": ["error", UNUSED],
      "no-useless-assignment": "error",
    },
  },

  // The client: React components and the hooks rules.
  {
    files: ["apps/web/**/*.{js,jsx,mjs}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Service workers run in neither a page nor Node.
  {
    files: ["apps/web/public/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.serviceworker, firebase: "readonly" },
    },
  },
];
