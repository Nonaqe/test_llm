/**
 * RulesEngine эскалации — детерминированная чистая функция без зависимостей
 * (docs/14_ESCALATION_RULES.md §1, §5; ADR-011).
 * Принцип: сигналы даёт LLM, решает код — предсказуемость, объяснимость,
 * тестируемость, защита от «уговоров» промпт-инъекций.
 */

/** Тип правила эскалации (docs/14 §3, таблица escalation_rules.type). */
export type EscalationRuleType =
  | "explicit_request"
  | "low_confidence"
  | "keyword"
  | "intent"
  | "complaint"
  | "no_answer";

/** Действие сработавшего правила (docs/14 §3). */
export type EscalationAction = "handoff" | "fallback_message";

/** Строка таблицы escalation_rules (docs/14 §3). */
export interface EscalationRuleInput {
  /** Идентификатор строки escalation_rules (для rule_id в handoff); может отсутствовать в юнит-тестах */
  id?: string;
  /** Порядок применения — по возрастанию priority (docs/14 §5.1) */
  priority: number;
  type: EscalationRuleType;
  /** Параметры правила, зависят от type (docs/14 §3) */
  params: Record<string, unknown>;
  action: EscalationAction;
  /** Выключенное правило пропускается (docs/14 §4 — вкл/выкл в продвинутом режиме) */
  enabled: boolean;
}

/** Сигналы LLM после AI-хода (docs/14 §2); любое поле может отсутствовать. */
export interface EscalationSignals {
  confidence?: number;
  wantsHuman?: boolean;
  complaint?: boolean;
  detectedIntent?: string | null;
}

export interface EscalationContext {
  /** Текст сообщения посетителя (для keyword-правил) */
  messageText: string;
  /** Сколько подряд последних ответов AI были fallback-фразами */
  consecutiveFallbacks: number;
}

export interface EscalationMatch {
  rule: EscalationRuleInput;
  action: EscalationAction;
  /** Человекочитаемое объяснение «почему сработало» (docs/14 §5.4 — объяснимость) */
  reason: string;
}

/**
 * Проверяет одно правило против сигналов и контекста.
 * Возвращает reason, если правило сработало, иначе null.
 * Некорректные параметры (нечисловой порог, битый regex) не бросают исключений —
 * правило просто не срабатывает (сбой одного правила не должен ломать диалог).
 */
function matchRule(
  rule: EscalationRuleInput,
  signals: EscalationSignals,
  context: EscalationContext,
): string | null {
  switch (rule.type) {
    case "explicit_request":
      // docs/14 §3: флаг wants_human=true («позовите менеджера»)
      return signals.wantsHuman === true ? "explicit_request: wants_human" : null;

    case "low_confidence": {
      // docs/14 §3: confidence < threshold, строго; равенство порога НЕ срабатывает.
      const threshold = rule.params.threshold;
      if (typeof threshold !== "number") return null;
      const { confidence } = signals;
      if (confidence === undefined || typeof confidence !== "number") return null;
      return confidence < threshold
        ? `low_confidence: ${confidence} < ${threshold}`
        : null;
    }

    case "keyword": {
      // docs/14 §3: совпадение regex в сообщении посетителя.
      const patterns = rule.params.patterns;
      if (!Array.isArray(patterns)) return null;
      // Сначала валидируем все паттерны: битый regex → правило пропускается целиком,
      // чтобы частично некорректное правило не срабатывало по оставшимся паттернам.
      const compiled: Array<{ source: string; re: RegExp }> = [];
      for (const source of patterns) {
        if (typeof source !== "string") return null;
        try {
          compiled.push({ source, re: new RegExp(source) }); // без флага g — обычный .test()
        } catch {
          return null;
        }
      }
      for (const { source, re } of compiled) {
        if (re.test(context.messageText)) {
          return `keyword: совпадение /${source}/`;
        }
      }
      return null;
    }

    case "intent": {
      // docs/14 §3: detected_intent совпал (точное равенство строк).
      const expected = rule.params.intent;
      if (typeof expected !== "string") return null;
      return signals.detectedIntent === expected ? `intent: ${expected}` : null;
    }

    case "complaint":
      // docs/14 §3: флаг complaint=true
      return signals.complaint === true ? "complaint: complaint=true" : null;

    case "no_answer": {
      // docs/14 §3: N подряд fallback-ответов (>= max_fallbacks).
      const maxFallbacks = rule.params.max_fallbacks;
      if (typeof maxFallbacks !== "number") return null;
      return context.consecutiveFallbacks >= maxFallbacks
        ? `no_answer: ${context.consecutiveFallbacks} >= ${maxFallbacks}`
        : null;
    }
  }
}

/**
 * Проходит правила по возрастанию priority; возвращает первое подходящее
 * ВКЛЮЧЁННОЕ правило или null (docs/14 §5.1–5.2: first-match-wins).
 * Некорректное правило (битый regex, нечисловой порог) пропускается, а не бросает
 * исключение — сбой одного правила не должен ломать обработку диалога.
 */
export function evaluateEscalationRules(
  rules: readonly EscalationRuleInput[],
  signals: EscalationSignals,
  context: EscalationContext,
): EscalationMatch | null {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of ordered) {
    if (!rule.enabled) continue;
    const reason = matchRule(rule, signals, context);
    if (reason !== null) {
      return { rule, action: rule.action, reason };
    }
  }
  return null;
}
