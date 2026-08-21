/**
 * Conversation Engine (docs/05 §3, docs/11): retrieval → гейт → промпт →
 * LLM-стрим (ai_token) → structured output (1 fix-up) → финальное сообщение
 * с citations/confidence. Гейт отключает вызов LLM (анти-галлюцинации, E2).
 * Фаза 4: после AI-хода сигналы structured output поступают в RulesEngine
 * (docs/14 §1–5): LLM поставляет сигналы, решение принимает код.
 */
import { Injectable, Logger } from "@nestjs/common";
import {
  DEFAULT_FALLBACK_MESSAGE,
  buildContextBlocks,
  buildHistoryMessages,
  buildSystemPrompt,
  evaluateEscalationRules,
  fixupInstruction,
  parseStructuredAnswer,
  type ChatMessage,
  type EscalationMatch,
  type EscalationSignals,
  type StructuredAnswer,
} from "@uni-chat/core";
import { HandoffReason, HandoffRequestedBy, MessageRole } from "@uni-chat/shared";
import { AiProviderService } from "../ai/ai-provider.service";
import { AssistantsRepo, type AssistantRow } from "../assistants/assistants.repo";
import { EscalationsRepo } from "../escalations/escalations.repo";
import { ConversationsRepo, type ConversationRow, type WidgetMessageRow } from "../widget/widget.repos";
import { RetrievalService } from "../rag/retrieval.service";
import { WidgetGateway } from "../realtime/widget.gateway";
import { HandoffService } from "./handoff.service";
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
    private readonly escalations: EscalationsRepo,
    private readonly retrieval: RetrievalService,
    private readonly providers: AiProviderService,
    private readonly gateway: WidgetGateway,
    private readonly handoffs: HandoffService,
  ) {}

  /** Вызывается после персистентности сообщения посетителя (docs/05 §3). */
  async onVisitorMessage(conversation: ConversationRow, text: string): Promise<void> {
    const assistant = await this.assistants.ensureForProject(conversation.project_id);
    const settings = settingsOf(assistant);
    await this.escalations.ensureDefaults(assistant.id);

    // Retrieval-гейт: LLM не вызывается без релевантных знаний (E2, docs/11 §5)
    let retrieval;
    try {
      retrieval = await this.retrieval.retrieve(conversation.project_id, text, {
        topK: settings.topK,
        scoreThreshold: settings.scoreThreshold,
      });
    } catch (err) {
      this.logger.warn(`retrieval failed: ${String(err)}`);
      await this.onNoAnswer(conversation, assistant.id, settings, text, {});
      return;
    }
    if (!retrieval.passed) {
      await this.onNoAnswer(conversation, assistant.id, settings, text, {});
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

      // Сигналы LLM → детерминированный RulesEngine (docs/14 §2, §5; ADR-011)
      const signals: EscalationSignals = {
        confidence: parsed.confidence,
        wantsHuman: parsed.user_intent_flags?.wants_human === true,
        complaint: parsed.user_intent_flags?.complaint === true,
        detectedIntent: parsed.detected_intent || null,
      };
      const match = await this.evaluateRules(conversation.id, assistant.id, signals, text);

      if (match?.action === "handoff") {
        // Прощальная фраза вместо ответа низкой уверенности (docs/14 §5.3)
        await this.createHandoffSafely(conversation, match);
        return;
      }
      if (match?.action === "fallback_message") {
        await this.appendFallback(conversation.id, settings.fallbackMessage);
        return;
      }

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
      await this.setFallbackStreak(conversation.id, 0);
    } catch (err) {
      this.logger.error(`llm failed: ${String(err)}`);
      // Провайдер недоступен: честное сообщение, без молчания (docs/05 §8)
      await this.handoffs.appendAndPush(
        conversation.id,
        MessageRole.System,
        "Техническая проблема на нашей стороне. Попробуйте повторить запрос через минуту.",
      );
    }
  }

  /**
   * Ход без LLM (гейт не прошёл / retrieval упал): правила с пустыми сигналами —
   * keyword/no_answer всё равно проверяются по тексту и счётчику fallbacks.
   */
  private async onNoAnswer(
    conversation: ConversationRow,
    assistantId: string,
    settings: EngineSettings,
    text: string,
    signals: EscalationSignals,
  ): Promise<void> {
    const match = await this.evaluateRules(conversation.id, assistantId, signals, text);
    if (match?.action === "handoff") {
      await this.createHandoffSafely(conversation, match);
      return;
    }
    // fallback_message от no_answer неотличим от обычного fallback-хода
    await this.appendFallback(conversation.id, settings.fallbackMessage);
  }

  /**
   * Handoff по правилу выполняется в фоне (после ответа посетителю); конфликт
   * состояний (оператор уже вмешался) — не ошибка движка, а штатный отказ.
   */
  private async createHandoffSafely(
    conversation: ConversationRow,
    match: EscalationMatch,
  ): Promise<void> {
    try {
      await this.handoffs.createFromAiActive(conversation, {
        reason: match.rule.type as HandoffReason,
        ruleId: match.rule.id ?? null,
        requestedBy: HandoffRequestedBy.Ai,
        actorType: "system",
      });
    } catch (err) {
      this.logger.warn(`rule handoff skipped: ${String(err)}`);
    }
  }

  private async evaluateRules(
    conversationId: string,
    assistantId: string,
    signals: EscalationSignals,
    messageText: string,
  ): Promise<EscalationMatch | null> {
    const rules = await this.escalations.enabledRules(assistantId);
    if (rules.length === 0) return null;
    const streak = Number((await this.conversations.getContext(conversationId)).fallback_streak ?? 0);
    return evaluateEscalationRules(rules, signals, {
      messageText,
      consecutiveFallbacks: streak,
    });
  }

  private async appendFallback(conversationId: string, fallbackMessage: string): Promise<void> {
    await this.appendAndEmit(conversationId, MessageRole.Assistant, fallbackMessage, undefined, undefined);
    const current = Number((await this.conversations.getContext(conversationId)).fallback_streak ?? 0);
    await this.conversations.mergeContext(conversationId, { fallback_streak: current + 1 });
  }

  private async setFallbackStreak(conversationId: string, value: number): Promise<void> {
    await this.conversations.mergeContext(conversationId, { fallback_streak: value });
  }

  private async runLlm(
    conversationId: string,
    messages: ChatMessage[],
  ): Promise<StructuredAnswer> {
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
