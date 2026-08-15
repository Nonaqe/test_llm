/**
 * Правила зависимостей между пакетами — docs/04_FOLDER_STRUCTURE.md §4.
 * Нарушение = ошибка CI (скрипт root: pnpm check:deps).
 */
module.exports = {
  forbidden: [
    {
      name: "shared-isolated",
      comment: "packages/shared не зависит от других пакетов репозитория",
      severity: "error",
      from: { path: "^packages/shared" },
      to: { path: "^packages/(?!shared($|/))|^apps/" },
    },
    {
      name: "core-only-shared",
      comment: "packages/core — чистый TS, зависит только от packages/shared (не от NestJS)",
      severity: "error",
      from: { path: "^packages/core" },
      to: { path: "^packages/(?!shared($|/)|core($|/))|^apps/" },
    },
    {
      name: "ui-only-shared",
      comment: "packages/ui зависит только от shared",
      severity: "error",
      from: { path: "^packages/ui" },
      to: { path: "^packages/(?!shared($|/)|ui($|/))|^apps/" },
    },
    {
      name: "widget-only-shared",
      comment: "виджет зависит только от shared — бюджет 60 КБ (docs/08_WIDGET.md §9)",
      severity: "error",
      from: { path: "^apps/widget" },
      to: { path: "^(apps/(api|admin)|packages/(core|ui))" },
    },
    {
      name: "admin-no-core",
      comment: "admin зависит только от shared и ui (docs/04_FOLDER_STRUCTURE.md §4)",
      severity: "error",
      from: { path: "^apps/admin" },
      to: { path: "^(apps/(api|widget)|packages/core)" },
    },
    {
      name: "api-no-other-apps",
      comment: "api не импортирует код других приложений",
      severity: "error",
      from: { path: "^apps/api" },
      to: { path: "^apps/(admin|widget)" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Сканируем только исходники — артефакты сборки не являются кодом
    exclude: { path: "(^|/)dist/" },
    // Workspace-пакеты резолвятся в исходники (не в node_modules-симлинки),
    // иначе нарушения через package-name импорты не видны
    tsConfig: { fileName: ".depcruise-tsconfig.json" },
  },
};
