---
id: DOC-015
title: Безопасность
project: Universal Chat — Self-Hosted AI Chat Platform
version: 0.1.0
status: draft
audience: developer, architect
priority: high
summary: Модель аутентификации и RBAC, изоляция зон и данных арендаторов, реестр угроз и митигаций (XSS, CSRF, SQLi, SSRF, загрузки, prompt injection, brute force, секреты), аудит и приватность посетителей (GDPR).
when_to_read: Перед любым изменением, затрагивающим ввод пользователя, файлы, сеть, секреты, авторизацию; при разборе инцидентов.
when_not_to_read: При контентных правках без затрагивания перечисленного.
keywords: безопасность, аутентификация, rbac, xss, csrf, ssrf, rate limit, секреты, шифрование, prompt injection, аудит, gdpr, приватность
related:
  - DOC-007
  - DOC-011
  - DOC-012
  - DOC-016
  - DOC-017
---

# Безопасность

## Краткое содержание

- Аутентификация и RBAC.
- Изоляция зон и арендаторов.
- Реестр угроз → митигации.
- Секреты и шифрование.
- Аудит, приватность, GDPR.

## 1. Аутентификация

| Зона | Субъект | Механизм |
|---|---|---|
| `/api/v1` + Admin Panel | администраторы, операторы | email+пароль (argon2id) → **httpOnly, Secure, SameSite=Lax cookie**: access-JWT 15 мин + refresh 7 дней (ротация, revocation-лист в Redis) |
| `/widget/v1` + Socket.IO `/widget` | посетитель сайта | publishable key при init → **visitor JWT** (HMAC, 24 ч, клеймы visitor_id/site_id/project_id); полномочия — только «свои диалоги своего сайта» |
| Socket.IO `/admin` | панель | тот же cookie-JWT в handshake |

Запрещено: JWT админки в localStorage; visitor-токен, выставляемый сервером как cookie; доступ посетителя к `/api/v1` (зоны разведены на уровне роутинга).

Вход: throttling 5 попыток/15 мин на IP+аккаунт с прогрессивной блокировкой (`LOGIN_LOCKED`), generic-тексты ошибок. 2FA (TOTP) — V2.

## 2. RBAC и изоляция

```text
Installation roles:  owner, admin
Project roles:       project_admin, operator
```

- Owner: вся установка (проекты, команда, настройки).
- Project admin: свой проект (сайты, AI, знания, операторы).
- Operator: только диалоги своих проектов (inbox).

Двойной слой: guard'ы на роутах + проверка project-scope в сервисах. Изоляция данных: `project_id` в каждом запросе (DOC-006 §6); чужой проект → `403 FORBIDDEN_PROJECT`. V2 hardening: Postgres RLS.

Посетитель не может получить: админку, чужие conversations (visitor_id в токене проверяется в сервисе сообщений), Knowledge Base, AI-настройки, `/api/v1`.

## 3. Реестр угроз и митигаций

| Угроза | Митигация |
|---|---|
| **XSS** | Весь HTML (виджет и админка) — markdown → **DOMPurify** (allowlist); никаких `innerHTML` с сырыми данными; CSP `default-src 'self'`; ссылки `rel="noopener nofollow"` + протокол-allowlist |
| **CSRF** | Cookie SameSite=Lax + double-submit token на мутациях; WS handshake проверяет Origin |
| **SQL injection** | Только параметризованные запросы (ORM/билдер); конкатенация запрещена линт-правилом |
| **SSRF (URL-ингестия)** | Схемы http/https; DNS-resolve → блок приватных CIDR (RFC1918, link-local, `169.254.169.254`); редиректы ≤3 с ревалидацией; лимит размера/таймауты; fetch только в worker |
| **File uploads** | Белый список типов; magic bytes (не расширение); лимит 25 МБ (настраивается); zip-bomb ratio-check; парсинг в worker-контейнере с CPU/RAM-лимитами и таймаутом, без сети |
| **Malicious documents / prompt injection** | Документ — данные в делимитерах; у AI нет инструментов (MVP); серверная валидация structured output; детерминированный RulesEngine (DOC-011 §6) |
| **API abuse / rate limiting** | Redis token-bucket: виджет (messages/min на visitor, conversations/hour), init на IP, upload на проект (лимиты — DOC-007 §6) |
| **Brute force** | Throttling логина, задержки, generic-ошибки |
| **Секреты** | AI/SMTP-ключи — AES-256-GCM в БД; ключ — `APP_SECRET` из .env; редакция в логах; маскировка в UI |
| **Transport** | TLS везде (Caddy, авто-HTTPS), HSTS |
| **Заголовки** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (админка), `Referrer-Policy` |
| **Идемпотентность/повторы** | Idempotency-Key; `429` с `retry_after_s` |

## 4. Секреты и шифрование

- `.env`: `APP_SECRET` (ключ шифрования секретов БД), пароли БД — генерирует installer, права 600 (DOC-017).
- Значения настроек с флагом secret (API-ключи провайдера, SMTP) шифруются приложением перед записью в `settings`.
- Ротация `APP_SECRET` — служебная операция с re-encrypt джобой (DOC-017 §5). Потеря `APP_SECRET` = потеря расшифровки секретов (в бэкап не входит — хранится отдельно).

## 5. Аудит

Append-only таблица `events`: логины/логауты, смены настроек, regen ключей, handoff'ы, действия операторов, ошибки доступа (401/403), запуск/ошибки бэкапов. Записи только добавляются; экспорт — админка.

## 6. Приватность посетителей (GDPR-friendly)

- Данные посетителей — только в БД заказчика; виджету достаточно анонимного `anon_id`.
- `identify()` — добровольная передача имени/email.
- Экспорт диалога и удаление (visitor → все его диалоги) — функции админки (MVP).
- Retention-политика проекта (автоочистка по возрасту) — V2.
- При локальном LLM (Ollama) данные не покидают сервер; при внешнем провайдере — уходят вопрос и контекст (см. DOC-011 §9), указывать в privacy-заметке сайта.

## Чек-лист безопасности изменения

- [ ] Новый ввод пользователя санитизирован/валидирован (схема zod)?
- [ ] Новый мутирующий роут: CSRF-токен + rate limit?
- [ ] Новые файлы/URL: валидация из раздела 3?
- [ ] Новые внешние запросы: не вводят обязательную зависимость; SSRF-правила?
- [ ] Секреты не в логах/ответах API/UI?
- [ ] Зафиксирован ли новый домен угрозы в этом реестре?

## Частые ошибки

- **«Спрячем admin-API за нестандартным путём»** — не защита; зоны и авторизация по DOC-007.
- **Кастомный рендер markdown в обход санитайзера** — прямой XSS.
- **Проверка прав только на роуте** — дублировать project-scope в сервисе.
- **Хранение `APP_SECRET` в бэкапе СУБД** — он только в `.env` на сервере.

## Связанные разделы

- Контракты API и лимиты — DOC-007
- Prompt injection — DOC-011 §6
- Загрузка файлов/URL — DOC-012
- Шифрование секретов — DOC-017
- Аудит и логи — DOC-019
