import { describe, expect, it } from "vitest";
import {
  ConversationState,
  DocumentStatus,
  HandoffStatus,
  MessageRole,
} from "../index";

describe("@uni-chat/shared контракты", () => {
  it("состояния диалога соответствуют state machine docs/13 §1", () => {
    expect(Object.values(ConversationState)).toEqual([
      "NEW",
      "AI_ACTIVE",
      "WAITING_OPERATOR",
      "OPERATOR_ACTIVE",
      "RESOLVED",
      "CLOSED",
    ]);
  });

  it("роли сообщений соответствуют схеме docs/06 §3", () => {
    expect(Object.values(MessageRole)).toEqual([
      "visitor",
      "assistant",
      "operator",
      "system",
      "note",
    ]);
  });

  it("статусы документов соответствуют ingest-пайплайну docs/12 §2", () => {
    expect(Object.values(DocumentStatus)).toEqual([
      "pending",
      "parsing",
      "indexing",
      "ready",
      "failed",
    ]);
  });

  it("статусы handoff соответствуют docs/14 §3", () => {
    expect(Object.values(HandoffStatus)).toEqual([
      "pending",
      "accepted",
      "resolved",
      "cancelled",
    ]);
  });
});
