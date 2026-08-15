# SELL_CHAT_LLM — Universal Self-Hosted AI Chat Platform

Self-hosted система AI-чата для сайтов: **WordPress** и сайты на чистом **HTML/PHP/JS**.

AI-консультант на знаниях компании (RAG + цитаты) + передача диалога живому оператору.
Всё разворачивается на сервере заказчика (Docker Compose), данные и AI-ключи остаются у заказчика.

## Статус

- Архитектура спроектирована и утверждена (ADD v1.0, 2026-08-15).
- Создана полная модульная документация (33 документа).
- Реализация кода не начата.

## Документация

| Что | Где |
|---|---|
| Вход в документацию | [`docs/INDEX.md`](docs/INDEX.md) |
| Навигация для ИИ-агентов | [`docs/AI_NAVIGATION.md`](docs/AI_NAVIGATION.md) |
| Карта документации | [`docs/DOCUMENTATION_MAP.md`](docs/DOCUMENTATION_MAP.md) |
| Машинный манифест | [`docs/documentation.manifest.json`](docs/documentation.manifest.json) |
| Архитектура | [`docs/03_SYSTEM_ARCHITECTURE.md`](docs/03_SYSTEM_ARCHITECTURE.md) |
| Решения (ADR) | [`docs/26_ARCHITECTURE_DECISIONS.md`](docs/26_ARCHITECTURE_DECISIONS.md) |
| Roadmap | [`docs/25_ROADMAP.md`](docs/25_ROADMAP.md) |

Правила работы с документацией (для людей и ИИ-агентов): [`docs/29_AI_AGENT_RULES.md`](docs/29_AI_AGENT_RULES.md).

## Стек (зафиксировано ADR)

TypeScript end-to-end: NestJS (modular monolith) + React/Vite admin + Preact-виджет (Shadow DOM);
PostgreSQL 16 + pgvector; Redis; Socket.IO; Docker Compose + Caddy; OpenAI-compatible AI-провайдер
(включая локальный Ollama).
