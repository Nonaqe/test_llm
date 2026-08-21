/**
 * Ingest-пайплайн Knowledge Base (docs/12 §2): pending → parsing → indexing →
 * ready/failed. Фаза 3: обработка — последовательная очередь внутри api-процесса
 * (BullMQ + worker при REDIS_URL — Ф4/7, IR-024).
 */
import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { EventsRepo } from "../db/repositories";
import { AiProviderService } from "../ai/ai-provider.service";
import { ChunksRepo, DocumentsRepo, FaqsRepo, type DocumentRow } from "./knowledge.repos";
import { detectKind, extractText, type SourceKind } from "./parsers";
import { fetchWithSsrfGuard } from "./ssrf";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

@Injectable()
export class KnowledgeService {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly uploadsDir: string;

  constructor(
    private readonly documents: DocumentsRepo,
    private readonly faqs: FaqsRepo,
    private readonly chunks: ChunksRepo,
    private readonly events: EventsRepo,
    private readonly providers: AiProviderService,
  ) {
    this.uploadsDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");
  }

  async uploadFile(input: {
    projectId: string;
    userId: string;
    buffer: Buffer;
    filename: string;
    mime: string;
  }): Promise<DocumentRow> {
    if (input.buffer.byteLength > MAX_FILE_BYTES) {
      throw new Error("TOO_LARGE: файл больше 25 МБ (docs/12 §1)");
    }
    const kind = detectKind(input.filename, input.mime);
    if (!kind) throw new Error(`UNSUPPORTED_TYPE: ${input.filename}`);
    // Magic bytes для бинарных форматов (docs/15 §3): тип определяется не
    // расширением, а содержимым — переименованный файл отсеивается сразу
    if (kind === "pdf" && !input.buffer.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
      throw new Error(`UNSUPPORTED_TYPE: ${input.filename} (нет %PDF-заголовка)`);
    }
    if (
      kind === "docx" &&
      input.buffer.subarray(0, 4).toString("latin1") !== "PK\u0003\u0004"
    ) {
      throw new Error(`UNSUPPORTED_TYPE: ${input.filename} (не ZIP/OOXML)`);
    }
    const checksum = createHash("sha256").update(input.buffer).digest("hex");
    const doc = await this.documents.insert({
      projectId: input.projectId,
      sourceType: "upload",
      title: input.filename,
      mime: input.mime,
      sizeBytes: input.buffer.byteLength,
      checksum,
      uploadedBy: input.userId,
    });
    // Файл сохраняется под стабильным именем {docId} для переиндексации
    // (volume uploads — docs/12 §1)
    await mkdir(this.uploadsDir, { recursive: true });
    await writeFile(path.join(this.uploadsDir, doc.id), input.buffer);

    return this.enqueue(async (): Promise<DocumentRow> => {
      await this.processUpload(doc.id, kind, input.buffer);
      return (await this.documents.findById(doc.id))!;
    });
  }

  async addUrl(input: { projectId: string; userId: string; url: string }): Promise<DocumentRow> {
    const doc = await this.documents.insert({
      projectId: input.projectId,
      sourceType: "url",
      title: input.url,
      uploadedBy: input.userId,
    });
    return this.enqueue(async (): Promise<DocumentRow> => {
      await this.processUrl(doc.id, input.url);
      return (await this.documents.findById(doc.id))!;
    });
  }

  async addText(input: { projectId: string; userId: string; title: string; text: string }): Promise<DocumentRow> {
    const doc = await this.documents.insert({
      projectId: input.projectId,
      sourceType: "text",
      title: input.title,
      sizeBytes: Buffer.byteLength(input.text, "utf8"),
      uploadedBy: input.userId,
    });
    const buffer = Buffer.from(input.text, "utf8");
    await mkdir(this.uploadsDir, { recursive: true });
    await writeFile(path.join(this.uploadsDir, doc.id), buffer);
    return this.enqueue(async (): Promise<DocumentRow> => {
      await this.indexDocument(doc.id, input.projectId, 1, buffer, "txt");
      return (await this.documents.findById(doc.id))!;
    });
  }

  /** Переиндексация: version+1 → индексация из сохранённого файла → swap (E9, docs/12 §5). */
  async reindex(projectId: string, documentId: string): Promise<void> {
    const doc = await this.mustOwn(projectId, documentId);
    await this.documents.setStatus(documentId, "pending");
    this.enqueue(async () => {
      const nextVersion = doc.version + 1;
      const { readFile } = await import("node:fs/promises");
      const buffer = await readFile(path.join(this.uploadsDir, documentId));
      const kind: SourceKind = doc.source_type === "text" ? "txt" : this.kindOf(doc);
      await this.indexDocument(documentId, projectId, nextVersion, buffer, kind);
      await this.documents.setVersion(documentId, nextVersion);
    }).catch(() => undefined);
  }

  async deleteDocument(projectId: string, documentId: string): Promise<void> {
    await this.mustOwn(projectId, documentId);
    await this.documents.delete(documentId); // чанки каскадом (docs/06 — FK cascade)
  }

  async listDocuments(projectId: string) {
    return this.documents.list(projectId);
  }

  // --- FAQ ---
  async addFaq(projectId: string, question: string, answer: string) {
    const faq = await this.faqs.insert(projectId, question, answer);
    await this.enqueue(async () => {
      const provider = await this.providers.embedding();
      await this.chunks.replaceForFaq({
        projectId,
        faqId: faq.id,
        question,
        answer,
        embeddingModel: provider.name === "fake" ? "fake-hashing-1536" : `${provider.name}:${provider.dimension}`,
        embed: (texts) => provider.embed(texts),
      });
    });
    return faq;
  }

  async updateFaq(projectId: string, faqId: string, patch: { question?: string; answer?: string; enabled?: boolean }) {
    const faq = await this.faqs.findById(faqId);
    if (!faq || faq.project_id !== projectId) throw new Error("NOT_FOUND");
    await this.faqs.update(faqId, patch);
    if (patch.question !== undefined || patch.answer !== undefined) {
      const updated = (await this.faqs.findById(faqId))!;
      await this.enqueue(async () => {
        const provider = await this.providers.embedding();
        await this.chunks.replaceForFaq({
          projectId,
          faqId,
          question: updated.question,
          answer: updated.answer,
          embeddingModel: provider.name === "fake" ? "fake-hashing-1536" : `${provider.name}:${provider.dimension}`,
          embed: (texts) => provider.embed(texts),
        });
      });
    }
    return this.faqs.findById(faqId);
  }

  async listFaqs(projectId: string) {
    return this.faqs.list(projectId);
  }

  async deleteFaq(projectId: string, faqId: string) {
    const faq = await this.faqs.findById(faqId);
    if (!faq || faq.project_id !== projectId) throw new Error("NOT_FOUND");
    await this.faqs.delete(faqId);
  }

  // --- внутреннее ---

  private async processUpload(docId: string, kind: SourceKind, buffer: Buffer): Promise<void> {
    const doc = (await this.documents.findById(docId))!;
    await this.indexDocument(docId, doc.project_id, 1, buffer, kind);
  }

  private async processUrl(docId: string, url: string): Promise<void> {
    const doc = (await this.documents.findById(docId))!;
    const page = await fetchWithSsrfGuard(url);
    const kind = page.contentType.includes("html") ? "html" : "txt";
    await this.indexDocument(
      docId,
      doc.project_id,
      1,
      Buffer.from(page.text, "utf8"),
      kind,
    );
  }

  private async indexDocument(
    docId: string,
    projectId: string,
    version: number,
    buffer: Buffer,
    kind: SourceKind,
  ): Promise<void> {
    try {
      await this.documents.setStatus(docId, "parsing");
      const text = await extractText(kind, buffer);
      await this.documents.setStatus(docId, "indexing");
      const provider = await this.providers.embedding();
      await this.chunks.replaceForDocument({
        projectId,
        documentId: docId,
        version,
        text,
        embeddingModel: provider.name === "fake" ? "fake-hashing-1536" : `${provider.name}:${provider.dimension}`,
        embed: (texts) => provider.embed(texts),
      });
      await this.documents.setStatus(docId, "ready");
      await this.events.append({
        actorType: "system",
        action: "knowledge.document_indexed",
        entityType: "document",
        entityId: docId,
        payload: { version },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.documents.setStatus(docId, "failed", message.slice(0, 500));
    }
  }

  private kindOf(doc: DocumentRow): SourceKind {
    const byMime = doc.mime ? detectKind(doc.title, doc.mime) : null;
    return byMime ?? detectKind(doc.title, "") ?? "txt";
  }

  private async mustOwn(projectId: string, documentId: string): Promise<DocumentRow> {
    const doc = await this.documents.findById(documentId);
    if (!doc || doc.project_id !== projectId) throw new Error("NOT_FOUND");
    return doc;
  }

  /** Последовательная очередь (concurrency 1): парсинг не блокирует event loop параллельно. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
