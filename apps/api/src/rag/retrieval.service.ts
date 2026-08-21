/**
 * Гибридный retrieval (docs/12 §4): векторная нога (HNSW) + полнотекстовая
 * (tsvector) → RRF-фьюжн в JS (fuseByRrf из core) → retrieval-гейт
 * (макс. косинус фьюжн-топа ≥ порога ассистента).
 */
import { Inject, Injectable } from "@nestjs/common";
import { fuseByRrf, type RetrievedChunk } from "@uni-chat/core";
import type { Pool } from "pg";
import { PG } from "../db/db.module";
import { AiProviderService } from "../ai/ai-provider.service";

const CANDIDATES_PER_LEG = 20;

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

    const [vector] = await (await this.providers.embedding()).embed([query]);
    const vectorLiteral = `[${vector!.join(",")}]`;

    // Нога 1: векторный топ
    const { rows: vecRows } = await this.db.query<{ id: string }>(
      `select id from chunks
       where project_id = $1
       order by embedding <=> $2::vector
       limit ${CANDIDATES_PER_LEG}`,
      [projectId, vectorLiteral],
    );
    const vectorRanked = vecRows.map((r) => r.id);

    // Нога 2: полнотекстовый топ ('simple'; ru/en stemming — D-2, docs/06 §5)
    const { rows: ftsRows } = await this.db.query<{ id: string }>(
      `select id from chunks, websearch_to_tsquery('simple', $2) q
       where project_id = $1 and tsv @@ q
       order by ts_rank(tsv, q) desc
       limit ${CANDIDATES_PER_LEG}`,
      [projectId, query],
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
    // ВАЖНО: $1 обязателен в тексте — неиспользуемый параметр даёт
    // «could not determine data type of parameter $1» (pg_analyze_and_rewrite_varparams)
    const { rows: chunkRows } = await this.db.query<ChunkRow & { cosine: string }>(
      `select id, source_document_id, source_faq_id, content, metadata,
              (1 - (embedding <=> $3::vector)) as cosine
       from chunks
       where project_id = $1 and id = any($2::uuid[])
       order by embedding <=> $3::vector`,
      [projectId, topIds, vectorLiteral],
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
