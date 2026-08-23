-- Реаудит RA-API-6: уникальность версии источника закрывает гонку повторного
-- reindex — два параллельных прогона вычисляли одинаковый version+1 и оба
-- вставляли полный корпус (дубли закреплялись навсегда, т.к. delete < version
-- ничего не удалял). Теперь второй параллельный insert падает по 23505.
-- Плюс транзакционность swap в knowledge.repos.ts.

-- Чистка возможных исторических дублей (оставляем одну строку на ключ;
-- сравнение по паре created_at,id — у батчевой вставки created_at совпадает)
DELETE FROM chunks a
USING chunks b
WHERE a.source_document_id IS NOT NULL
  AND a.source_document_id = b.source_document_id
  AND a.source_version = b.source_version
  AND a.id <> b.id
  AND (b.created_at, b.id) > (a.created_at, a.id);

DELETE FROM chunks a
USING chunks b
WHERE a.source_faq_id IS NOT NULL
  AND a.source_faq_id = b.source_faq_id
  AND a.source_version = b.source_version
  AND a.id <> b.id
  AND (b.created_at, b.id) > (a.created_at, a.id);

CREATE UNIQUE INDEX chunks_doc_source_version_idx
    ON chunks (source_document_id, source_version)
    WHERE source_document_id IS NOT NULL;

CREATE UNIQUE INDEX chunks_faq_source_version_idx
    ON chunks (source_faq_id, source_version)
    WHERE source_faq_id IS NOT NULL;
