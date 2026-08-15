---
id: DOC-007
title: API (REST + Socket.IO)
project: Universal Chat — Self-Hosted AI Chat Platform
version: 0.1.0
status: draft
audience: developer, integrator
priority: high
summary: Контракты API: публичная зона виджета /widget/v1, приватная зона /api/v1, события Socket.IO (namespace /widget и /admin), аутентификация запросов, форматы ошибок, rate limits, версионирование. Примеры запросов и ответов.
when_to_read: При разработке любого клиента API (widget, admin, интеграции) или серверного обработчика; при отладке обмена клиент-сервер.
when_not_to_read: При настройке системы через админку без программирования; за внутренним устройством сервера — DOC-005.
keywords: api, rest, socket.io, websocket, endpoints, события, аутентификация, ошибки, rate limit, версионирование
related:
  - DOC-005
  - DOC-008
  - DOC-010
  - DOC-015
---

# API (REST + Socket.IO)

## Краткое содержание

- Принципы и форматы.
- Публичный API виджета (`/widget/v1`) + примеры.
- Приватный API админки (`/api/v1`).
- События Socket.IO.
- Формат ошибок и коды.
- Rate limits.
- Версионирование.

Контракт — проектный (implementation TBD); до реализации считается спецификацией к выполнению.

## 1. Принципы

- Две изолированные зоны: **`/widget/v1`** (посетители, publishable key + visitor JWT) и **`/api/v1`** (админка, cookie-session). Зоны не пересекаются на уровне роутинга и авторизации.
- Конверт: успех `{ "data": ... }`, ошибка `{ "error": { "code", "message", "details" } }`.
- Идентификаторы UUIDv7; пагинация курсорная (`?cursor=&limit=`).
- `Idempotency-Key` (заголовок) обязателен на мутирующих POST виджета.
- Все тексты ошибок локализованы по `Accept-Language` (ru/en).

## 2. Публичный API виджета (`/widget/v1`)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/widget/v1/health` | Статус сервера (WP-плагин, мониторинг) |
| POST | `/widget/v1/init` | Инициализация: `{key, origin, anon_id, attributes?}` → visitor token + конфиг виджета + открытый диалог (если есть) |
| POST | `/widget/v1/conversations` | Создать диалог посетителя |
| GET | `/widget/v1/conversations/:id` | Состояние диалога (синхронизация клиента) |
| GET | `/widget/v1/conversations/:id/messages?after_seq=N` | Кэтч-ап после reconnect |
| POST | `/widget/v1/conversations/:id/messages` | Сообщение посетителя (Idempotency-Key) |
| POST | `/widget/v1/conversations/:id/handoff` | Явная просьба «позвать человека» |
| POST | `/widget/v1/conversations/:id/leave-email` | Офлайн-заявка (email lead) — Фаза 4 |

### 2.1 Пример: инициализация

```http
POST /widget/v1/init
Content-Type: application/json

{ "key": "pk_live_9f3a...", "origin": "https://site-a.com" }
```

```json
{
  "data": {
    "visitor_token": "eyJhbGciOi...", 
    "widget": {
      "locale": "ru",
      "theme": { "accent": "#4f46e5", "position": "right" },
      "greeting": "Здравствуйте! Чем помочь?"
    },
    "conversation": null
  }
}
```

`visitor_token` — JWT (HMAC, 24 ч): клеймы `visitor_id`, `site_id`, `project_id`. Полномочия — только «писать в свои диалоги этого сайта». Ошибка при origin вне `allowed_origins` сайта: `INVALID_ORIGIN`.

### 2.2 Пример: отправка сообщения

```http
POST /widget/v1/conversations/0192a1b2-.../messages
Authorization: Bearer <visitor_token>
Idempotency-Key: 3f2c8a...
Content-Type: application/json

{ "text": "Сколько стоит доставка в Киев?" }
```

```json
{
  "data": {
    "id": "0192a1c4-...",
    "seq": 12,
    "role": "visitor",
    "created_at": "2026-08-15T12:00:00Z"
  }
}
```

Ответ AI доставляется **по Socket.IO** (события `ai_token` → `message`), не в HTTP-ответе.

### 2.3 Пример: офлайн-заявка

```http
POST /widget/v1/conversations/0192a1b2-.../leave-email
Authorization: Bearer <visitor_token>

{ "email": "client@example.com", "name": "Иван" }
```

→ `201`, заявка фиксируется в диалоге и `events`.

## 3. Приватный API админки (`/api/v1`)

Аутентификация: httpOnly-cookie (access 15 мин + refresh 7 дней с ротацией) — детали в DOC-015/DOC-018 ADD→раздел Auth (источник истины — DOC-015).

| Группа | Endpoint'ы |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh`, `GET /auth/me` |
| Проекты | `GET/POST/PATCH /projects`; `GET/POST/PATCH /projects/:id/members` |
| Сайты | `GET/POST/PATCH /projects/:id/sites` (+ regen ключа: `POST /sites/:id/regen-key`) |
| Ассистент | `GET/POST/PATCH /projects/:id/assistants`; `PUT /projects/:id/assistants/:aid/rules` |
| Знания | `POST /projects/:id/knowledge/documents` (multipart), `POST /projects/:id/knowledge/urls`, `GET/POST/PATCH/DELETE /projects/:id/knowledge/faqs`, `POST /knowledge/documents/:id/reindex`, `DELETE /knowledge/documents/:id` |
| Диалоги | `GET /projects/:id/conversations?state=&site=&cursor=`, `GET /conversations/:id`, `POST /conversations/:id/assign|close|reopen|return-to-ai`, `POST /conversations/:id/messages` |
| Очередь | `GET /handoffs?status=pending` |
| Аналитика | `GET /projects/:id/analytics/overview` |
| Команда | `GET/POST /users` |
| Настройки | `GET/PATCH /settings` (AI provider, SMTP, бэкапы) |

### 3.1 Пример: вход

```http
POST /api/v1/auth/login
Content-Type: application/json

{ "email": "admin@example.com", "password": "..." }
```

```http
200 OK
Set-Cookie: session=...; HttpOnly; Secure; SameSite=Lax
```

```json
{ "data": { "user": { "id": "0191...", "email": "admin@example.com",
                      "installation_role": "owner" } } }
```

### 3.2 Пример: возврат чата AI

```http
POST /api/v1/conversations/0192a1b2-.../return-to-ai
```

```json
{ "data": { "id": "0192a1b2-...", "state": "AI_ACTIVE" } }
```

Незаконный переход (например `return-to-ai` из `CLOSED`) → `409 INVALID_STATE_TRANSITION`.

## 4. Socket.IO

Единый транспорт realtime для виджета и панели (ADR-003). Сообщения **отправляются** через REST (персистентность + идемпотентность), Socket.IO используется для **пуша** и лёгких событий (typing). Подключение: JWT в handshake (`auth.token`); комнаты по правам.

### 4.1 Namespace `/widget`

**Клиент → сервер:**

| Событие | Payload | Notes |
|---|---|---|
| `widget:join` | `{ conversation_id }` | вход в комнату диалога |
| `widget:typing:start` / `stop` | `{ conversation_id }` | TTL 5 с на сервере |

**Сервер → клиент:**

| Событие | Payload | Notes |
|---|---|---|
| `message` | полное сообщение (`id, seq, role, content, citations, confidence, created_at`) | после персистентности |
| `ai_token` | `{ token }` | частичный токен стрима (не персистится) |
| `conversation:state` | `{ state, handoff? }` | например WAITING_OPERATOR |
| `operator:typing` | `{}` | |
| `presence:operators` | `{ online: bool }` | |

### 4.2 Namespace `/admin`

**Клиент → сервер:** `admin:subscribe_conversation {id}`, `admin:subscribe_project {id}`, `admin:typing {conversation_id}`, `admin:unsubscribe_*`.

**Сервер → клиент:** `conversation:created`, `conversation:state_changed`, `message`, `handoff:created`, `queue:updated`, `operator:presence`.

### 4.3 Reconnect и кэтч-ап

1. Socket.IO авто-reconnect (экспоненциальная пауза).
2. После reconnect: `GET /widget/v1/conversations/:id/messages?after_seq=<последний seq>` — добор пропущенного.
3. Стриминг `ai_token` не восстанавливается — догоняется финальным `message`.

## 5. Формат ошибок и коды

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Слишком много сообщений. Подождите немного.",
    "details": { "retry_after_s": 30 }
  }
}
```

Реестр кодов (начальный состав, расширяется):

| Код | HTTP | Зона |
|---|---|---|
| `INVALID_ORIGIN` | 403 | widget: origin вне allowlist |
| `VISITOR_TOKEN_INVALID` | 401 | widget |
| `RATE_LIMITED` | 429 | обе |
| `CONVERSATION_NOT_FOUND` | 404 | widget/admin |
| `FORBIDDEN_PROJECT` | 403 | admin: чужой проект |
| `INVALID_STATE_TRANSITION` | 409 | admin |
| `IDEMPOTENCY_CONFLICT` | 409 | повторный ключ с другим телом |
| `VALIDATION_FAILED` | 422 | обе |
| `LOGIN_LOCKED` | 429 | auth: brute-force защита |

## 6. Rate limits (Redis token-bucket)

| Цель | Лимит |
|---|---|
| `POST /widget/v1/init` | 30/мин на IP |
| `POST .../messages` (widget) | 10/мин на visitor, 30/мин на IP |
| `POST .../handoff` | 3/мин на visitor |
| `POST /api/v1/auth/login` | 5/15 мин на IP+аккаунт (прогрессивная блокировка) |
| Upload документов | 10/час на проект |

Превышение → `429 RATE_LIMITED` + `retry_after_s`.

## 7. Версионирование и совместимость

- `/widget/v1` и `/api/v1` — замороженные мажорные контракты (Integration Contract, DOC-003 §5).
- Breaking-изменения — только в новом мажоре (`/v2`) с периодом сосуществования; заголовок `Sunset` при deprecation.
- Расширения (новые необязательные поля, события) — без смены мажора; клиенты обязаны игнорировать неизвестные поля.
- События Socket.IO типизированы в `packages/shared` — источник для клиентов.

## Чек-лист добавления endpoint'а

- [ ] Контракт (типы запроса/ответа) в `packages/shared`.
- [ ] Зона выбрана верно (widget-данные никогда не в `/api/v1` и наоборот).
- [ ] Код ошибки добавлен в реестр раздела 5.
- [ ] Rate limit определён для мутирующего роута.
- [ ] Документ обновлён (таблицы этого файла).

## Частые ошибки

- **Ответ AI ждут в HTTP-ответе POST /messages** — нет, стрим идёт по Socket.IO (`ai_token` → `message`).
- **Обход after_seq после reconnect** — пропущенные сообщения.
- **Отсутствие Idempotency-Key** — дубли сообщений при ретраях мобильных сетей.
- **Хранение visitor JWT в куке сайта** — токен живёт в памяти/localStorage виджета, не ставится сервером как cookie.
- **Публичный вызов `/api/v1` из виджета** — зоны изолированы; у посетителя нет доступа к админ-API.

## Связанные разделы

- Backend и порядок операций — DOC-005
- Виджет (клиент API) — DOC-008
- Универсальная интеграция — DOC-010
- Аутентификация и RBAC — DOC-015
