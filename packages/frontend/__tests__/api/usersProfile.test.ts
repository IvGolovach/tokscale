import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const selectResults: Array<Array<Record<string, unknown>>> = [];
  const executeResults: Array<Array<Record<string, unknown>>> = [];
  const limitCalls: unknown[] = [];

  const tables = {
    users: {
      id: "users.id",
      username: "users.username",
      displayName: "users.displayName",
      avatarUrl: "users.avatarUrl",
      createdAt: "users.createdAt",
    },
    submissions: {
      userId: "submissions.userId",
      totalTokens: "submissions.totalTokens",
      totalCost: "submissions.totalCost",
      inputTokens: "submissions.inputTokens",
      outputTokens: "submissions.outputTokens",
      cacheReadTokens: "submissions.cacheReadTokens",
      cacheCreationTokens: "submissions.cacheCreationTokens",
      reasoningTokens: "submissions.reasoningTokens",
      submitCount: "submissions.submitCount",
      dateStart: "submissions.dateStart",
      dateEnd: "submissions.dateEnd",
      sourcesUsed: "submissions.sourcesUsed",
      modelsUsed: "submissions.modelsUsed",
      updatedAt: "submissions.updatedAt",
      cliVersion: "submissions.cliVersion",
      schemaVersion: "submissions.schemaVersion",
    },
    dailyBreakdown: {
      submissionId: "dailyBreakdown.submissionId",
      date: "dailyBreakdown.date",
      timestampMs: "dailyBreakdown.timestampMs",
      tokens: "dailyBreakdown.tokens",
      cost: "dailyBreakdown.cost",
      inputTokens: "dailyBreakdown.inputTokens",
      outputTokens: "dailyBreakdown.outputTokens",
      sourceBreakdown: "dailyBreakdown.sourceBreakdown",
      modelBreakdown: "dailyBreakdown.modelBreakdown",
    },
  };

  const eq = vi.fn(() => "eq");
  const desc = vi.fn(() => "desc");
  const and = vi.fn(() => "and");
  const gte = vi.fn(() => "gte");
  const sql = Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings: Array.from(strings),
      values,
      as: () => ({}),
    })),
    {
      raw: vi.fn(),
    }
  );

  function nextSelectResult() {
    return selectResults.shift() ?? [];
  }

  const db = {
    select: vi.fn(() => {
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        innerJoin: vi.fn(() => builder),
        orderBy: vi.fn(() => builder),
        limit: vi.fn((value: unknown) => {
          limitCalls.push(value);
          return builder;
        }),
        then: (resolve: (value: unknown) => unknown) => resolve(nextSelectResult()),
      };

      return builder;
    }),
    execute: vi.fn(async () => executeResults.shift() ?? []),
  };

  return {
    db,
    tables,
    eq,
    desc,
    and,
    gte,
    sql,
    reset() {
      selectResults.length = 0;
      executeResults.length = 0;
      limitCalls.length = 0;
      db.select.mockClear();
      db.execute.mockClear();
      eq.mockClear();
      desc.mockClear();
      and.mockClear();
      gte.mockClear();
      sql.mockClear();
      sql.raw.mockClear();
    },
    pushSelectResult(rows: Array<Record<string, unknown>>) {
      selectResults.push(rows);
    },
    pushExecuteResult(rows: Array<Record<string, unknown>>) {
      executeResults.push(rows);
    },
    limitCalls,
  };
});

vi.mock("@/lib/db", () => ({
  db: mockState.db,
  users: mockState.tables.users,
  submissions: mockState.tables.submissions,
  dailyBreakdown: mockState.tables.dailyBreakdown,
}));

vi.mock("@/lib/db/usernameLookup", () => {
  class AmbiguousUsernameError extends Error {}

  return {
    AmbiguousUsernameError,
    USERNAME_LOOKUP_LIMIT: 2,
    getSingleUsernameMatch: (rows: readonly unknown[], username: string) => {
      if (rows.length > 1) {
        throw new AmbiguousUsernameError(`Multiple users match username ${username} case-insensitively`);
      }
      return rows[0] ?? null;
    },
    normalizeUsernameCacheKey: (username: string) => username.toLowerCase(),
    usernameEqualsIgnoreCase: (username: string) =>
      mockState.sql`lower(${mockState.tables.users.username}) = ${username.toLowerCase()}`,
  };
});

vi.mock("@/lib/submissionFreshness", async () =>
  import("../../src/lib/submissionFreshness")
);

vi.mock("drizzle-orm", () => ({
  eq: mockState.eq,
  desc: mockState.desc,
  sql: mockState.sql,
  and: mockState.and,
  gte: mockState.gte,
}));

type ModuleExports = typeof import("../../src/app/api/users/[username]/route");

let GET: ModuleExports["GET"];

function serializeSqlCalls(): string[] {
  return mockState.sql.mock.calls.map((call) => {
    const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
    const textParts = Array.from(strings);

    return textParts.reduce((text, part, index) => {
      const nextValue = index < values.length ? String(values[index]) : "";
      return `${text}${part}${nextValue}`;
    }, "");
  });
}

beforeAll(async () => {
  const routeModule = await import("../../src/app/api/users/[username]/route");
  GET = routeModule.GET;
});

beforeEach(() => {
  mockState.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/users/[username]", () => {
  it("redirects mixed-case requests to the canonical username path", async () => {
    mockState.pushSelectResult([
      {
        id: "user-imlunahey",
        username: "ImLunaHey",
        displayName: "Luna",
        avatarUrl: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mockState.pushSelectResult([
      {
        totalTokens: 0,
        totalCost: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        reasoningTokens: 0,
        submissionCount: 0,
        earliestDate: null,
        latestDate: null,
      },
    ]);
    mockState.pushSelectResult([]);
    mockState.pushSelectResult([]);
    mockState.pushExecuteResult([]);

    const response = await GET(
      new Request("http://localhost:3000/api/users/imlunahey"),
      { params: Promise.resolve({ username: "imlunahey" }) }
    );
    const sqlTexts = serializeSqlCalls();

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost:3000/api/users/ImLunaHey");
    expect(mockState.limitCalls[0]).toBe(2);
    expect(sqlTexts.some((text) =>
      text.toLowerCase().includes("lower(users.username) = imlunahey")
    )).toBe(true);
  });

  it("returns the profile payload when the request already uses the canonical username", async () => {
    mockState.pushSelectResult([
      {
        id: "user-imlunahey",
        username: "ImLunaHey",
        displayName: "Luna",
        avatarUrl: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mockState.pushSelectResult([
      {
        totalTokens: 0,
        totalCost: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        reasoningTokens: 0,
        submissionCount: 0,
        earliestDate: null,
        latestDate: null,
      },
    ]);
    mockState.pushSelectResult([]);
    mockState.pushSelectResult([]);
    mockState.pushExecuteResult([]);

    const response = await GET(
      new Request("http://localhost:3000/api/users/ImLunaHey"),
      { params: Promise.resolve({ username: "ImLunaHey" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.username).toBe("ImLunaHey");
  });

  it("rejects ambiguous case-insensitive username matches", async () => {
    mockState.pushSelectResult([
      {
        id: "user-1",
        username: "ImLunaHey",
        displayName: "Luna",
        avatarUrl: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "user-2",
        username: "imlunahey",
        displayName: "Luna Duplicate",
        avatarUrl: null,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ]);

    const response = await GET(
      new Request("http://localhost:3000/api/users/imlunahey"),
      { params: Promise.resolve({ username: "imlunahey" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "Username is ambiguous" });
    expect(mockState.limitCalls[0]).toBe(2);
  });

  it("returns submission freshness metadata for the latest submission", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-11T12:00:00.000Z"));

    mockState.pushSelectResult([
      {
        id: "user-1",
        username: "alice",
        displayName: "Alice",
        avatarUrl: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mockState.pushSelectResult([
      {
        totalTokens: 1200,
        totalCost: 12.5,
        inputTokens: 700,
        outputTokens: 500,
        cacheReadTokens: 100,
        cacheCreationTokens: 50,
        reasoningTokens: 25,
        submissionCount: 2,
        earliestDate: "2026-01-01",
        latestDate: "2026-03-10",
      },
    ]);
    mockState.pushSelectResult([
      {
        sourcesUsed: ["cursor"],
        modelsUsed: ["claude-3-7-sonnet"],
        updatedAt: new Date("2026-01-10T10:00:00.000Z"),
        cliVersion: "1.4.2",
        schemaVersion: 1,
      },
    ]);
    mockState.pushSelectResult([]);
    mockState.pushExecuteResult([{ rank: 3 }]);

    const response = await GET(
      new Request("http://localhost:3000/api/users/alice"),
      { params: Promise.resolve({ username: "alice" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.submissionFreshness).toEqual({
      lastUpdated: "2026-01-10T10:00:00.000Z",
      cliVersion: "1.4.2",
      schemaVersion: 1,
      isStale: true,
    });
    expect(body.updatedAt).toBe("2026-01-10T10:00:00.000Z");
    expect(body.clients).toEqual(["cursor"]);
    expect(body.models).toEqual(["claude-3-7-sonnet"]);
  });

  it("aggregates same-date rows from multiple submitted devices into one profile contribution", async () => {
    mockState.pushSelectResult([
      {
        id: "user-1",
        username: "alice",
        displayName: "Alice",
        avatarUrl: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    mockState.pushSelectResult([
      {
        totalTokens: 150,
        totalCost: 1.5,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        reasoningTokens: 0,
        submissionCount: 2,
        earliestDate: "2026-04-30",
        latestDate: "2026-04-30",
      },
    ]);
    mockState.pushSelectResult([
      {
        sourcesUsed: ["codex", "claude"],
        modelsUsed: ["gpt-5.5", "claude-sonnet-4"],
        updatedAt: new Date("2026-04-30T10:00:00.000Z"),
        cliVersion: "2.0.0",
        schemaVersion: 2,
      },
    ]);
    mockState.pushSelectResult([
      {
        date: "2026-04-30",
        timestampMs: 1_776_000_000_000,
        tokens: 100,
        cost: "1.0000",
        inputTokens: 70,
        outputTokens: 30,
        sourceBreakdown: {
          codex: {
            tokens: 100,
            cost: 1,
            input: 70,
            output: 30,
            cacheRead: 0,
            cacheWrite: 0,
            reasoning: 0,
            messages: 2,
            models: {
              "gpt-5.5": {
                tokens: 100,
                cost: 1,
                input: 70,
                output: 30,
                cacheRead: 0,
                cacheWrite: 0,
                reasoning: 0,
                messages: 2,
              },
            },
          },
        },
      },
      {
        date: "2026-04-30",
        timestampMs: 1_775_999_000_000,
        tokens: 50,
        cost: "0.5000",
        inputTokens: 30,
        outputTokens: 20,
        sourceBreakdown: {
          claude: {
            tokens: 50,
            cost: 0.5,
            input: 30,
            output: 20,
            cacheRead: 0,
            cacheWrite: 0,
            reasoning: 0,
            messages: 1,
            models: {
              "claude-sonnet-4": {
                tokens: 50,
                cost: 0.5,
                input: 30,
                output: 20,
                cacheRead: 0,
                cacheWrite: 0,
                reasoning: 0,
                messages: 1,
              },
            },
          },
        },
      },
    ]);
    mockState.pushExecuteResult([{ rank: 1 }]);

    const response = await GET(
      new Request("http://localhost:3000/api/users/alice"),
      { params: Promise.resolve({ username: "alice" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.contributions).toHaveLength(1);
    expect(body.contributions[0]).toMatchObject({
      date: "2026-04-30",
      timestampMs: 1_775_999_000_000,
      totals: {
        tokens: 150,
        cost: 1.5,
      },
      tokenBreakdown: {
        input: 100,
        output: 50,
      },
    });
    expect(body.contributions[0].clients.map((client: { client: string }) => client.client).sort()).toEqual([
      "claude",
      "codex",
    ]);
    expect(body.stats.activeDays).toBe(1);
  });

  it("returns null freshness metadata when the user has no submission yet", async () => {
    mockState.pushSelectResult([
      {
        id: "user-2",
        username: "new-user",
        displayName: null,
        avatarUrl: null,
        createdAt: "2026-03-01T00:00:00.000Z",
      },
    ]);
    mockState.pushSelectResult([
      {
        totalTokens: 0,
        totalCost: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        reasoningTokens: 0,
        submissionCount: 0,
        earliestDate: null,
        latestDate: null,
      },
    ]);
    mockState.pushSelectResult([]);
    mockState.pushSelectResult([]);
    mockState.pushExecuteResult([]);

    const response = await GET(
      new Request("http://localhost:3000/api/users/new-user"),
      { params: Promise.resolve({ username: "new-user" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.submissionFreshness).toBeNull();
    expect(body.updatedAt).toBeNull();
    expect(body.clients).toEqual([]);
    expect(body.models).toEqual([]);
  });
});
