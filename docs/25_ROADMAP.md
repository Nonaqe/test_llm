---
id: DOC-025
title: Roadmap (MVP/V2/V3)
project: Universal Chat — Self-Hosted AI Chat Platform
version: 0.1.0
status: draft
audience: architect, developer
priority: medium
summary: Разграничение версий: полный обязательный состав MVP (self-hosted установка, виджет, WP-плагин, AI+RAG, операторы, handoff, аналитика), расширения V2 (провайдеры, reranker, вебхуки, память), V3 (платформы, каналы, enterprise). Критерии готовности MVP.
when_to_read: При планировании итераций и ответах «что в какой версии».
when_not_to_read: При реализации уже спланированной фичи.
keywords: roadmap, mvp, v2, v3, приоритеты, состав версий, критерии готовности
related:
  - DOC-002
  - DOC-026
---

# Roadmap (MVP / V2 / V3)

## Краткое содержание

- Принцип версионирования.
- Состав MVP (обязательный).
- V2.
- V3.
- Критерии готовности MVP.

## 1. Принцип

Первая версия делает **очень хорошо два сценария** (WordPress + чистый сайт); всё прочее — по версиям, без распыления (DOC-002 §6). Каждая фича привязана к FR/NFR из DOC-002.

## 2. MVP (обязательный состав)

| Блок | Состав |
|---|---|
| Self-hosted | Docker Compose (caddy, api, worker, postgres+pgvector, redis, backup); install.sh; визард первого запуска; SETUP-токен |
| Backend | NestJS modular monolith; REST `/widget/v1` + `/api/v1`; Socket.IO; миграции; RBAC |
| Admin Panel | логин, проекты, сайты+конструктор виджета (вкл. custom_css), ассистент (все настройки), знания (загрузка/статусы/переиндексация), команда, настройки (провайдер, SMTP, бэкапы), тестовый диалог (песочница) |
| Widget | Shadow DOM, стриминг, typing, unread, мобайл, темы, ru/en, SDK |
| Интеграции | generic web (сниппет+SDK); WordPress-плагин (настройка+вставка+health check) |
| AI | LlmProvider/EmbeddingProvider (OpenAI-compatible, вкл. Ollama); guardrails; structured output; retrieval-гейт |
| Knowledge | PDF/DOCX/TXT/CSV/MD/URL/FAQ/текст; ingest; гибридный retrieval; версии/переиндексация |
| Операторы | inbox, handoff (правила + просьба), заметки, возврат AI, офлайн-заявки, presence |
| Безопасность | раздел 19 ADD → DOC-015 полный пакет; бэкапы + restore-скрипты |
| Аналитика | обзор: диалоги, handoff rate, разрешённые AI, латентность, топ эскалаций/низкой релевантности |

## 3. V2

- AI: нативные провайдеры Anthropic, Google; пресет Ollama «из коробки» с рекомендациями моделей; reranker (кросс-энкодер); NLI-верификатор confidence; долговременная память посетителя (opt-in).
- Knowledge: OCR сканов; переобход URL по расписанию.
- Данные: структурированные товары/услуги (CSV-каталог, фильтры).
- Платформа: вебхуки (контракт уже зафиксирован); API-keys; расширенная аналитика.
- Операторы: canned replies, файловые вложения, теги, SLA-таймеры; симулятор правил эскалации.
- Widget: iframe-режим для конфликтных сайтов; мультиязычность авто.
- Безопасность: 2FA (TOTP); Postgres RLS; retention-автоочистка.

## 4. V3

- Платформы: Laravel-пакет, официальные React/Vue/Next-компоненты, Shopify-апп, прочие CMS.
- Каналы: Telegram, WhatsApp, email-to-chat.
- CRM-интеграции (двусторонние через вебхуки+API).
- Enterprise: SSO (SAML/OIDC), аудит-экспорт, HA-профиль установки, Qdrant как опция векторного хранилища.
- Advanced AI-агенты: инструменты (наличие, запись) с человеческим подтверждением.

## 5. Критерии готовности MVP (definition of done)

- [ ] Установка «с нуля до рабочего чата» на чистой VPS ≤ 30 минут по DOC-016.
- [ ] E2E-сценарии E1–E10 (DOC-018) зелёные в CI.
- [ ] Restore из бэкапа протестирован на чистой ВМ.
- [ ] WordPress-плагин проходит health check на чистой WP-установке.
- [ ] Нагрузочный профиль NFR-7 выдержан (50 диалогов, P95 первого токена ≤ 3 с).
- [ ] Все NFR DOC-002 §5 подтверждены.

## Связанные разделы

- Требования — DOC-002
- Архитектурные решения — DOC-026
