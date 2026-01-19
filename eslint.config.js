import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";

export default [
  js.configs.recommended,

  {
    files: ["public/js/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },

    plugins: {
      import: importPlugin,
      "unused-imports": unusedImports,
    },

    rules: {
      /* ---------- A: локальные ---------- */
      "no-unused-vars": [
        "warn",
        {
          vars: "all",
          args: "after-used",
          ignoreRestSiblings: true,
        },
      ],

      /* ---------- C: неиспользуемые импорты ---------- */
      "unused-imports/no-unused-imports": "warn",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
        },
      ],

      /* ---------- B: экспорт, который никто не импортирует ---------- */
      "import/no-unused-modules": [
        "warn",
        {
          unusedExports: true,
          src: ["public/js/**/*.js"],
        },
      ],
    },
  },
];
