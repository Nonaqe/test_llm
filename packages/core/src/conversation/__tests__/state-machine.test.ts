import { describe, expect, it } from "vitest";
import { ConversationState } from "@uni-chat/shared";
import {
  allowedTransitions,
  assertTransition,
  canTransition,
  InvalidStateTransitionError,
} from "../state-machine";

const S = ConversationState;

describe("conversation state machine (docs/13 §1)", () => {
  it("NEW → AI_ACTIVE при первом сообщении", () => {
    expect(canTransition(S.New, S.AiActive)).toBe(true);
  });

  it("AI_ACTIVE → WAITING_OPERATOR при handoff", () => {
    expect(canTransition(S.AiActive, S.WaitingOperator)).toBe(true);
  });

  it("WAITING_OPERATOR → OPERATOR_ACTIVE при принятии оператором", () => {
    expect(canTransition(S.WaitingOperator, S.OperatorActive)).toBe(true);
  });

  it("WAITING_OPERATOR → AI_ACTIVE при отмене/таймауте возврата", () => {
    expect(canTransition(S.WaitingOperator, S.AiActive)).toBe(true);
  });

  it("WAITING_OPERATOR → RESOLVED при офлайн-заявке", () => {
    expect(canTransition(S.WaitingOperator, S.Resolved)).toBe(true);
  });

  it("OPERATOR_ACTIVE → AI_ACTIVE при возврате чата AI", () => {
    expect(canTransition(S.OperatorActive, S.AiActive)).toBe(true);
  });

  it("OPERATOR_ACTIVE → RESOLVED при закрытии оператором", () => {
    expect(canTransition(S.OperatorActive, S.Resolved)).toBe(true);
  });

  it("RESOLVED → CLOSED и RESOLVED → AI_ACTIVE (reopen)", () => {
    expect(canTransition(S.Resolved, S.Closed)).toBe(true);
    expect(canTransition(S.Resolved, S.AiActive)).toBe(true);
  });

  it("CLOSED → AI_ACTIVE при reopen", () => {
    expect(canTransition(S.Closed, S.AiActive)).toBe(true);
  });

  it("AI_ACTIVE → RESOLVED по авто-таймауту неактивности", () => {
    expect(canTransition(S.AiActive, S.Resolved)).toBe(true);
  });

  // Запрещённые переходы
  it.each([
    [S.New, S.WaitingOperator],
    [S.New, S.OperatorActive],
    [S.New, S.Resolved],
    [S.OperatorActive, S.WaitingOperator],
    [S.Closed, S.Resolved],
    [S.Closed, S.OperatorActive],
    [S.WaitingOperator, S.Closed],
  ])("запрещённый переход %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(InvalidStateTransitionError);
  });

  it("assertTransition не бросает на законном переходе", () => {
    expect(() => assertTransition(S.New, S.AiActive)).not.toThrow();
  });

  it("ошибка содержит from и to (объяснимость)", () => {
    try {
      assertTransition(S.Closed, S.OperatorActive);
      expect.unreachable("должен был бросить");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidStateTransitionError);
      const err = e as InvalidStateTransitionError;
      expect(err.from).toBe(S.Closed);
      expect(err.to).toBe(S.OperatorActive);
    }
  });

  it("у каждого состояния описаны переходы", () => {
    for (const state of Object.values(S)) {
      expect(Array.isArray(allowedTransitions(state))).toBe(true);
    }
  });

  it("NEW не является целью ни одного перехода", () => {
    const all = Object.values(S);
    for (const from of all) {
      expect(allowedTransitions(from)).not.toContain(S.New);
    }
  });
});
