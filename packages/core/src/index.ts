/**
 * @uni-chat/core — доменное ядро (чистый TypeScript, без фреймворков; ADR-001/008).
 * Используется процессами api и worker. Границы — docs/04 §4.
 */
export * from "./conversation/state-machine";
export * from "./rbac/rbac";
export * from "./ai/provider";
export * from "./ai/prompt-builder";
export * from "./ai/structured-output";
export * from "./ai/fake-provider";
export * from "./rag/chunker";
export * from "./rag/rrf";
