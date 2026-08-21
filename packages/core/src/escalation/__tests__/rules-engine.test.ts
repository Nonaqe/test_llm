import { describe, expect, it } from "vitest";
import {
  evaluateEscalationRules,
  type EscalationRuleInput,
  type EscalationRuleType,
  type EscalationSignals,
} from "../rules-engine";

/** Фабрика правила: в тестах указываем только значимые поля. */
function rule(overrides: Partial<EscalationRuleInput>): EscalationRuleInput {
  return {
    priority: 10,
    type: "explicit_request",
    params: {},
    action: "handoff",
    enabled: true,
    ...overrides,
  };
}

const BASE_CONTEXT = { messageText: "", consecutiveFallbacks: 0 };

interface TableRow {
  name: string;
  rules: EscalationRuleInput[];
  signals: EscalationSignals;
  /** Переопределения контекста поверх BASE_CONTEXT */
  context?: Partial<{ messageText: string; consecutiveFallbacks: number }>;
  expectedAction: "handoff" | "fallback_message" | null;
}

describe("rules engine эскалации (docs/14 §2, §3, §5)", () => {
  describe("таблица «сигналы + правила → действие» по каждому типу", () => {
    const TABLE: TableRow[] = [
      // explicit_request (docs/14 §3: флаг wants_human)
      {
        name: "explicit_request: позитив — wantsHuman=true → handoff",
        rules: [rule({ type: "explicit_request" })],
        signals: { wantsHuman: true },
        expectedAction: "handoff",
      },
      {
        name: "explicit_request: негатив — wantsHuman=false → null",
        rules: [rule({ type: "explicit_request" })],
        signals: { wantsHuman: false },
        expectedAction: null,
      },
      // low_confidence (docs/14 §3: confidence < threshold)
      {
        name: "low_confidence: позитив — 0.41 < 0.55 → handoff",
        rules: [rule({ type: "low_confidence", params: { threshold: 0.55 } })],
        signals: { confidence: 0.41 },
        expectedAction: "handoff",
      },
      {
        name: "low_confidence: негатив — 0.90 >= 0.55 → null",
        rules: [rule({ type: "low_confidence", params: { threshold: 0.55 } })],
        signals: { confidence: 0.9 },
        expectedAction: null,
      },
      // keyword (docs/14 §3: совпадение regex в сообщении)
      {
        name: "keyword: позитив — паттерн найден в тексте → handoff",
        rules: [rule({ type: "keyword", params: { patterns: ["жалоба"] } })],
        signals: {},
        context: { messageText: "Это жалоба!" },
        expectedAction: "handoff",
      },
      {
        name: "keyword: негатив — совпадений нет → null",
        rules: [rule({ type: "keyword", params: { patterns: ["жалоба"] } })],
        signals: {},
        context: { messageText: "Всё отлично, спасибо" },
        expectedAction: null,
      },
      // intent (docs/14 §3: detected_intent совпал)
      {
        name: "intent: позитив — detectedIntent совпал → handoff",
        rules: [rule({ type: "intent", params: { intent: "refund_policy" } })],
        signals: { detectedIntent: "refund_policy" },
        expectedAction: "handoff",
      },
      {
        name: "intent: негатив — другой интент → null",
        rules: [rule({ type: "intent", params: { intent: "refund_policy" } })],
        signals: { detectedIntent: "greeting" },
        expectedAction: null,
      },
      // complaint (docs/14 §3: флаг complaint)
      {
        name: "complaint: позитив — complaint=true → handoff",
        rules: [rule({ type: "complaint" })],
        signals: { complaint: true },
        expectedAction: "handoff",
      },
      {
        name: "complaint: негатив — complaint=false → null",
        rules: [rule({ type: "complaint" })],
        signals: { complaint: false },
        expectedAction: null,
      },
      // no_answer (docs/14 §3: N подряд fallback-ответов)
      {
        name: "no_answer: позитив — 2 подряд fallback >= max_fallbacks=2 → handoff",
        rules: [rule({ type: "no_answer", params: { max_fallbacks: 2 } })],
        signals: {},
        context: { consecutiveFallbacks: 2 },
        expectedAction: "handoff",
      },
      {
        name: "no_answer: негатив — 1 подряд fallback < max_fallbacks=2 → null",
        rules: [rule({ type: "no_answer", params: { max_fallbacks: 2 } })],
        signals: {},
        context: { consecutiveFallbacks: 1 },
        expectedAction: null,
      },
      // Действие берётся из правила, а не фиксируется по типу
      {
        name: "low_confidence с action=fallback_message → fallback_message",
        rules: [
          rule({
            type: "low_confidence",
            params: { threshold: 0.55 },
            action: "fallback_message",
          }),
        ],
        signals: { confidence: 0.41 },
        expectedAction: "fallback_message",
      },
    ];

    it.each(TABLE)("$name", ({ rules, signals, context, expectedAction }) => {
      const match = evaluateEscalationRules(rules, signals, {
        ...BASE_CONTEXT,
        ...context,
      });
      if (expectedAction === null) {
        expect(match).toBeNull();
      } else {
        expect(match).not.toBeNull();
        expect(match?.action).toBe(expectedAction);
      }
    });
  });

  describe("порядок применения (docs/14 §5.1–5.2)", () => {
    it("из двух подходящих правил выигрывает меньший priority", () => {
      const lowConfidence = rule({
        id: "rule-low-conf",
        priority: 10,
        type: "low_confidence",
        params: { threshold: 0.9 },
      });
      const keyword = rule({
        id: "rule-keyword",
        priority: 20,
        type: "keyword",
        params: { patterns: ["жалоба"] },
      });
      const match = evaluateEscalationRules(
        [keyword, lowConfidence], // намеренно в обратном порядке
        { confidence: 0.5 },
        { messageText: "Это жалоба!", consecutiveFallbacks: 0 },
      );
      expect(match).not.toBeNull();
      expect(match?.rule.priority).toBe(10);
      expect(match?.rule.id).toBe("rule-low-conf");
    });

    it("first-match-wins: после срабатывания первого правила второе не оценивается (видно по reason)", () => {
      const first = rule({
        priority: 10,
        type: "complaint",
      });
      const second = rule({
        priority: 20,
        type: "keyword",
        params: { patterns: ["жалоба"] },
      });
      const match = evaluateEscalationRules(
        [first, second],
        { complaint: true },
        { messageText: "Это жалоба!", consecutiveFallbacks: 0 },
      );
      // Оба правила подходят, но reason — от первого (complaint), а не от keyword
      expect(match?.reason).toBe("complaint: complaint=true");
      expect(match?.reason).not.toContain("keyword");
    });

    it("выключенное правило с меньшим priority не мешает включённому сработать", () => {
      const disabled = rule({ priority: 5, type: "complaint", enabled: false });
      const enabled = rule({ priority: 10, type: "explicit_request" });
      const match = evaluateEscalationRules(
        [disabled, enabled],
        { wantsHuman: true, complaint: true },
        BASE_CONTEXT,
      );
      expect(match?.rule.type).toBe<EscalationRuleType>("explicit_request");
    });
  });

  describe("enabled=false (docs/14 §4 — вкл/выкл)", () => {
    it("выключенное правило пропускается, даже если условие выполнено", () => {
      const match = evaluateEscalationRules(
        [rule({ type: "explicit_request", enabled: false })],
        { wantsHuman: true },
        BASE_CONTEXT,
      );
      expect(match).toBeNull();
    });
  });

  describe("low_confidence — порог (docs/14 §3)", () => {
    it("равенство confidence === threshold НЕ срабатывает (строгое <)", () => {
      const match = evaluateEscalationRules(
        [rule({ type: "low_confidence", params: { threshold: 0.55 } })],
        { confidence: 0.55 },
        BASE_CONTEXT,
      );
      expect(match).toBeNull();
    });

    it("отсутствие confidence не срабатывает", () => {
      const match = evaluateEscalationRules(
        [rule({ type: "low_confidence", params: { threshold: 0.55 } })],
        {},
        BASE_CONTEXT,
      );
      expect(match).toBeNull();
    });

    it("нечисловой порог — правило пропускается без исключения", () => {
      const match = evaluateEscalationRules(
        [rule({ type: "low_confidence", params: { threshold: "0.55" } })],
        { confidence: 0.1 },
        BASE_CONTEXT,
      );
      expect(match).toBeNull();
    });
  });

  describe("keyword — устойчивость и кириллица (docs/14 §3)", () => {
    it("битый regex не роняет оценку: правило пропускается целиком", () => {
      const match = evaluateEscalationRules(
        // "(" — невалидный regex; «жалоба» при этом есть в тексте
        [rule({ type: "keyword", params: { patterns: ["(", "жалоба"] } })],
        {},
        { messageText: "Это жалоба!", consecutiveFallbacks: 0 },
      );
      expect(match).toBeNull();
    });

    it("правило только с битым regex → null, исключение не бросается", () => {
      expect(() =>
        evaluateEscalationRules(
          [rule({ type: "keyword", params: { patterns: ["["] } })],
          {},
          { messageText: "любой текст", consecutiveFallbacks: 0 },
        ),
      ).not.toThrow();
    });

    it("кириллический паттерн «жалоба» находит «Это жалоба!»", () => {
      const match = evaluateEscalationRules(
        [rule({ type: "keyword", params: { patterns: ["жалоба"] } })],
        {},
        { messageText: "Это жалоба!", consecutiveFallbacks: 0 },
      );
      expect(match).not.toBeNull();
      expect(match?.action).toBe("handoff");
      expect(match?.reason).toBe("keyword: совпадение /жалоба/");
    });
  });

  describe("no_answer — граница max_fallbacks (docs/14 §3)", () => {
    const rules = [rule({ type: "no_answer", params: { max_fallbacks: 2 } })];

    it.each([
      [1, false], // max_fallbacks - 1 → ещё не срабатывает
      [2, true], // ровно граница → срабатывает (>=)
      [3, true], // выше границы → срабатывает
    ])("consecutiveFallbacks=%i при max_fallbacks=2 → %s", (fallbacks, shouldMatch) => {
      const match = evaluateEscalationRules(rules, {}, { ...BASE_CONTEXT, consecutiveFallbacks: fallbacks });
      if (shouldMatch) {
        expect(match).not.toBeNull();
        expect(match?.reason).toBe(`no_answer: ${fallbacks} >= 2`);
      } else {
        expect(match).toBeNull();
      }
    });
  });

  describe("объяснимость reason (docs/14 §5.4)", () => {
    it.each([
      [
        "explicit_request",
        "explicit_request: wants_human",
        { wantsHuman: true } satisfies EscalationSignals,
      ],
      [
        "low_confidence",
        "low_confidence: 0.41 < 0.55",
        { confidence: 0.41 } satisfies EscalationSignals,
      ],
      [
        "intent",
        "intent: refund_policy",
        { detectedIntent: "refund_policy" } satisfies EscalationSignals,
      ],
      [
        "complaint",
        "complaint: complaint=true",
        { complaint: true } satisfies EscalationSignals,
      ],
    ] as ReadonlyArray<[EscalationRuleType, string, EscalationSignals]>)(
      "reason для %s",
      (type, expectedReason, signals) => {
        const paramsByType: Record<EscalationRuleType, Record<string, unknown>> = {
          explicit_request: {},
          low_confidence: { threshold: 0.55 },
          keyword: { patterns: [] },
          intent: { intent: "refund_policy" },
          complaint: {},
          no_answer: { max_fallbacks: 2 },
        };
        const match = evaluateEscalationRules(
          [rule({ type, params: paramsByType[type] })],
          signals,
          BASE_CONTEXT,
        );
        expect(match?.reason).toBe(expectedReason);
      },
    );
  });

  describe("нет подходящего правила", () => {
    it("пустой список правил → null", () => {
      expect(evaluateEscalationRules([], { wantsHuman: true }, BASE_CONTEXT)).toBeNull();
    });

    it("правила есть, но сигналы не подходят ни под одно → null", () => {
      const match = evaluateEscalationRules(
        [
          rule({ type: "explicit_request" }),
          rule({ type: "complaint" }),
          rule({ type: "low_confidence", params: { threshold: 0.3 } }),
        ],
        { confidence: 0.95, wantsHuman: false, complaint: false },
        BASE_CONTEXT,
      );
      expect(match).toBeNull();
    });
  });
});
