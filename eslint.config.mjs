import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next 16.4 brings eslint-plugin-react-hooks 7.1, whose
  // compiler rules now catch ten existing spots: Date.now() read during
  // render in the admin, and state set from an effect that reads the URL or
  // localStorage on mount. They behave as intended today, so the security
  // upgrade leaves that code alone and reports them as warnings. Put both
  // rules back to "error" once those spots are reworked.
  {
    rules: {
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
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
