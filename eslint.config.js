import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // グローバルな無視設定
  {
    ignores: [
      "dist/",
      "node_modules/",
      ".eslintrc.cjs", // 古い設定ファイル
      "eslint.config.js", // 自分自身
    ],
  },
  // ESLint推奨ルール (すべての .js, .ts ファイルに適用)
  eslint.configs.recommended,
  // TypeScript ESLint推奨ルール ( .ts ファイルのみに適用)
  {
    files: ["**/*.ts"], // .ts ファイルに限定
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json", // 型情報を使用
      },
    },
    rules: {
      // TypeScript固有のルール設定
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // Prettier設定 (すべてのファイルに適用)
  prettierConfig, // Prettierとの競合ルールを無効化
  // グローバルなルール設定 (必要であれば)
  {
    languageOptions: {
      globals: {
        process: "readonly",
        __dirname: "readonly",
      },
    },
    rules: {
      // プロジェクト固有のルールなど
    },
  },
);
