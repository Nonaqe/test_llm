/**
 * Песочница тестового диалога (docs/30 §Ф5 «тестовый диалог (песочница)»):
 * тот же путь, что у реального виджета — retrieval → гейт релевантности →
 * LLM с structured output (1 fix-up), НО без записи conversation/messages/
 * handoff и без правил эскалации. Fallback-ход движка (гейт не прошёл)
 * возвращается как fallback:true с fallback-текстом настроек ассистента.
 * Вызов расходует кредиты провайдера — поэтому право ManageProject.
 */
import { Injectable } from "@nestjs/common";
import {
  DEFAULT_FALLBACK_MESSAGE,
  buildContextBlocks,
  buildSystemPrompt,
  fixupInstruction,
  parseStructuredAnswer,
  type ChatMessage,
  type LlmProvider,
  type StructuredAnswer,
} from "@uni-chat/core";
import type { SandboxAnswerDto } from "@uni-chat/shared";
import { AppError } from "../common/http";
import { AssistantsRepo, type AssistantRow } from "../assistants/assistants.repo";
import { RetrievalService, type RetrievalResult } from "../rag/retrieval.service";
import { AiProviderService } from "../ai/ai-provider.service";

interface SandboxSettings {
  topK: number;
  scoreThreshold: number;
  fallbackMessage: string;
}

/** Дублирует settingsOf ConversationEngineService — поведение виджета 1:1. */
function settingsOf(assistant: AssistantRow): SandboxSettings {
  const r = assistant.retrieval_settings ?? {};
  const s = assistant.safety_settings ?? {};
  return {
    topK: r.top_k ?? 6,
    scoreThreshold: r.score_threshold ?? 0.55,
    fallbackMessage: s.fallback_message?.trim() || DEFAULT_FALLBACK_MESSAGE,
  };
}

@Injectable()
export class SandboxService {
  constructor(
    private readonly assistants: AssistantsRepo,
    private readonly retrieval: RetrievalService,
    private readonly providers: AiProviderService,
  ) {}

  async answer(projectId: string, text: string): Promise<SandboxAnswerDto> {
    const assistant = await this.assistants.ensureForProject(projectId);
    const settings = settingsOf(assistant);

    // Гейт релевантности: как в движке, LLM не вызывается без знаний (E2, docs/11 §5)
    let retrieval: RetrievalResult;
    try {
      retrieval = await this.retrieval.retrieve(projectId, text, {
        topK: settings.topK,
        scoreThreshold: settings.scoreThreshold,
      });
    } catch (err) {
      throw providerError(err);
    }
    if (!retrieval.passed) {
      return {
        text: settings.fallbackMessage,
        citations: [],
        confidence: null,
        fallback: true,
      };
    }

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
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      // Истории нет: песочница отвечает на одиночный вопрос (без conversation)
      { role: "user", content: `${context}\n\nВопрос посетителя: ${text}` },
    ];

    let parsed: StructuredAnswer;
    try {
      parsed = await this.runLlm(messages);
    } catch (err) {
      throw providerError(err);
    }
    return {
      text: parsed.answer,
      citations: retrieval.chunks.map((c) => ({
        chunk_id: c.chunkId,
        score: Number(c.cosine.toFixed(4)),
      })),
      confidence: parsed.confidence,
      fallback: false,
    };
  }

  /** Как ConversationEngineService.runLlm, но токены стрима никуда не релеятся. */
  private async runLlm(messages: ChatMessage[]): Promise<StructuredAnswer> {
    const llm = await this.providers.llm();

    const first = await this.complete(llm, messages);
    let parsed = parseStructuredAnswer(first);
    if (parsed.ok) return parsed.value;

    // 1 fix-up-ретрай (docs/11 §4)
    const second = await this.complete(llm, [
      ...messages,
      { role: "assistant", content: first },
      { role: "user", content: fixupInstruction(parsed.reason) },
    ]);
    parsed = parseStructuredAnswer(second);
    if (parsed.ok) return parsed.value;
    throw new Error(`structured_output_invalid: ${parsed.reason}`);
  }

  private async complete(
    llm: LlmProvider,
    messages: ChatMessage[],
  ): Promise<string> {
    const stream = llm.chatStream(messages);
    for await (const _ of stream) {
      void _; // диалога нет — ai_token некуда и незачем доставлять
    }
    const { raw } = await stream.result();
    return raw;
  }
}

/** Ошибки провайдера/конфигурации → 502 AI_PROVIDER_ERROR (стиль реестра docs/07 §5). */
function providerError(err: unknown): AppError {
  return new AppError("AI_PROVIDER_ERROR", "AI-провайдер недоступен или вернул ошибку", 502, {
    reason: err instanceof Error ? err.message : String(err),
  });
}
