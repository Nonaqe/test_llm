import { describe, expect, it } from "vitest";
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "./tokens";

const SECRET = "0123456789abcdef";

describe("JWT-токены сессий (docs/15 §1)", () => {
  it("access: подписан и проверяется", () => {
    const token = signAccessToken("user-1", "owner", SECRET);
    const payload = verifyAccessToken(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("user-1");
    expect(payload?.role).toBe("owner");
    expect(payload?.typ).toBe("access");
  });

  it("refresh несёт jti и typ", () => {
    const token = signRefreshToken("user-1", "jti-42", SECRET);
    const payload = verifyRefreshToken(token, SECRET);
    expect(payload?.sub).toBe("user-1");
    expect(payload?.jti).toBe("jti-42");
  });

  it("токен с неверной подписью отклоняется", () => {
    const token = signAccessToken("user-1", null, SECRET);
    expect(verifyAccessToken(token, "another-secret-16")).toBeNull();
  });

  it("access не принимается как refresh (typ-проверка)", () => {
    const access = signAccessToken("user-1", null, SECRET);
    expect(verifyRefreshToken(access, SECRET)).toBeNull();
  });

  it("refresh не принимается как access", () => {
    const refresh = signRefreshToken("user-1", "jti", SECRET);
    expect(verifyAccessToken(refresh, SECRET)).toBeNull();
  });

  it("мусорный токен отклоняется без исключения", () => {
    expect(verifyAccessToken("garbage.token.here", SECRET)).toBeNull();
  });

  it("просроченный токен отклоняется", async () => {
    const jwt = await import("jsonwebtoken");
    const expired = jwt.sign({ sub: "u", typ: "access" }, SECRET, { expiresIn: -10 });
    expect(verifyAccessToken(expired, SECRET)).toBeNull();
  });
});
