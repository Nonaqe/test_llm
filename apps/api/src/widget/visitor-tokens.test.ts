import { describe, expect, it } from "vitest";
import { signVisitorToken, verifyVisitorToken } from "./visitor-tokens";

const SECRET = "0123456789abcdef";
const claims = { vid: "v-1", sid: "s-1", pid: "p-1" };

describe("visitor JWT (docs/15 §1)", () => {
  it("подписывается и проверяется с клеймами vid/sid/pid", () => {
    const token = signVisitorToken(claims, SECRET);
    const payload = verifyVisitorToken(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.vid).toBe("v-1");
    expect(payload?.sid).toBe("s-1");
    expect(payload?.pid).toBe("p-1");
    expect(payload?.typ).toBe("visitor");
  });

  it("неверный секрет отклоняется", () => {
    expect(verifyVisitorToken(signVisitorToken(claims, SECRET), "another-secret-16")).toBeNull();
  });

  it("access-токен админки не принимается за visitor (typ)", async () => {
    const jwt = await import("jsonwebtoken");
    const alien = jwt.sign({ sub: "u", typ: "access" }, SECRET);
    expect(verifyVisitorToken(alien, SECRET)).toBeNull();
  });

  it("мусор и отсутствие обязательных клеймов отклоняются", async () => {
    expect(verifyVisitorToken("garbage", SECRET)).toBeNull();
    const jwt = await import("jsonwebtoken");
    const incomplete = jwt.sign({ typ: "visitor", vid: "v" }, SECRET); // нет sid/pid
    expect(verifyVisitorToken(incomplete, SECRET)).toBeNull();
  });
});
