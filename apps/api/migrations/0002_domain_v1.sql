-- Фаза 1: доменная схема (docs/06_DATABASE.md §3).
-- Идентификаторы: uuid (gen_random_uuid как fallback; приложение генерирует UUIDv7).
-- Мультиарендность: project_id во всех доменных таблицах.

-- Пользователи установки (администраторы/операторы — единая таблица, роли отдельно).
-- installation_role NULL = пользователь без роли на установке (только членство в проектах)
CREATE TABLE users (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email             text NOT NULL,
    password_hash     text NOT NULL,
    name              text NOT NULL DEFAULT '',
    installation_role text CHECK (installation_role IN ('owner', 'admin')),
    is_active         boolean NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

-- Проекты (арендаторы в рамках установки)
CREATE TABLE projects (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    settings    jsonb NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Членство и роли в проектах
CREATE TABLE project_members (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    project_role  text NOT NULL CHECK (project_role IN ('project_admin', 'operator')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, project_id)
);

-- Сайты: домен, origins, publishable key, конфиг виджета (docs/08 §4)
CREATE TABLE sites (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name                text NOT NULL,
    domain              text NOT NULL,
    allowed_origins     jsonb NOT NULL DEFAULT '[]',
    widget_public_key   text NOT NULL,
    widget_config       jsonb NOT NULL DEFAULT '{}',
    is_active           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sites_widget_key_idx ON sites (widget_public_key);

-- Ассистенты (1:1 к проекту в MVP; настройки AI — структурированные поля)
CREATE TABLE assistants (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id           uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name                 text NOT NULL DEFAULT 'Консультант',
    locale               text NOT NULL DEFAULT 'ru',
    tone                 text NOT NULL DEFAULT 'professional',
    company_description  text NOT NULL DEFAULT '',
    custom_instructions  text NOT NULL DEFAULT '',
    retrieval_settings   jsonb NOT NULL DEFAULT '{"top_k": 6, "score_threshold": 0.55, "history_depth": 10}',
    safety_settings      jsonb NOT NULL DEFAULT '{"denied_topics": [], "fallback_message": ""}',
    widget_texts         jsonb NOT NULL DEFAULT '{"greeting": ""}',
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id)
);

-- Правила эскалации: строки таблицы, упорядоченные по приоритету (docs/14)
CREATE TABLE escalation_rules (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assistant_id uuid NOT NULL REFERENCES assistants (id) ON DELETE CASCADE,
    priority     integer NOT NULL CHECK (priority > 0),
    type         text NOT NULL CHECK (type IN ('explicit_request', 'low_confidence', 'keyword', 'intent', 'complaint', 'no_answer')),
    params       jsonb NOT NULL DEFAULT '{}',
    action       text NOT NULL DEFAULT 'handoff' CHECK (action IN ('handoff', 'fallback_message')),
    enabled      boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (assistant_id, priority)
);

-- Источники знаний: файлы/URL/текст (FAQ отдельно)
CREATE TABLE documents (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    source_type  text NOT NULL CHECK (source_type IN ('upload', 'url', 'text')),
    title        text NOT NULL DEFAULT '',
    mime         text,
    size_bytes   integer,
    checksum     text,
    status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'parsing', 'indexing', 'ready', 'failed')),
    error        text,
    version      integer NOT NULL DEFAULT 1,
    uploaded_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_project_status_idx ON documents (project_id, status);

-- FAQ: пары вопрос-ответ
CREATE TABLE faqs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    question    text NOT NULL,
    answer      text NOT NULL,
    enabled     boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Чанки знаний: векторы + полнотекст (гибридный поиск, docs/06 §5)
-- tsv: 'simple' как MVP-конфигурация; ru/en stemming — TBD (docs/06 §5)
CREATE TABLE chunks (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id         uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    source_document_id uuid REFERENCES documents (id) ON DELETE CASCADE,
    source_faq_id      uuid REFERENCES faqs (id) ON DELETE CASCADE,
    content            text NOT NULL,
    token_count        integer NOT NULL DEFAULT 0,
    embedding          vector(1536) NOT NULL,
    tsv                tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
    metadata           jsonb NOT NULL DEFAULT '{}',
    embedding_model    text NOT NULL,
    source_version     integer NOT NULL DEFAULT 1,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (source_document_id IS NOT NULL OR source_faq_id IS NOT NULL)
);
CREATE INDEX chunks_hnsw_idx ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX chunks_project_source_idx ON chunks (project_id, source_document_id);

-- Анонимные посетители
CREATE TABLE visitors (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    anon_id     text NOT NULL,
    attributes  jsonb NOT NULL DEFAULT '{}',
    first_seen  timestamptz NOT NULL DEFAULT now(),
    last_seen   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, anon_id)
);

-- Диалоги (state machine — docs/13 §1)
CREATE TABLE conversations (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id            uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    site_id               uuid NOT NULL REFERENCES sites (id) ON DELETE CASCADE,
    visitor_id            uuid NOT NULL REFERENCES visitors (id) ON DELETE CASCADE,
    state                 text NOT NULL DEFAULT 'NEW' CHECK (state IN ('NEW', 'AI_ACTIVE', 'WAITING_OPERATOR', 'OPERATOR_ACTIVE', 'RESOLVED', 'CLOSED')),
    assigned_operator_id  uuid REFERENCES users (id) ON DELETE SET NULL,
    last_seq              integer NOT NULL DEFAULT 0,
    context               jsonb NOT NULL DEFAULT '{}',
    last_message_at       timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_inbox_idx ON conversations (project_id, state, last_message_at DESC);

-- Сообщения: монотонный seq, уникальность — основа порядка и кэтч-апа (docs/05 §3)
CREATE TABLE messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    seq             integer NOT NULL CHECK (seq > 0),
    role            text NOT NULL CHECK (role IN ('visitor', 'assistant', 'operator', 'system', 'note')),
    content         text NOT NULL,
    citations       jsonb,
    confidence      real,
    usage           jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (conversation_id, seq)
);

-- Передачи оператору
CREATE TABLE handoffs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    reason          text NOT NULL CHECK (reason IN ('explicit_request', 'low_confidence', 'keyword', 'intent', 'complaint', 'no_answer', 'manual')),
    rule_id         uuid REFERENCES escalation_rules (id) ON DELETE SET NULL,
    requested_by    text NOT NULL CHECK (requested_by IN ('ai', 'visitor', 'operator')),
    status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'resolved', 'cancelled')),
    operator_id     uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    accepted_at     timestamptz,
    resolved_at     timestamptz
);
CREATE INDEX handoffs_queue_idx ON handoffs (status, created_at);

-- Аудит: append-only (записи только добавляются; docs/15 §5).
-- entity_id — text: идентификаторы сущностей неоднородны (uuid сущностей,
-- строковые ключи настроек)
CREATE TABLE events (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_type  text NOT NULL CHECK (actor_type IN ('user', 'system', 'visitor')),
    actor_id    uuid,
    action      text NOT NULL,
    entity_type text,
    entity_id   text,
    payload     jsonb NOT NULL DEFAULT '{}',
    ip          text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_created_idx ON events (created_at);
CREATE INDEX events_entity_idx ON events (entity_type, entity_id);

-- Настройки установки; секретные значения шифруются приложением (AES-256-GCM)
CREATE TABLE settings (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    is_secret   boolean NOT NULL DEFAULT false,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
