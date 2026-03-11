import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const awaitedResults: unknown[] = [];
  const fromCalls: unknown[] = [];

  const tables = {
    users: {
      id: "users.id",
      username: "users.username",
      displayName: "users.displayName",
      avatarUrl: "users.avatarUrl",
    },
    submissions: {
      id: "submissions.id",
      userId: "submissions.userId",
      submitCount: "submissions.submitCount",
      updatedAt: "submissions.updatedAt",
      totalTokens: "submissions.totalTokens",
      totalCost: "submissions.totalCost",
      cliVersion: "submissions.cliVersion",
      schemaVersion: "submissions.schemaVersion",
      trustGeneration: "submissions.trustGeneration",
    },
    dailyBreakdown: {
      submissionId: "dailyBreakdown.submissionId",
      date: "dailyBreakdown.date",
      tokens: "dailyBreakdown.tokens",
      cost: "dailyBreakdown.cost",
    },
  };

  const eq = vi.fn(() => "eq");
  const desc = vi.fn(() => "desc");
  const and = vi.fn(() => "and");
  const gte = vi.fn(() => "gte");
  const lte = vi.fn(() => "lte");
  const inArray = vi.fn(() => "inArray");
  const sql = Object.assign(
    () => ({
      as: () => ({}),
    }),
    {
      raw: vi.fn(),
    }
  );

  const db = {
    select: vi.fn(() => {
      const builder = {
        from: vi.fn((table: unknown) => {
          fromCalls.push(table);
          return builder;
        }),
        innerJoin: vi.fn(() => builder),
        where: vi.fn(() => builder),
        groupBy: vi.fn(() => builder),
        orderBy: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        offset: vi.fn(() => builder),
        having: vi.fn(() => builder),
        as: vi.fn(() => builder),
        then: (resolve: (value: unknown) => unknown) =>
          resolve(awaitedResults.shift() ?? []),
      };

      return builder;
    }),
  };

  return {
    db,
    tables,
    fromCalls,
    eq,
    desc,
    and,
    gte,
    lte,
    inArray,
    sql,
    reset() {
      awaitedResults.length = 0;
      fromCalls.length = 0;
      db.select.mockClear();
      eq.mockClear();
      desc.mockClear();
      and.mockClear();
      gte.mockClear();
      lte.mockClear();
      inArray.mockClear();
      sql.raw.mockClear();
    },
    pushAwaitedResult(value: unknown) {
      awaitedResults.push(value);
    },
  };
});

vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));

vi.mock("@/lib/db", () => ({
  db: mockState.db,
  users: mockState.tables.users,
  submissions: mockState.tables.submissions,
  dailyBreakdown: mockState.tables.dailyBreakdown,
}));

vi.mock("@/lib/submissionFreshness", async () =>
  import("../../src/lib/submissionFreshness")
);

vi.mock("drizzle-orm", () => ({
  eq: mockState.eq,
  desc: mockState.desc,
  and: mockState.and,
  gte: mockState.gte,
  lte: mockState.lte,
  inArray: mockState.inArray,
  sql: mockState.sql,
}));

type ModuleExports = typeof import("../../src/lib/leaderboard/getLeaderboard");

let getLeaderboardData: ModuleExports["getLeaderboardData"];
let getUserRank: ModuleExports["getUserRank"];

beforeAll(async () => {
  const leaderboardModule = await import("../../src/lib/leaderboard/getLeaderboard");
  getLeaderboardData = leaderboardModule.getLeaderboardData;
  getUserRank = leaderboardModule.getUserRank;
});

beforeEach(() => {
  mockState.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("all-time leaderboard data", () => {
  it("uses the latest submission metadata for all-time leaderboard rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-11T18:45:00Z"));

    mockState.pushAwaitedResult([
      {
        rank: 1,
        userId: "user-alice",
        username: "alice",
        displayName: "Alice",
        avatarUrl: null,
        totalTokens: 3000,
        totalCost: 30,
        submissionCount: 3,
      },
      {
        rank: 2,
        userId: "user-bob",
        username: "bob",
        displayName: "Bob",
        avatarUrl: null,
        totalTokens: 1000,
        totalCost: 10,
        submissionCount: 1,
      },
    ]);
    mockState.pushAwaitedResult([
      {
        totalTokens: 4000,
        totalCost: 40,
        totalSubmissions: 4,
        uniqueUsers: 2,
      },
    ]);
    mockState.pushAwaitedResult([
      {
        userId: "user-alice",
        updatedAt: "2026-03-10T12:00:00.000Z",
        cliVersion: "2.0.10",
        schemaVersion: 1,
        trustGeneration: 1,
      },
      {
        userId: "user-alice",
        updatedAt: "2026-01-10T12:00:00.000Z",
        cliVersion: "9.9.9",
        schemaVersion: 7,
        trustGeneration: 7,
      },
      {
        userId: "user-bob",
        updatedAt: "2026-01-05T09:00:00.000Z",
        cliVersion: "1.4.2",
        schemaVersion: 0,
        trustGeneration: 0,
      },
    ]);

    const leaderboard = await getLeaderboardData("all", 1, 50, "tokens");

    expect(mockState.inArray).toHaveBeenCalledWith(
      mockState.tables.submissions.userId,
      ["user-alice", "user-bob"]
    );
    expect(leaderboard.users[0]).toMatchObject({
      rank: 1,
      username: "alice",
      lastSubmission: "2026-03-10T12:00:00.000Z",
      submissionFreshness: {
        lastUpdated: "2026-03-10T12:00:00.000Z",
        cliVersion: "2.0.10",
        schemaVersion: 1,
        trustGeneration: 1,
        currentTrustGeneration: 1,
        isStale: false,
        isOutdated: false,
      },
    });
    expect(leaderboard.users[1]).toMatchObject({
      rank: 2,
      username: "bob",
      lastSubmission: "2026-01-05T09:00:00.000Z",
      submissionFreshness: {
        lastUpdated: "2026-01-05T09:00:00.000Z",
        cliVersion: "1.4.2",
        schemaVersion: 0,
        trustGeneration: 0,
        currentTrustGeneration: 1,
        isStale: true,
        isOutdated: true,
      },
    });
    expect(leaderboard.submissionTrustPolicy).toEqual({
      rankingMode: "include-all",
      labelsAffectRanking: false,
      refreshCommand: "bunx tokscale submit",
    });
    expect(leaderboard.stats).toMatchObject({
      totalTokens: 4000,
      totalCost: 40,
      totalSubmissions: 4,
      uniqueUsers: 2,
    });
  });

  it("uses the latest submission metadata when building all-time user rank", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-11T18:45:00Z"));

    mockState.pushAwaitedResult([
      {
        id: "user-alice",
        username: "alice",
        displayName: "Alice",
        avatarUrl: null,
      },
    ]);
    mockState.pushAwaitedResult([
      {
        totalTokens: 3000,
        totalCost: 30,
        submissionCount: 3,
      },
    ]);
    mockState.pushAwaitedResult([
      {
        userId: "user-alice",
        updatedAt: "2026-03-10T12:00:00.000Z",
        cliVersion: "2.0.10",
        schemaVersion: 1,
        trustGeneration: 1,
      },
    ]);
    mockState.pushAwaitedResult([
      {
        count: 1,
      },
    ]);

    const rank = await getUserRank("alice", "all", "tokens");

    expect(rank).toMatchObject({
      rank: 2,
      username: "alice",
      totalTokens: 3000,
      totalCost: 30,
      submissionCount: 3,
      lastSubmission: "2026-03-10T12:00:00.000Z",
      submissionFreshness: {
        lastUpdated: "2026-03-10T12:00:00.000Z",
        cliVersion: "2.0.10",
        schemaVersion: 1,
        trustGeneration: 1,
        currentTrustGeneration: 1,
        isStale: false,
        isOutdated: false,
      },
    });
  });
});
