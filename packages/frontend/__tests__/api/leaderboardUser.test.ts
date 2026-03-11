import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const getUserRank = vi.fn();

vi.mock("@/lib/leaderboard/getLeaderboard", () => ({
  getUserRank,
}));

vi.mock("@/lib/validation/username", () => ({
  isValidGitHubUsername: (username: string) => !username.includes(" "),
}));

type ModuleExports = typeof import("../../src/app/api/leaderboard/user/[username]/route");

let GET: ModuleExports["GET"];

beforeAll(async () => {
  const routeModule = await import("../../src/app/api/leaderboard/user/[username]/route");
  GET = routeModule.GET;
});

beforeEach(() => {
  getUserRank.mockReset();
});

describe("GET /api/leaderboard/user/[username]", () => {
  it("passes trust metadata through unchanged for a valid user", async () => {
    getUserRank.mockResolvedValue({
      rank: 7,
      userId: "user-1",
      username: "alice",
      displayName: "Alice",
      avatarUrl: null,
      totalTokens: 1200,
      totalCost: 12.5,
      submissionCount: 2,
      lastSubmission: "2026-01-10T10:00:00.000Z",
      submissionFreshness: {
        lastUpdated: "2026-01-10T10:00:00.000Z",
        cliVersion: "1.4.2",
        schemaVersion: 1,
        trustGeneration: 0,
        currentTrustGeneration: 1,
        isStale: true,
        isOutdated: true,
      },
    });

    const response = await GET(
      new Request("http://localhost:3000/api/leaderboard/user/alice?period=all&sortBy=tokens") as never,
      { params: Promise.resolve({ username: "alice" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getUserRank).toHaveBeenCalledWith("alice", "all", "tokens");
    expect(body.submissionFreshness).toEqual({
      lastUpdated: "2026-01-10T10:00:00.000Z",
      cliVersion: "1.4.2",
      schemaVersion: 1,
      trustGeneration: 0,
      currentTrustGeneration: 1,
      isStale: true,
      isOutdated: true,
    });
  });

  it("rejects invalid usernames before querying rank data", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/leaderboard/user/not valid") as never,
      { params: Promise.resolve({ username: "not valid" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Invalid username format" });
    expect(getUserRank).not.toHaveBeenCalled();
  });

  it("returns 404 when the user has no rank data", async () => {
    getUserRank.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost:3000/api/leaderboard/user/alice?period=all&sortBy=tokens") as never,
      { params: Promise.resolve({ username: "alice" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "User not found or has no submissions" });
  });
});
