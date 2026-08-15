---
id: DOC-005
title: Backend (NestJS)
project: Universal Chat — Self-Hosted AI Chat Platform
version: 0.1.0
status: draft
audience: developer
priority: high
summary: Серверная часть: процессы api и worker из одного образа, модули, Conversation Engine (оркестрация AI-хода), Escalation Engine (детерминированные правила), очереди BullMQ, стриминг LLM, обработка ошибок. Примеры псевдокода.
when_to_read: При разработке серверной логики, API-обработчиков, realtime, фоновых задач.
when_not_to_read: При работе только с виджетом (DOC-008) или плагином WP (DOC-009) без изменения серверного контракта; за схемой данных — DOC-006.
keywords: backend, nestjs, модули, conversation engine, escalation, bullmq, воркеры, стриминг, очереди, транзакции
related:
  - DOC-003
  - DOC-006
  - DOC-007
  - DOC-011
  - DOC-019
---

# Backend (NestJS)

## Краткое содержание

- Процессы и runtime.
- Модули и их границы.
- Conversation Engine — сердце системы.
- Escalation Engine.
- Очереди и воркеры.
- Стриминг LLM.
- Транзакции, seq, идемпотентность.
- Обработка ошибок.

Код в этом документе — **псевдокод для спецификации поведения**, не финальная реализация.

## 1. Процессы и runtime

**Node.js 20 LTS, NestJS 10, TypeScript.** Один Docker-образ `chat-platform` → два процесса:

| Процесс | Entrypoint | Отвечает | Лимит (compose) |
|---|---|---|---|
| api | `node dist/main.js` | REST, Socket.IO, статика (admin SPA, widget.js), запуск миграций | 512 MB |
| worker | `node dist/worker.js` | Потребители BullMQ: парсинг, эмбеддинги, таймеры, бэкапы | 1 GB |

Разделение причинено изоляцией CPU-bound задач (парсинг PDF, батчи эмбеддингов) от latency-критичного API (ADR-010). Оба процесса используют один код ядра `packages/core`.

## 2. Модули

Список модулей и их границы — DOC-003 §4 (источник истины). Правила внутри:

- Модули общаются только через публичные API сервисов (DI). **Прямой доступ к чужим репозиториям запрещён.**
- Каждый модуль: `*.module.ts`, `*.controller.ts` (REST), `*.service.ts` (логика), `__tests__/`.
- Транзакции — Unit of Work (одна транзакция = один use case).

Структура на примере conversations:

```text
apps/api/src/modules/conversations/
├── conversations.module.ts
├── conversations.controller.ts        # REST: список, назначение, закрытие...
├── conversations.service.ts
├── conversation-engine.service.ts     # оркестрация AI-хода (раздел 3)
└── __tests__/
```

## 3. Conversation Engine

Оркестрирует жизненный цикл диалога. Строгий порядок операций:

```text
1. Валидация (visitor token, rate limit, origin, размер)
2. ПЕРСИСТЕНТНОСТЬ: INSERT message (seq = last_seq + 1, в транзакции)
3. Пуш в комнату диалога (Socket.IO)
4. Если state = AI_ACTIVE → AI-ход (ниже)
5. Иначе (WAITING_OPERATOR / OPERATOR_ACTIVE) → AI молчит
```

**Почему «сначала запись, потом пуш»:** гарантия отсутствия потерь и порядка — любой клиент после reconnect догоняет пропущенное через `GET /messages?after_seq=N` (NFR, DOC-007).

Псевдокод AI-хода:

```typescript
async onVisitorMessage(conversationId: UUID, text: string) {
  const msg = await messages.create({ conversationId, role: 'visitor', content: text });
  await realtime.emitToConversation(conversationId, 'message', msg);

  const conversation = await conversations.get(conversationId);
  if (conversation.state !== 'AI_ACTIVE') return;              // AI молчит

  const assistant = await assistants.ofProject(conversation.projectId);
  const history    = await messages.last(conversationId, assistant.retrieval.historyDepth);

  const context = await rag.retrieve(conversation.projectId, text, { history });

  // Retrieval-гейт: LLM не вызывается, если знания нерелевантны
  if (context.bestScore < assistant.retrieval.scoreThreshold) {
    return this.fallback(conversation, assistant);             // фраза + правила эскалации
  }

  const stream = await llm.chatStream(promptBuilder.build(assistant, context, history));
  for await (const token of stream.tokens) {
    await realtime.emitToConversation(conversationId, 'ai_token', { token });
  }
  // stream.final — провалидированный structured output (схема в DOC-011)

  const aiMsg = await messages.create({
    conversationId, role: 'assistant',
    content:    stream.final.answer,
    citations:  context.citationsFor(stream.final.citations),
    confidence: stream.final.confidence,
  });
  await realtime.emitToConversation(conversationId, 'message', aiMsg);

  await escalation.evaluate(conversation, stream.final);       // раздел 4
}
```

Выдача `seq` без гонок — атомарным UPDATE:

```sql
UPDATE conversations SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq;
```

## 4. Escalation Engine

Принцип: **решения принимает код, LLM лишь поставляет сигналы** (ADR-011). После каждого AI-хода LLM возвращает structured output:

```json
{
  "answer": "Да, доставка курьером по городу — 1–2 дня, 500 ₽...",
  "confidence": 0.86,
  "user_intent_flags": { "wants_human": false, "complaint": false },
  "detected_intent": "delivery_question"
}
```

Сервер валидирует схему и границы значений, затем RulesEngine детерминированно матчит упорядоченный по `priority` список правил ассистента:

| Тип правила | Сигнал | Действие |
|---|---|---|
| `explicit_request` | флаг `wants_human` | handoff |
| `low_confidence` | `confidence < порога` | handoff или fallback-фраза |
| `keyword` | regex-список («жалоба», «скандал»...) | handoff |
| `intent` | `detected_intent == имя` | handoff |
| `complaint` | флаг `complaint` | handoff |

При срабатывании: прощальная фраза AI → запись `handoffs` → `state = WAITING_OPERATOR` → уведомление операторам (WS; email, если никто не принял за N минут). Настройка правил без программирования — DOC-014 (источник истины по правилам).

## 5. Очереди и воркеры (BullMQ / Redis)

| Очередь | Джобы | Ретраи | Примечания |
|---|---|---|---|
| `ingest` | parse-document, fetch-url | 3, экспоненциально | статус документа: pending → parsing → indexing → ready/failed |
| `embeddings` | embed-chunks (батч 64) | 5 | ретрай всего батча |
| `timers` | waiting-timeout, inactivity-close, reopen-check | без ретраев | отложенные (delayed) джобы |
| `maintenance` | backup, retention-cleanup | 1 + алерт | запуск по cron-расписанию |

Правила:

- Джобы идемпотентны (jourId = идентификатор сущности + версия; повторный прогон безопасен).
- Тяжёлый парсинг выполняет только worker; **запрещено** в api-процессе (блокировка event loop).
- Ошибка джобы не роняет процесс: изоляция на уровне job, алерт в логи (DOC-019).

## 6. Стриминг LLM

- Провайдер отдаёт токены как async iterator (контракт `LlmProvider.chatStream` — DOC-011).
- Токены летят в комнату как `ai_token` без записи в БД.
- Финальное сообщение (после structured output) персистится одним INSERT и рассылается как обычное `message` — кэтч-ап после reconnect консистентен.
- Прерывание: если посетитель ушёл/закрыл диалог — стрим отменяется (AbortController), незавершённый ответ не сохраняется как финальный.

## 7. Идемпотентность и конкурентность

| Механизм | Где |
|---|---|
| `Idempotency-Key` на POST сообщений виджета | дедупликация при ретраях клиента |
| `UNIQUE(conversation_id, seq)` | порядок сообщений |
| Advisory lock при миграциях | один применяющий (DOC-020) |
| Optimistic-конкурентность на `conversations.state` | переход состояния валидируется (незаконный → 409) |

## 8. Обработка ошибок

Категории и поведение:

| Категория | Пример | Поведение |
|---|---|---|
| Ошибка клиента | 400/401/403/404/409/422/429 | машиночитаемый JSON (коды в DOC-007) |
| Ошибка провайдера AI | timeout, 5xx, rate limit | 1 ретрай → сообщение посетителю «техническая проблема» + пометка в events; без молчания |
| Ошибка воркера | парсинг не удался | статус документа failed + текст ошибки в админке |
| Внутренняя | исключение | 500 с request-id; лог с контекстом (DOC-019) |

Секреты в логи не пишутся (redaction) — DOC-019.

## Чек-лист добавления новой серверной функции

- [ ] Контракт (DTO/событие) добавлен в `packages/shared` ДО реализации.
- [ ] Логика — в сервисе/`packages/core`, не в контроллере.
- [ ] Транзакция охватывает все записи use case.
- [ ] Тяжёлые вычисления — в очередь (worker), не в api-процесс.
- [ ] Ошибки возвращаются кодом из единого реестра (DOC-007).
- [ ] Обновлён контракт в DOC-007, если изменился API.

## Частые ошибки

- **Рассылка WS до записи в БД** — нарушение порядка «персистентность → пуш».
- **Вызов LLM без retrieval-гейта** — деньги и галлюцинации.
- **Парсинг/эмбеддинги в api-процессе** — блокировка event loop у всех посетителей.
- **Решение об эскалации по тексту ответа LLM** — только детерминированный RulesEngine по сигналам.
- **Обращение к репозиторию чужого модуля** — только через публичный сервис.

## Связанные разделы

- Модули и слои — DOC-003
- Схема данных — DOC-006
- Контракты API и события — DOC-007
- AI-модуль и guardrails — DOC-011
- Логирование — DOC-019
