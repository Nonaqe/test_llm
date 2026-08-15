---
id: DOC-INDEX
title: Документация проекта — главный вход
project: Universal Chat — Self-Hosted AI Chat Platform
version: 0.1.0
status: draft
audience: developer, architect, integrator, admin, operator, ai-agent
priority: high
summary: Главный вход в документацию. Содержит описание проекта, его главные ограничения, правила пользования документацией для людей и ИИ-агентов, таблицу всех разделов и быстрые ссылки по типовым задачам.
when_to_read: Всегда первым. Любая работа с проектом (человеком или ИИ) начинается с этого файла.
when_not_to_read: Никогда не пропускать. Если вы уже читали его в этой сессии и знаете нужный раздел — переходите сразу к нему.
keywords: индекс, вход, документация, карта, навигация, правила
related:
  - DOC-NAV
  - DOC-MAP
  - DOC-029
---

# Universal Chat — документация

## Краткое содержание

Этот файл — входная точка. Дальше по ссылке на нужный раздел. Не читайте всю документацию подряд.

## Проект

**Universal Chat** (рабочее название, TBD) — self-hosted программный комплекс: универсальная встраиваемая система чата поддержки с AI-ботом и передачей диалога живому оператору. Устанавливается на сервер заказчика; все данные остаются у заказчика.

**Главные ограничения проекта (неизменяемые):**

1. Это **НЕ SaaS**. Обязательная внешняя инфраструктура вендора отсутствует; установленная система работает автономно.
2. Комплекс устанавливается **на сервер заказчика** (VPS + Docker).
3. **Все данные хранятся у заказчика** (PostgreSQL на его сервере).
4. Основные интеграции первой версии: **сайты на чистом коде (HTML/PHP/JS)** и **WordPress**.
5. Архитектура позволяет **добавлять другие CMS/платформы** позже через integration-слой без переписывания ядра.
6. AI работает через **внешний API или локальный LLM** (OpenAI-compatible провайдер, включая Ollama; ключи заказчика).
7. Есть **панель оператора** с очередью и handoff.
8. **Настройка AI под нишу — без программирования** (персона, знания, правила эскалации — через админку).

## Как пользоваться документацией (человеку)

1. Найдите свою задачу в разделе «Быстрые ссылки по задачам» ниже.
2. Откройте 1–3 указанных документа. У каждого документа в начале — **паспорт**: summary, when_to_read, keywords.
3. Подробная карта всех файлов — `DOCUMENTATION_MAP.md` (DOC-MAP).

## Правила для ИИ-агентов (кратко)

Полные правила — `AI_NAVIGATION.md` (DOC-NAV) и `29_AI_AGENT_RULES.md` (DOC-029). Обязательный минимум:

1. **Не читать все файлы подряд.** Порядок: INDEX → выбор 1–3 разделов по задаче → паспорта → контент.
2. Маршрут выбирать по таблице «Быстрые ссылки по задачам» ниже или по `when_to_read` в манифесте.
3. **Единственный источник истины:** каждый факт описан ровно в одном документе (см. таблицу ниже); остальные файлы только ссылаются. Перед изменением факта правьте документ-источник.
4. Несозданные разделы имеют статус `planned` в манифесте — не пытайтесь их читать, не выдумывайте содержимое.
5. Изменения в документацию вносить по правилам DOC-029 (паспорт, ID, связи, обновление манифеста).

### Таблица «источник истины»

| Домен | Документ-источник |
|---|---|
| Архитектурные решения и схемы | DOC-003, DOC-026 |
| Структура репозитория | DOC-004 |
| Backend, модули, conversation engine | DOC-005 |
| Схема БД, миграции | DOC-006 |
| Контракты REST/WS API | DOC-007 |
| Виджет, SDK, embed | DOC-008 |
| WordPress-плагин | DOC-009 |
| Универсальная интеграция на чистый сайт | DOC-010 |
| AI-модуль, провайдеры, guardrails | DOC-011 |
| База знаний, RAG-пайплайн | DOC-012 |
| Панель оператора, state machine диалога | DOC-013 |
| Правила эскалации | DOC-014 |
| Безопасность, угрозы, митигации | DOC-015 |
| Установка и развёртывание | DOC-016 |
| Конфигурация, переменные окружения | DOC-017 |
| Тестирование | DOC-018 |
| Логи, мониторинг, диагностика | DOC-019 |
| Обновления и миграции версий | DOC-020 |
| Терминология | DOC-028 |

## Таблица всех разделов

| ID | Файл | Название | Статус | Приоритет | Аудитория |
|---|---|---|---|---|---|
| DOC-INDEX | INDEX.md | Главный вход в документацию | draft | high | все |
| DOC-NAV | AI_NAVIGATION.md | Навигация для ИИ-агентов | draft | high | ai-agent, developer |
| DOC-MAP | DOCUMENTATION_MAP.md | Карта документации | draft | medium | все |
| DOC-MNF | documentation.manifest.json | Машинно-читаемый манифест | draft | medium | ai-agent |
| DOC-001 | 01_PROJECT_OVERVIEW.md | Обзор проекта | draft | high | все |
| DOC-002 | 02_BUSINESS_REQUIREMENTS.md | Бизнес- и функциональные требования | draft | high | architect, developer |
| DOC-003 | 03_SYSTEM_ARCHITECTURE.md | Системная архитектура | review | high | architect, developer |
| DOC-004 | 04_FOLDER_STRUCTURE.md | Структура репозитория | draft | medium | developer |
| DOC-005 | 05_BACKEND.md | Backend (NestJS) | draft | high | developer |
| DOC-006 | 06_DATABASE.md | База данных (PostgreSQL + pgvector) | draft | high | developer |
| DOC-007 | 07_API.md | API (REST + Socket.IO) | draft | high | developer, integrator |
| DOC-008 | 08_WIDGET.md | Чат-виджет | draft | high | developer, integrator |
| DOC-009 | 09_WORDPRESS_PLUGIN.md | WordPress-плагин | draft | high | developer, integrator |
| DOC-010 | 10_UNIVERSAL_INTEGRATION.md | Универсальная web-интеграция | draft | high | integrator |
| DOC-011 | 11_AI_MODULE.md | AI-модуль | draft | high | developer |
| DOC-012 | 12_KNOWLEDGE_BASE.md | База знаний | draft | high | developer, admin |
| DOC-013 | 13_OPERATOR_PANEL.md | Панель оператора | draft | high | developer, operator |
| DOC-014 | 14_ESCALATION_RULES.md | Правила эскалации | draft | high | admin, developer |
| DOC-015 | 15_SECURITY.md | Безопасность | draft | high | developer, architect |
| DOC-016 | 16_DEPLOYMENT.md | Развёртывание | draft | high | admin, integrator |
| DOC-017 | 17_CONFIGURATION.md | Конфигурация | draft | medium | admin, developer |
| DOC-018 | 18_TESTING.md | Тестирование | draft | medium | developer |
| DOC-019 | 19_LOGGING_MONITORING.md | Логи и мониторинг | draft | medium | admin, developer |
| DOC-020 | 20_UPDATES_MIGRATIONS.md | Обновления и миграции | draft | medium | admin, developer |
| DOC-021 | 21_USER_GUIDE.md | Руководство оператора | draft | medium | operator |
| DOC-022 | 22_ADMIN_GUIDE.md | Руководство администратора | draft | medium | admin |
| DOC-023 | 23_DEVELOPER_GUIDE.md | Руководство разработчика | draft | medium | developer |
| DOC-024 | 24_INTEGRATOR_GUIDE.md | Руководство интегратора | draft | medium | integrator |
| DOC-025 | 25_ROADMAP.md | Roadmap (MVP/V2/V3) | draft | medium | architect |
| DOC-026 | 26_ARCHITECTURE_DECISIONS.md | Архитектурные решения (ADR) | draft | high | architect, developer |
| DOC-027 | 27_FAQ.md | Частые вопросы | draft | low | все |
| DOC-028 | 28_GLOSSARY.md | Глоссарий | draft | low | все |
| DOC-029 | 29_AI_AGENT_RULES.md | Правила для ИИ-агентов | draft | high | ai-agent |
| DOC-030 | 30_MVP_IMPLEMENTATION_PLAN.md | Технический план реализации MVP | draft | high | developer, architect |

Статусы: `draft` — черновик, `review` — на рецензии, `approved` — утверждён, `planned` — файл ещё не создан (расширение манифеста; паспорты файлов используют только draft/review/approved).

## Быстрые ссылки по задачам

| Задача | Читать |
|---|---|
| Разработка backend | DOC-005, DOC-006, DOC-007 |
| Разработка widget | DOC-008, DOC-010 (+ DOC-007) |
| WordPress-плагин | DOC-009 (+ DOC-010) |
| Интеграция нового сайта (чистый код) | DOC-010, DOC-024 |
| Настройка AI под нишу | DOC-011, DOC-012, DOC-014 |
| Панель оператора | DOC-013, DOC-021 |
| Deployment / установка | DOC-016, DOC-017 |
| Безопасность | DOC-015 |
| Тестирование | DOC-018, DOC-023 |
| База данных | DOC-006 |
| API-интеграция | DOC-007, DOC-005 |
| Обновление установленной системы | DOC-020, DOC-016 |
| Архитектура, добавление новой CMS/платформы | DOC-003, DOC-004, DOC-026 |
| Планирование и реализация MVP | DOC-030, DOC-025 |

## Список файлов документации

```text
docs/
├── INDEX.md                     (DOC-INDEX)
├── AI_NAVIGATION.md             (DOC-NAV)
├── DOCUMENTATION_MAP.md         (DOC-MAP)
├── documentation.manifest.json  (DOC-MNF)
├── 01_PROJECT_OVERVIEW.md       (DOC-001)
├── 02_BUSINESS_REQUIREMENTS.md  (DOC-002)
├── 03_SYSTEM_ARCHITECTURE.md    (DOC-003)
├── 04_FOLDER_STRUCTURE.md       (DOC-004)
├── 05_BACKEND.md                (DOC-005)
├── 06_DATABASE.md               (DOC-006)
├── 07_API.md                    (DOC-007)
├── 08_WIDGET.md                 (DOC-008)
├── 09_WORDPRESS_PLUGIN.md       (DOC-009)
├── 10_UNIVERSAL_INTEGRATION.md  (DOC-010)
├── 11_AI_MODULE.md              (DOC-011)
├── 12_KNOWLEDGE_BASE.md         (DOC-012)
├── 13_OPERATOR_PANEL.md         (DOC-013)
├── 14_ESCALATION_RULES.md       (DOC-014)
├── 15_SECURITY.md               (DOC-015)
├── 16_DEPLOYMENT.md             (DOC-016)
├── 17_CONFIGURATION.md          (DOC-017)
├── 18_TESTING.md                (DOC-018)
├── 19_LOGGING_MONITORING.md     (DOC-019)
├── 20_UPDATES_MIGRATIONS.md     (DOC-020)
├── 21_USER_GUIDE.md             (DOC-021)
├── 22_ADMIN_GUIDE.md            (DOC-022)
├── 23_DEVELOPER_GUIDE.md        (DOC-023)
├── 24_INTEGRATOR_GUIDE.md       (DOC-024)
├── 25_ROADMAP.md                (DOC-025)
├── 26_ARCHITECTURE_DECISIONS.md (DOC-026)
├── 27_FAQ.md                    (DOC-027)
├── 28_GLOSSARY.md               (DOC-028)
├── 29_AI_AGENT_RULES.md         (DOC-029)
└── 30_MVP_IMPLEMENTATION_PLAN.md (DOC-030)
```

## Примечания

- `docs/ARCHITECTURE.md` — исторический Architecture Design Document v1.0 (2026-08-15), утверждённый заказчиком и послуживший основой модульной документации; свёрнут в redirect-заглушку. Его содержимое полностью разложено по разделам (DOC-003, DOC-005…DOC-020, DOC-026). Источник истины — модульная документация.
- Открытые вопросы проекта собираются в DOC-002 (раздел «Открытые вопросы»).
