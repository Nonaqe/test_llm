/**
 * Гибридный retrieval (docs/12 §4): векторная нога (HNSW) + полнотекстовая
 * (tsvector) → RRF-фьюжн в JS (fuseByRrf из core) → retrieval-гейт
 * (макс. косинус фьюжн-топа ≥ порога ассистента).
 */
import { Inject, Injectable } from "@nestjs/common";
import { fuseByRrf, type RetrievedChunk } from "@uni-chat/core";
import type { Pool } from "pg";
import { PG } from "../db/db.module";
import { AiProviderService, embeddingModelTag } from "../ai/ai-provider.service";

const CANDIDATES_PER_LEG = 20;

// Живые чанки только (реаудит RA-API-4/5): документ ready, FAQ enabled,
// embedding-модель совпадает с активной — иначе «выключенный» FAQ отвечал,
// а смена модели смешивала несравнимые векторные пространства.
const LIVE_FROM = `
  from chunks c
  left join documents d on d.id = c.source_document_id
  left join faqs f on f.id = c.source_faq_id`;

const livePredicate = (modelParam: string): string => `
  c.embedding_model = ${modelParam}
  and (c.source_document_id is null or d.status = 'ready')
  and (c.source_faq_id is null or f.enabled = true)`;

interface ChunkRow {
  id: string;
  source_document_id: string | null;
  source_faq_id: string | null;
  content: string;
  metadata: Record<string, unknown>;
}

export interface RetrievalResult {
  passed: boolean;
  bestCosine: number;
  chunks: RetrievedChunk[];
}

@Injectable()
export class RetrievalService {
  constructor(
    @Inject(PG) private readonly db: Pool | null,
    private readonly providers: AiProviderService,
  ) {}

  async retrieve(
    projectId: string,
    query: string,
    opts: { topK: number; scoreThreshold: number },
  ): Promise<RetrievalResult> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");

    const provider = await this.providers.embedding();
    const modelTag = embeddingModelTag(provider);
    const [vector] = await provider.embed([query]);
    const vectorLiteral = `[${vector!.join(",")}]`;

    // Нога 1: векторный топ
    const { rows: vecRows } = await this.db.query<{ id: string }>(
      `select c.id ${LIVE_FROM}
       where c.project_id = $1::uuid and ${livePredicate("$3::text")}
       order by c.embedding <=> $2::vector
       limit ${CANDIDATES_PER_LEG}`,
      [projectId, vectorLiteral, modelTag],
    );
    const vectorRanked = vecRows.map((r) => r.id);

    // Нога 2: полнотекстовый топ ('simple'; ru/en stemming — D-2, docs/06 §5)
    const { rows: ftsRows } = await this.db.query<{ id: string }>(
      `select c.id ${LIVE_FROM}, websearch_to_tsquery('simple', $2::text) q
       where c.project_id = $1::uuid and ${livePredicate("$3::text")} and c.tsv @@ q
       order by ts_rank(c.tsv, q) desc
       limit ${CANDIDATES_PER_LEG}`,
      [projectId, query, modelTag],
    );
    const ftsRanked = ftsRows.map((r) => r.id);

    const fused = fuseByRrf(vectorRanked, ftsRanked);
    const topIds = [...fused.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, opts.topK)
      .map(([id]) => id);
    if (topIds.length === 0) {
      return { passed: false, bestCosine: 0, chunks: [] };
    }

    // Косинус фьюжн-топа — метрика гейта (док термина: гейт по близости, ранжирование по RRF)
    // ВАЖНО (PGlite): НЕИСПОЛЬЗУЕМЫЙ параметр даёт «could not determine data
    // type» — поэтому здесь ровно 4 параметра, без query из фьюжн-стадии
    const { rows: chunkRows } = await this.db.query<ChunkRow & { cosine: string }>(
      `select c.id, c.source_document_id, c.source_faq_id, c.content, c.metadata,
              (1 - (c.embedding <=> $2::vector)) as cosine
       ${LIVE_FROM}
       where c.project_id = $1::uuid and ${livePredicate("$3::text")} and c.id = any($4::uuid[])
       order by c.embedding <=> $2::vector`,
      [projectId, vectorLiteral, modelTag, topIds],
    );

    const byId = new Map(chunkRows.map((r) => [r.id, r]));
    const chunks: RetrievedChunk[] = [];
    for (const id of topIds) {
      const row = byId.get(id);
      if (!row) continue;
      chunks.push({
        chunkId: row.id,
        sourceDocumentId: row.source_document_id,
        sourceFaqId: row.source_faq_id,
        content: row.content,
        metadata: row.metadata ?? {},
        cosine: Number(row.cosine),
        rrfScore: fused.get(id) ?? 0,
      });
    }
    const bestCosine = chunks.reduce((max, c) => Math.max(max, c.cosine), 0);
    return { passed: bestCosine >= opts.scoreThreshold, bestCosine, chunks };
  }
}
