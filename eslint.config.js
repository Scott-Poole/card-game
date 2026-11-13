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
  { ignores: ["node_modules/**", "dist/**"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    files: ["src/**/*.{ts,tsx}", "vitest.config.ts"],
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
            ...forbidden[area].map((other) => ({
              group: [`**/${other}`, `**/${other}/**`],
              message: `${area} must not import ${other}`,
            })),
          ],
        },
      ],
    },
  })),
  prettier,
);
