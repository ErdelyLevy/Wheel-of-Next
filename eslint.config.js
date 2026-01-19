import importPlugin from "eslint-plugin-import";
import globals from "globals";

export default [
  // Линтим только ваш фронт-код
  {
    files: ["public/js/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      import: importPlugin,
    },
    settings: {
      // Чтобы import/no-unresolved нормально резолвил .js
      "import/resolver": {
        node: { extensions: [".js"] },
      },
    },
    rules: {
      // БАЗОВОЕ: несуществующие пути
      "import/no-unresolved": "error",

      // ГЛАВНОЕ ДЛЯ ВАС: импортируемое имя должно быть экспортировано
      "import/named": "error",

      // Дополнительно полезные проверки по импорту
      "import/default": "error",
      "import/namespace": "error",
      "import/no-duplicates": "error",

      // Ловит использование переменных, которые не объявлены/не импортированы
      "no-undef": "error",
    },
  },
];
