import hooks from "eslint-plugin-react-hooks";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

const areas = ["engine", "protocol", "server", "client"];
const forbidden = {
  engine: ["protocol", "server", "client"],
  protocol: ["engine", "server", "client"],
  server: ["client"],
  client: ["server"],
};
export default tseslint.config(
  {
    ignores: ["node_modules/**", "dist/**", "styled-system/**"],
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
  },
  js.configs.recommended,
  {
    files: ["e2e/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          property: "waitForTimeout",
          message:
            "Wait for a deterministic event or use a condition-based Playwright assertion instead of a fixed sleep.",
        },
      ],
    },
  },
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    files: ["src/**/*.{ts,tsx}", "*.config.ts", "e2e/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: [
          "./tsconfig.node.json",
          "./tsconfig.client.json",
          "./tsconfig.engine.json",
          "./tsconfig.tooling.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["scripts/**/*.mjs", "eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { process: "readonly", console: "readonly" },
    },
  },
  {
    files: ["src/rules/**/*.ts"],
    ignores: ["src/rules/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportDeclaration, ExportNamedDeclaration[source], ExportAllDeclaration, ImportExpression, TSImportType",
          message: "Rules must import nothing.",
        },
      ],
    },
  },
  ...areas.map((area) => ({
    files: [`src/${area}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression",
          message: "Use static imports so area boundaries are checked.",
        },
        {
          selector: "TSImportType",
          message: "Use static type imports so area boundaries are checked.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...(area !== "client"
              ? [
                  {
                    group: ["**/styled-system", "**/styled-system/**"],
                    message: "Only client may import styled-system.",
                  },
                ]
              : []),
            ...forbidden[area].map((other) => ({
              group: [`**/${other}`, `**/${other}/**`],
              message: `${area} must not import ${other}`,
            })),
            ...(["engine", "protocol"].includes(area)
              ? [
                  {
                    regex: "^(?!\\.)",
                    message: "Pure areas may import only local source files.",
                  },
                ]
              : []),
          ],
        },
      ],
    },
  })),
  {
    files: ["src/rules/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!vitest$|\\./)",
              message: "Rules tests may import only their module and Vitest.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportExpression, TSImportType, ExportNamedDeclaration[source], ExportAllDeclaration",
          message: "Use static imports in rules tests.",
        },
      ],
    },
  },
  ...["engine", "protocol"].map((area) => ({
    files: [`src/${area}/**/*.test.{ts,tsx}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^(?!\\.|vitest$)",
              message: "Tests may import only local source and Vitest.",
            },
            ...(area !== "client"
              ? [
                  {
                    group: ["**/styled-system", "**/styled-system/**"],
                    message: "Only client may import styled-system.",
                  },
                ]
              : []),
            ...forbidden[area].map((other) => ({
              group: [`**/${other}`, `**/${other}/**`],
              message: `${area} must not import ${other}`,
            })),
          ],
        },
      ],
    },
  })),
  {
    files: ["src/client/**/*.{ts,tsx}"],
    plugins: { "react-hooks": hooks },
    rules: hooks.configs.recommended.rules,
  },
  prettier,
);
