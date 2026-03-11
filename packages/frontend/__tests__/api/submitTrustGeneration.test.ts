import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const authenticatePersonalToken = vi.fn();
  const validateSubmission = vi.fn();
  const generateSubmissionHash = vi.fn(() => "submission-hash");
  const revalidateTag = vi.fn();
  const eq = vi.fn(() => "eq");
  const inArray = vi.fn(() => "inArray");
  const sql = Object.assign(
    (_strings: TemplateStringsArray, ...values: unknown[]) => ({
      values,
      as: () => ({}),
    }),
    {
      join: vi.fn(() => []),
    }
  );

  const tables = {
    apiTokens: {
      id: "apiTokens.id",
    },
    submissions: {
      id: "submissions.id",
      userId: "submissions.userId",
      schemaVersion: "submissions.schemaVersion",
    },
    dailyBreakdown: {
      id: "dailyBreakdown.id",
      submissionId: "dailyBreakdown.submissionId",
      date: "dailyBreakdown.date",
      tokens: "dailyBreakdown.tokens",
      cost: "dailyBreakdown.cost",
      inputTokens: "dailyBreakdown.inputTokens",
      outputTokens: "dailyBreakdown.outputTokens",
      timestampMs: "dailyBreakdown.timestampMs",
      sourceBreakdown: "dailyBreakdown.sourceBreakdown",
      modelBreakdown: "dailyBreakdown.modelBreakdown",
    },
  };

  const selectResults: Array<Array<Record<string, unknown>>> = [];
  const submissionInserts: Array<Record<string, unknown>> = [];
  const submissionUpdates: Array<Record<string, unknown>> = [];
  const dailyBreakdownInserts: Array<Array<Record<string, unknown>>> = [];

  function nextSelectResult() {
    return selectResults.shift() ?? [];
  }

  const tx = {
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => {
        if (table === tables.submissions) {
          submissionUpdates.push(values);
        }

        return {
          where: vi.fn(async () => undefined),
        };
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown> | Array<Record<string, unknown>>) => {
        if (table === tables.submissions) {
          submissionInserts.push(values as Record<string, unknown>);
          return {
            returning: vi.fn(async () => [{ id: "submission-1" }]),
          };
        }

        if (table === tables.dailyBreakdown) {
          dailyBreakdownInserts.push(values as Array<Record<string, unknown>>);
          return Promise.resolve();
        }

        return Promise.resolve();
      }),
    })),
    select: vi.fn(() => {
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        for: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        then: (resolve: (value: unknown) => unknown) => resolve(nextSelectResult()),
      };

      return builder;
    }),
    delete: vi.fn(() => ({
      where: vi.fn(async () => undefined),
    })),
    execute: vi.fn(async () => undefined),
  };

  const db = {
    transaction: vi.fn(async (callback: (innerTx: typeof tx) => Promise<unknown>) => callback(tx)),
  };

  return {
    authenticatePersonalToken,
    validateSubmission,
    generateSubmissionHash,
    revalidateTag,
    eq,
    inArray,
    sql,
    tables,
    db,
    submissionInserts,
    submissionUpdates,
    dailyBreakdownInserts,
    reset() {
      authenticatePersonalToken.mockReset();
      validateSubmission.mockReset();
      generateSubmissionHash.mockClear();
      revalidateTag.mockClear();
      eq.mockClear();
      inArray.mockClear();
      sql.join.mockClear();
      db.transaction.mockClear();
      tx.update.mockClear();
      tx.insert.mockClear();
      tx.select.mockClear();
      tx.delete.mockClear();
      tx.execute.mockClear();
      selectResults.length = 0;
      submissionInserts.length = 0;
      submissionUpdates.length = 0;
      dailyBreakdownInserts.length = 0;
    },
    pushSelectResult(rows: Array<Record<string, unknown>>) {
      selectResults.push(rows);
    },
  };
});

vi.mock("next/cache", () => ({
  revalidateTag: mockState.revalidateTag,
}));

vi.mock("@/lib/auth/personalTokens", () => ({
  authenticatePersonalToken: mockState.authenticatePersonalToken,
}));

vi.mock("@/lib/db", () => ({
  db: mockState.db,
  apiTokens: mockState.tables.apiTokens,
  submissions: mockState.tables.submissions,
  dailyBreakdown: mockState.tables.dailyBreakdown,
}));

vi.mock("@/lib/validation/submission", () => ({
  validateSubmission: mockState.validateSubmission,
  generateSubmissionHash: mockState.generateSubmissionHash,
}));

vi.mock("@/lib/db/helpers", async () =>
  import("../../src/lib/db/helpers")
);

vi.mock("@/lib/submissionFreshness", async () =>
  import("../../src/lib/submissionFreshness")
);

vi.mock("drizzle-orm", () => ({
  eq: mockState.eq,
  inArray: mockState.inArray,
  sql: mockState.sql,
}));

type ModuleExports = typeof import("../../src/app/api/submit/route");

let POST: ModuleExports["POST"];

beforeAll(async () => {
  const routeModule = await import("../../src/app/api/submit/route");
  POST = routeModule.POST;
});

beforeEach(() => {
  mockState.reset();
});

describe("POST /api/submit trust generation", () => {
  it("stores the current trust generation on new submissions and resubmits", async () => {
    mockState.authenticatePersonalToken.mockResolvedValue({
      status: "valid",
      tokenId: "token-1",
      userId: "user-1",
      username: "alice",
    });
    mockState.validateSubmission.mockReturnValue({
      valid: true,
      warnings: [],
      errors: [],
      data: {
        meta: {
          generatedAt: "2026-03-11T10:00:00.000Z",
          version: "2.0.10",
          dateRange: {
            start: "2026-03-01",
            end: "2026-03-01",
          },
        },
        summary: {
          totalTokens: 1500,
          totalCost: 10,
          totalDays: 1,
          activeDays: 1,
          averagePerDay: 10,
          maxCostInSingleDay: 10,
          clients: ["claude"],
          models: ["claude-sonnet-4-20250514"],
        },
        years: [],
        contributions: [
          {
            date: "2026-03-01",
            timestampMs: 1709280000000,
            totals: {
              tokens: 1500,
              cost: 10,
              messages: 5,
            },
            intensity: 2,
            tokenBreakdown: {
              input: 1000,
              output: 500,
              cacheRead: 0,
              cacheWrite: 0,
              reasoning: 0,
            },
            clients: [
              {
                client: "claude",
                modelId: "claude-sonnet-4-20250514",
                tokens: {
                  input: 1000,
                  output: 500,
                  cacheRead: 0,
                  cacheWrite: 0,
                  reasoning: 0,
                },
                cost: 10,
                messages: 5,
              },
            ],
          },
        ],
      },
    });

    mockState.pushSelectResult([]);
    mockState.pushSelectResult([]);
    mockState.pushSelectResult([
      {
        totalTokens: 1500,
        totalCost: "10.0000",
        inputTokens: 1000,
        outputTokens: 500,
        dateStart: "2026-03-01",
        dateEnd: "2026-03-01",
        activeDays: 1,
        rowCount: 1,
      },
    ]);
    mockState.pushSelectResult([
      {
        sourceBreakdown: {
          claude: {
            tokens: 1500,
            cost: 10,
            input: 1000,
            output: 500,
            cacheRead: 0,
            cacheWrite: 0,
            reasoning: 0,
            messages: 5,
            models: {
              "claude-sonnet-4-20250514": {
                tokens: 1500,
                cost: 10,
                input: 1000,
                output: 500,
                cacheRead: 0,
                cacheWrite: 0,
                reasoning: 0,
                messages: 5,
              },
            },
          },
        },
      },
    ]);

    const response = await POST(
      new Request("http://localhost:3000/api/submit", {
        method: "POST",
        headers: {
          Authorization: "Bearer tt_valid",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ok: true }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mode).toBe("create");
    expect(mockState.submissionInserts[0]).toMatchObject({
      cliVersion: "2.0.10",
      trustGeneration: 1,
    });
    const submissionUpdate = mockState.submissionUpdates.find(
      (values) => "trustGeneration" in values
    );
    expect(submissionUpdate).toMatchObject({
      cliVersion: "2.0.10",
      trustGeneration: 1,
    });
    expect(mockState.dailyBreakdownInserts).toHaveLength(1);
  });
});
