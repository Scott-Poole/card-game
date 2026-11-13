import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import { builtinModules } from "node:module";

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
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: [
          "./tsconfig.node.json",
          "./tsconfig.client.json",
          "./tsconfig.engine.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...areas.map((area) => ({
    files: [`src/${area}/**/*.ts`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["engine", "protocol"].includes(area)
            ? builtinModules.flatMap((name) => [name, `node:${name}`])
            : [],
          patterns: [
            ...forbidden[area].map((other) => ({
              group: [`**/${other}`, `**/${other}/**`],
              message: `${area} must not import ${other}`,
            })),
            ...(["engine", "protocol"].includes(area)
              ? [
                  {
                    regex: "^(?!\\.|vitest$)",
                    message: "Pure areas may import only local source files.",
                  },
                ]
              : []),
          ],
        },
      ],
    },
  })),
  prettier,
);
