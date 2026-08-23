/**
 * Юнит-тесты ConversationEngineService (аудит IR-059: ядро продукта без тестов,
 * проверялось только e2e через fake-провайдер). Все зависимости — in-memory
 * фейки; core-функции (гейт, rules-engine, structured output) покрыты своими.
 */
import { describe, expect, it, vi } from "vitest";
import type { AssistantRow } from "../assistants/assistants.repo";
import type { ConversationRow } from "../widget/widget.repos";
import { MessageRole } from "@uni-chat/shared";
import { ConversationEngineService } from "./conversation-engine.service";

// --- фейки зависимостей ------------------------------------------------------

function makeAssistant(): AssistantRow {
  return {
    id: "a1",
    project_id: "p1",
    name: "Nova",
    locale: "ru",
    tone: null,
    company_description: null,
    custom_instructions: null,
    retrieval_settings: { top_k: 4, score_threshold: 0.3 },
    safety_settings: {},
  } as unknown as AssistantRow;
}

function makeConversation(): ConversationRow {
  return {
    id: "c1",
    project_id: "p1",
    visitor_id: "v1",
    site_id: "s1",
    state: "AI_ACTIVE",
    context: {},
  } as unknown as ConversationRow;
}

interface Deps {
  assistants: { ensureForProject: ReturnType<typeof vi.fn> };
  conversations: {
    listMessages: ReturnType<typeof vi.fn>;
    getContext: ReturnType<typeof vi.fn>;
    mergeContext: ReturnType<typeof vi.fn>;
    appendMessage: ReturnType<typeof vi.fn>;
  };
  escalations: {
    ensureDefaults: ReturnType<typeof vi.fn>;
    enabledRules: ReturnType<typeof vi.fn>;
  };
  retrieval: { retrieve: ReturnType<typeof vi.fn> };
  providers: { llm: ReturnType<typeof vi.fn> };
  gateway: { emitAiToken: ReturnType<typeof vi.fn>; emitMessage: ReturnType<typeof vi.fn> };
  handoffs: {
    createFromAiActive: ReturnType<typeof vi.fn>;
    appendAndPush: ReturnType<typeof vi.fn>;
  };
}

/** LLM с заранее заданными ответами по порядку вызовов streamOnce */
function makeLlm(responses: string[]): Deps["providers"] {
  let call = 0;
  return {
    llm: vi.fn(async () => ({
      chatStream: () => {
        const raw = responses[Math.min(call, responses.length - 1)]!;
        call += 1;
        const iterator = (async function* () {
          yield { token: raw.slice(0, 4) };
          yield { token: raw.slice(4) };
        })();
        return Object.assign(iterator, { result: async () => ({ raw }) });
      },
    })),
  } as unknown as Deps["providers"];
}

function makeDeps(opts: {
  retrieval?: { passed: boolean } | Error;
  llmResponses?: string[];
  rules?: Array<Record<string, unknown>>;
}): { deps: Deps; engine: ConversationEngineService } {
  const deps: Deps = {
    assistants: { ensureForProject: vi.fn(async () => makeAssistant()) },
    conversations: {
      listMessages: vi.fn(async () => []),
      getContext: vi.fn(async () => ({ fallback_streak: 0 })),
      mergeContext: vi.fn(async () => undefined),
      appendMessage: vi.fn(async () => ({
        id: "m-new",
        conversation_id: "c1",
        seq: 9,
        role: "assistant",
        content: "x",
        citations: null,
        confidence: null,
        created_at: Date.now(),
        state_after: "AI_ACTIVE",
      })),
    },
    escalations: {
      ensureDefaults: vi.fn(async () => undefined),
      enabledRules: vi.fn(async () => opts.rules ?? []),
    },
    retrieval: {
      retrieve: vi.fn(
        typeof opts.retrieval === "object" && opts.retrieval instanceof Error
          ? async () => {
              throw opts.retrieval;
            }
          : async () => ({
              passed: opts.retrieval?.passed ?? false,
              bestCosine: 0.8,
              chunks: [
                {
                  chunkId: "ch1",
                  sourceDocumentId: null,
                  sourceFaqId: null,
                  content: "фаза",
                  metadata: {},
                  cosine: 0.82,
                  rrfScore: 1,
                },
              ],
            }),
      ),
    },
    providers: makeLlm(opts.llmResponses ?? []),
    gateway: { emitAiToken: vi.fn(), emitMessage: vi.fn() },
    handoffs: {
      createFromAiActive: vi.fn(async () => undefined),
      appendAndPush: vi.fn(async () => undefined),
    },
  };

  const engine = new ConversationEngineService(
    deps.assistants as never,
    deps.conversations as never,
    deps.escalations as never,
    deps.retrieval as never,
    deps.providers as never,
    deps.gateway as never,
    deps.handoffs as never,
  );
  return { deps, engine };
}

const validAnswer = JSON.stringify({ answer: "Фаза 0 готова.", confidence: 0.92 });

describe("ConversationEngineService.onVisitorMessage", () => {
  it("гейт не пройден → fallback без вызова LLM, счётчик fallback_streak растёт", async () => {
    const { deps, engine } = makeDeps({ retrieval: { passed: false } });
    await engine.onVisitorMessage(makeConversation(), "привет");

    expect(deps.providers.llm).not.toHaveBeenCalled();
    const [id, role] = deps.conversations.appendMessage.mock.calls[0] as unknown as [
      string,
      MessageRole,
    ];
    expect(id).toBe("c1");
    expect(role).toBe(MessageRole.Assistant);
    // streak: getContext вернул 0 → mergeContext с 1
    expect(deps.conversations.mergeContext).toHaveBeenCalledWith("c1", { fallback_streak: 1 });
  });

  it("падение retrieval трактуется как no-answer, а не как необработанное исключение", async () => {
    const { deps, engine } = makeDeps({ retrieval: new Error("db down") });
    await engine.onVisitorMessage(makeConversation(), "вопрос");
    expect(deps.conversations.appendMessage).toHaveBeenCalled();
    expect(deps.providers.llm).not.toHaveBeenCalled();
  });

  it("гейт пройден + валидный structured output → ответ с citations и сброс streak", async () => {
    const { deps, engine } = makeDeps({
      retrieval: { passed: true },
      llmResponses: [validAnswer],
    });
    await engine.onVisitorMessage(makeConversation(), "какие фазы есть?");

    const [id, role, content, citations, confidence] = deps.conversations.appendMessage.mock
      .calls[0] as unknown as [string, MessageRole, string, Array<{ chunk_id: string; score: number }>, number];
    expect([id, role]).toEqual(["c1", MessageRole.Assistant]);
    expect(content).toBe("Фаза 0 готова.");
    expect(citations).toEqual([{ chunk_id: "ch1", score: 0.82 }]);
    expect(confidence).toBe(0.92);
    expect(deps.gateway.emitMessage).toHaveBeenCalled();
    expect(deps.conversations.mergeContext).toHaveBeenCalledWith("c1", { fallback_streak: 0 });
  });

  it("wants_human от LLM → handoff вместо ответа", async () => {
    const wantsHuman = JSON.stringify({
      answer: "Передаю оператору.",
      confidence: 0.99,
      user_intent_flags: { wants_human: true },
    });
    const { deps, engine } = makeDeps({
      retrieval: { passed: true },
      llmResponses: [wantsHuman],
      rules: [{ id: "r1", type: "explicit_request", action: "handoff", priority: 10, params: {}, enabled: true }],
    });
    await engine.onVisitorMessage(makeConversation(), "позовите менеджера!");

    expect(deps.handoffs.createFromAiActive).toHaveBeenCalledTimes(1);
    // ответ AI НЕ публикуется — уходит прощальная фраза из handoff-сервиса
    expect(deps.conversations.appendMessage).not.toHaveBeenCalled();
  });

  it("keyword-правило срабатывает и на ходу без LLM (гейт не прошёл)", async () => {
    const { deps, engine } = makeDeps({
      retrieval: { passed: false },
      rules: [{ id: "r2", type: "keyword", action: "handoff", priority: 20, params: { patterns: ["жалоб"] }, enabled: true }],
    });
    await engine.onVisitorMessage(makeConversation(), "у меня жалоба!");
    expect(deps.handoffs.createFromAiActive).toHaveBeenCalledTimes(1);
    expect(deps.conversations.appendMessage).not.toHaveBeenCalled();
  });

  it("дважды невалидный structured output → честное системное сообщение об ошибке", async () => {
    const { deps, engine } = makeDeps({
      retrieval: { passed: true },
      llmResponses: ["не JSON вообще"],
    });
    await engine.onVisitorMessage(makeConversation(), "вопрос");

    // ответ AI не публиковался: после основного хода и fix-up-ретрая
    // structured output так и остался невалидным
    expect(deps.conversations.appendMessage).not.toHaveBeenCalled();
    const [, role, content] = deps.handoffs.appendAndPush.mock.calls[0] as unknown as [
      string,
      MessageRole,
      string,
    ];
    expect(role).toBe(MessageRole.System);
    expect(content).toContain("Техническая проблема");
  });
});
