import { describe, expect, it } from "vitest";
import { fuseByRrf, RRF_K } from "../rrf";

describe("fuseByRrf (docs/06 §5)", () => {
  it("чанк в обоих списках получает сумму ранков", () => {
    const scores = fuseByRrf(["a", "b"], ["a", "c"]);
    const expected = 1 / (RRF_K + 1) + 1 / (RRF_K + 1);
    expect(scores.get("a")).toBeCloseTo(expected, 10);
  });

  it("чанк только в векторном списке получает вклад одного ранка", () => {
    const scores = fuseByRrf(["a", "b"], ["c"]);
    expect(scores.get("b")).toBeCloseTo(1 / (RRF_K + 2), 10);
    expect(scores.get("c")).toBeCloseTo(1 / (RRF_K + 1), 10);
  });

  it("более высокий ранг даёт больший вклад", () => {
    const scores = fuseByRrf(["x", "y", "z"], []);
    expect(scores.get("x")!).toBeGreaterThan(scores.get("y")!);
    expect(scores.get("y")!).toBeGreaterThan(scores.get("z")!);
  });

  it("пустые списки — пустой результат", () => {
    expect(fuseByRrf([], []).size).toBe(0);
  });

  it("детерминирован", () => {
    expect(fuseByRrf(["a", "b"], ["b", "a"])).toEqual(fuseByRrf(["a", "b"], ["b", "a"]));
  });
});
