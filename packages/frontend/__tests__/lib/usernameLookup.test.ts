import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: Array.from(strings),
    values,
  }));

  return {
    sql,
    reset() {
      sql.mockClear();
    },
  };
});

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  sql: mockState.sql,
}));

import {
  normalizeUsernameCacheKey,
  usernameEqualsIgnoreCase,
} from "../../src/lib/db/usernameLookup";

beforeEach(() => {
  mockState.reset();
});

describe("username lookup helpers", () => {
  it("builds an exact case-insensitive username condition", () => {
    usernameEqualsIgnoreCase("ImLunaHey");

    const [strings, column, username] = mockState.sql.mock.calls[0] as [
      TemplateStringsArray,
      unknown,
      string,
    ];

    expect(Array.from(strings)).toEqual(["LOWER(", ") = LOWER(", ")"]);
    expect(column).toBeDefined();
    expect(username).toBe("ImLunaHey");
  });

  it("normalizes username cache keys with ASCII case folding", () => {
    expect(normalizeUsernameCacheKey("ImLunaHey")).toBe("imlunahey");
  });
});
