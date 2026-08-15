/**
 * Conversation Engine (docs/05 §3, docs/11): retrieval → гейт → промпт →
 * LLM-стрим (ai_token) → structured output (1 fix-up) → финальное сообщение
 * с citations/confidence. Гейт отключает вызов LLM (анти-галлюцинации, E2).
 */
import { Injectable, Logger } from "@nestjs/common";
import {
  DEFAULT_FALLBACK_MESSAGE,
  buildContextBlocks,
  buildHistoryMessages,
  buildSystemPrompt,
  fixupInstruction,
  parseStructuredAnswer,
  type ChatMessage,
} from "@uni-chat/core";
import { MessageRole } from "@uni-chat/shared";
import { AiProviderService } from "../ai/ai-provider.service";
import { AssistantsRepo, type AssistantRow } from "../assistants/assistants.repo";
import { ConversationsRepo, type ConversationRow, type WidgetMessageRow } from "../widget/widget.repos";
import { RetrievalService } from "../rag/retrieval.service";
import { WidgetGateway } from "../realtime/widget.gateway";
import { toMessageDto } from "../widget/message-dto";

interface EngineSettings {
  topK: number;
  scoreThreshold: number;
  historyDepth: number;
  fallbackMessage: string;
}

function settingsOf(assistant: AssistantRow): EngineSettings {
  const r = assistant.retrieval_settings ?? {};
  const s = assistant.safety_settings ?? {};
  return {
    topK: r.top_k ?? 6,
    scoreThreshold: r.score_threshold ?? 0.55,
    historyDepth: r.history_depth ?? 10,
    fallbackMessage: s.fallback_message?.trim() || DEFAULT_FALLBACK_MESSAGE,
  };
}

@Injectable()
export class ConversationEngineService {
  private readonly logger = new Logger(ConversationEngineService.name);

  constructor(
    private readonly assistants: AssistantsRepo,
    private readonly conversations: ConversationsRepo,
    private readonly retrieval: RetrievalService,
    private readonly providers: AiProviderService,
    private readonly gateway: WidgetGateway,
  ) {}

  /** Вызывается после персистентности сообщения посетителя (docs/05 §3). */
  async onVisitorMessage(conversation: ConversationRow, text: string): Promise<void> {
    const assistant = await this.assistants.ensureForProject(conversation.project_id);
    const settings = settingsOf(assistant);

    // Retrieval-гейт: LLM не вызывается без релевантных знаний (E2, docs/11 §5)
    let retrieval;
    try {
      retrieval = await this.retrieval.retrieve(conversation.project_id, text, {
        topK: settings.topK,
        scoreThreshold: settings.scoreThreshold,
      });
    } catch (err) {
      this.logger.warn(`retrieval failed: ${String(err)}`);
      await this.appendAndEmit(conversation.id, MessageRole.Assistant, settings.fallbackMessage, undefined, undefined);
      return;
    }
    if (!retrieval.passed) {
      await this.appendAndEmit(conversation.id, MessageRole.Assistant, settings.fallbackMessage, undefined, undefined);
      return;
    }

    const history = await this.conversations.listMessages(conversation.id, 0);
    const historyMessages = buildHistoryMessages(
      history.map((m) => ({
        role: m.role as "visitor" | "assistant" | "operator" | "system",
        content: m.content,
      })),
      settings.historyDepth,
    );

    const system = buildSystemPrompt({
      name: assistant.name,
      locale: assistant.locale,
      tone: assistant.tone,
      companyDescription: assistant.company_description,
      customInstructions: assistant.custom_instructions,
      deniedTopics: assistant.safety_settings?.denied_topics ?? [],
      fallbackMessage: settings.fallbackMessage,
    });
    const context = buildContextBlocks(retrieval.chunks);
    const userTurn = `${context}\n\nВопрос посетителя: ${text}`;
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...historyMessages,
      { role: "user", content: userTurn },
    ];

    try {
      const parsed = await this.runLlm(conversation.id, messages);
      const citations = retrieval.chunks.map((c) => ({
        chunk_id: c.chunkId,
        score: Number(c.cosine.toFixed(4)),
      }));
      await this.appendAndEmit(
        conversation.id,
        MessageRole.Assistant,
        parsed.answer,
        citations,
        parsed.confidence,
      );
    } catch (err) {
      this.logger.error(`llm failed: ${String(err)}`);
      // Провайдер недоступен: честное сообщение, без молчания (docs/05 §8)
      await this.appendAndEmit(
        conversation.id,
        MessageRole.System,
        "Техническая проблема на нашей стороне. Попробуйте повторить запрос через минуту.",
        undefined,
        undefined,
      );
    }
  }

  private async runLlm(
    conversationId: string,
    messages: ChatMessage[],
  ): Promise<{ answer: string; confidence: number }> {
    const llm = await this.providers.llm();

    const first = await this.streamOnce(conversationId, llm, messages);
    let parsed = parseStructuredAnswer(first);
    if (parsed.ok) return parsed.value;

    // 1 fix-up-ретрай (docs/11 §4)
    const second = await this.streamOnce(conversationId, llm, [
      ...messages,
      { role: "assistant", content: first },
      { role: "user", content: fixupInstruction(parsed.reason) },
    ]);
    parsed = parseStructuredAnswer(second);
    if (parsed.ok) return parsed.value;
    throw new Error(`structured_output_invalid: ${parsed.reason}`);
  }

  private async streamOnce(
    conversationId: string,
    llm: Awaited<ReturnType<AiProviderService["llm"]>>,
    messages: ChatMessage[],
  ): Promise<string> {
    const stream = llm.chatStream(messages);
    for await (const chunk of stream) {
      this.gateway.emitAiToken(conversationId, chunk.token);
    }
    const { raw } = await stream.result();
    return raw;
  }

  private async appendAndEmit(
    conversationId: string,
    role: MessageRole,
    content: string,
    citations: Array<{ chunk_id: string; score: number }> | undefined,
    confidence: number | undefined,
  ): Promise<WidgetMessageRow> {
    const message = await this.conversations.appendMessage(
      conversationId,
      role,
      content,
      citations,
      confidence,
    );
    this.gateway.emitMessage(conversationId, toMessageDto(message));
    return message;
  }
}
