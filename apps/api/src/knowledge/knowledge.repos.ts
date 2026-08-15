/** Репозитории Knowledge Base (docs/12): documents, faqs, chunks. */
import { Inject, Injectable } from "@nestjs/common";
import { chunkText } from "@uni-chat/core";
import type { Pool } from "pg";
import { PG } from "../db/db.module";

export interface DocumentRow {
  id: string;
  project_id: string;
  source_type: "upload" | "url" | "text";
  title: string;
  mime: string | null;
  size_bytes: number | null;
  status: "pending" | "parsing" | "indexing" | "ready" | "failed";
  error: string | null;
  version: number;
}

export interface FaqRow {
  id: string;
  project_id: string;
  question: string;
  answer: string;
  enabled: boolean;
}

@Injectable()
export class DocumentsRepo {
  constructor(@Inject(PG) private readonly db: Pool | null) {}

  async insert(input: {
    projectId: string;
    sourceType: "upload" | "url" | "text";
    title: string;
    mime?: string | null;
    sizeBytes?: number | null;
    checksum?: string | null;
    uploadedBy?: string | null;
  }): Promise<DocumentRow> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `insert into documents (project_id, source_type, title, mime, size_bytes, checksum, uploaded_by)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, project_id, source_type, title, mime, size_bytes, status, error, version`,
      [
        input.projectId,
        input.sourceType,
        input.title,
        input.mime ?? null,
        input.sizeBytes ?? null,
        input.checksum ?? null,
        input.uploadedBy ?? null,
      ],
    );
    return rows[0] as DocumentRow;
  }

  async findById(id: string): Promise<DocumentRow | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      "select id, project_id, source_type, title, mime, size_bytes, status, error, version from documents where id = $1 limit 1",
      [id],
    );
    return (rows[0] as DocumentRow) ?? null;
  }

  async list(projectId: string): Promise<Array<DocumentRow & { chunk_count: number }>> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `select d.id, d.project_id, d.source_type, d.title, d.mime, d.size_bytes, d.status, d.error, d.version,
              (select count(*)::int from chunks c where c.source_document_id = d.id) as chunk_count
       from documents d where d.project_id = $1 order by d.created_at desc`,
      [projectId],
    );
    return rows as Array<DocumentRow & { chunk_count: number }>;
  }

  async setStatus(id: string, status: DocumentRow["status"], error?: string | null): Promise<void> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    await this.db.query("update documents set status = $2, error = $3, updated_at = now() where id = $1", [
      id,
      status,
      error ?? null,
    ]);
  }

  async setVersion(id: string, version: number): Promise<void> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    await this.db.query("update documents set version = $2, updated_at = now() where id = $1", [id, version]);
  }

  async delete(id: string): Promise<void> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    await this.db.query("delete from documents where id = $1", [id]);
  }
}

@Injectable()
export class FaqsRepo {
  constructor(@Inject(PG) private readonly db: Pool | null) {}

  async insert(projectId: string, question: string, answer: string): Promise<FaqRow> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      `insert into faqs (project_id, question, answer) values ($1, $2, $3)
       returning id, project_id, question, answer, enabled`,
      [projectId, question, answer],
    );
    return rows[0] as FaqRow;
  }

  async findById(id: string): Promise<FaqRow | null> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      "select id, project_id, question, answer, enabled from faqs where id = $1 limit 1",
      [id],
    );
    return (rows[0] as FaqRow) ?? null;
  }

  async list(projectId: string): Promise<FaqRow[]> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const { rows } = await this.db.query(
      "select id, project_id, question, answer, enabled from faqs where project_id = $1 order by created_at",
      [projectId],
    );
    return rows as FaqRow[];
  }

  async update(id: string, patch: { question?: string; answer?: string; enabled?: boolean }): Promise<void> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const sets: string[] = [];
    const params: unknown[] = [id];
    if (patch.question !== undefined) {
      params.push(patch.question);
      sets.push(`question = $${params.length}`);
    }
    if (patch.answer !== undefined) {
      params.push(patch.answer);
      sets.push(`answer = $${params.length}`);
    }
    if (patch.enabled !== undefined) {
      params.push(patch.enabled);
      sets.push(`enabled = $${params.length}`);
    }
    if (sets.length > 0) {
      await this.db.query(`update faqs set ${sets.join(", ")}, updated_at = now() where id = $1`, params);
    }
  }

  async delete(id: string): Promise<void> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    await this.db.query("delete from faqs where id = $1", [id]);
  }
}

@Injectable()
export class ChunksRepo {
  constructor(@Inject(PG) private readonly db: Pool | null) {}

  async replaceForDocument(input: {
    projectId: string;
    documentId: string;
    version: number;
    text: string;
    embeddingModel: string;
    embed: (texts: string[]) => Promise<number[][]>;
  }): Promise<number> {
    const chunks = chunkText(input.text);
    if (chunks.length === 0) throw new Error("no_text: документ не содержит извлекаемого текста");
    const inserted = await this.insertChunks(
      { projectId: input.projectId, documentId: input.documentId, faqId: null, version: input.version, embeddingModel: input.embeddingModel, embed: input.embed },
      chunks.map((c) => ({ content: c.content, tokenCount: c.tokenCount, metadata: { heading: c.heading } })),
    );
    // Атомарный swap: старая версия удаляется только после успешной индексации новой (docs/12 §5)
    await this.deleteForDocumentOlderThan(input.documentId, input.version);
    return inserted;
  }

  async replaceForFaq(input: {
    projectId: string;
    faqId: string;
    question: string;
    answer: string;
    embeddingModel: string;
    embed: (texts: string[]) => Promise<number[][]>;
  }): Promise<number> {
    const content = `Вопрос: ${input.question}\nОтвет: ${input.answer}`;
    // FAQ индексируются «версией 1»: при изменении старые чанки удаляются сразу
    await this.deleteForFaq(input.faqId);
    return this.insertChunks(
      {
        projectId: input.projectId,
        documentId: null,
        faqId: input.faqId,
        version: 1,
        embeddingModel: input.embeddingModel,
        embed: input.embed,
      },
      [{ content, tokenCount: Math.ceil(content.length / 4), metadata: { kind: "faq" } }],
    );
  }

  private async insertChunks(
    input: {
      projectId: string;
      documentId: string | null;
      faqId: string | null;
      version: number;
      embeddingModel: string;
      embed: (texts: string[]) => Promise<number[][]>;
    },
    chunks: Array<{ content: string; tokenCount: number; metadata: Record<string, unknown> }>,
  ): Promise<number> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    const BATCH = 64;
    for (let offset = 0; offset < chunks.length; offset += BATCH) {
      const batch = chunks.slice(offset, offset + BATCH);
      const vectors = await input.embed(batch.map((c) => c.content));
      const params: unknown[] = [];
      const tuples = batch.map((chunk, i) => {
        const base = params.length;
        params.push(
          input.projectId,
          input.documentId,
          input.faqId,
          chunk.content,
          chunk.tokenCount,
          `[${vectors[i]!.join(",")}]`,
          JSON.stringify(chunk.metadata),
          input.embeddingModel,
          input.version,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::vector, $${base + 7}::jsonb, $${base + 8}, $${base + 9})`;
      });
      await this.db.query(
        `insert into chunks (project_id, source_document_id, source_faq_id, content, token_count, embedding, metadata, embedding_model, source_version)
         values ${tuples.join(", ")}`,
        params,
      );
    }
    return chunks.length;
  }

  async deleteForDocumentOlderThan(documentId: string, version: number): Promise<void> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    await this.db.query(
      "delete from chunks where source_document_id = $1 and source_version < $2",
      [documentId, version],
    );
  }

  async deleteForFaq(faqId: string): Promise<void> {
    if (!this.db) throw new Error("DATABASE_URL не настроен");
    await this.db.query("delete from chunks where source_faq_id = $1", [faqId]);
  }
}
