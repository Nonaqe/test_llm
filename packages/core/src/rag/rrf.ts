/**
 * RRF-фьюжн двух ранжированных списков (docs/06 §5, docs/12 §4).
 * Чистая функция — детерминирована и тестируема.
 */
export interface RetrievedChunk {
  chunkId: string;
  sourceDocumentId: string | null;
  sourceFaqId: string | null;
  content: string;
  metadata: Record<string, unknown>;
  /** Косинусная близость к запросу (для retrieval-гейта) */
  cosine: number;
  /** Итоговый RRF-скор после слияния */
  rrfScore: number;
}

export const RRF_K = 60;

/**
 * Reciprocal Rank Fusion: score = Σ 1/(k + rank).
 * Списки — идентификаторы чанков по убыванию релевантности.
 */
export function fuseByRrf(
  vectorRanked: readonly string[],
  ftsRanked: readonly string[],
  k: number = RRF_K,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const [rankStr, id] of vectorRanked.entries()) {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rankStr + 1));
  }
  for (const [rankStr, id] of ftsRanked.entries()) {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rankStr + 1));
  }
  return scores;
}
