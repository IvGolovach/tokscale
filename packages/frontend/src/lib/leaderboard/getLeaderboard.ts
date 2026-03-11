import { unstable_cache } from "next/cache";
import { db, users, submissions, dailyBreakdown } from "@/lib/db";
import { eq, desc, sql, and, gte, lte, inArray } from "drizzle-orm";
import {
  buildSubmissionFreshness,
  getSubmissionTrustPolicy,
} from "@/lib/submissionFreshness";
import type { LeaderboardData, LeaderboardUser, Period, SortBy } from "@/lib/leaderboard/types";

export type { LeaderboardData, LeaderboardUser, Period, SortBy } from "@/lib/leaderboard/types";

interface LeaderboardPeriodRow {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  tokens: number;
  cost: number;
  updatedAt: string;
  cliVersion: string | null;
  schemaVersion: number;
  trustGeneration: number;
}

interface PeriodDateRange {
  start: string;
  end: string;
}

interface PeriodLeaderboardDbRow {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  tokens: number | string | null;
  cost: number | string | null;
  updatedAt: Date | string;
  cliVersion: string | null;
  schemaVersion: number | null;
  trustGeneration: number | null;
}

interface AllTimeLeaderboardDbRow {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  totalTokens: number | string | null;
  totalCost: number | string | null;
  submissionCount: number | string | null;
}

interface SubmissionMetadataRow {
  userId: string;
  updatedAt: Date | string;
  cliVersion: string | null;
  schemaVersion: number | null;
  trustGeneration: number | null;
}

function toUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getPeriodDateRange(
  period: Period,
  now: Date = new Date()
): PeriodDateRange | null {
  if (period === "all") {
    return null;
  }

  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  if (period === "week") {
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    return {
      start: toUtcDateString(start),
      end: toUtcDateString(end),
    };
  }

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {
    start: toUtcDateString(start),
    end: toUtcDateString(end),
  };
}

function compareLeaderboardUsers(
  left: Omit<LeaderboardUser, "rank">,
  right: Omit<LeaderboardUser, "rank">,
  sortBy: SortBy
): number {
  const primary = sortBy === "cost"
    ? right.totalCost - left.totalCost
    : right.totalTokens - left.totalTokens;

  if (primary !== 0) {
    return primary;
  }

  const secondary = sortBy === "cost"
    ? right.totalTokens - left.totalTokens
    : right.totalCost - left.totalCost;

  if (secondary !== 0) {
    return secondary;
  }

  return left.username.localeCompare(right.username);
}

function aggregatePeriodRows(
  rows: LeaderboardPeriodRow[],
  sortBy: SortBy
): Array<Omit<LeaderboardUser, "rank">> {
  const usersById = new Map<string, Omit<LeaderboardUser, "rank">>();

  for (const row of rows) {
    const existing = usersById.get(row.userId);

    if (existing) {
      existing.totalTokens += row.tokens;
      existing.totalCost += row.cost;
      if (row.updatedAt > existing.lastSubmission) {
        existing.lastSubmission = row.updatedAt;
        existing.submissionFreshness = buildSubmissionFreshness({
          updatedAt: row.updatedAt,
          cliVersion: row.cliVersion,
          schemaVersion: row.schemaVersion,
          trustGeneration: row.trustGeneration,
        });
      }
      continue;
    }

    usersById.set(row.userId, {
      userId: row.userId,
      username: row.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      totalTokens: row.tokens,
      totalCost: row.cost,
      submissionCount: null,
      lastSubmission: row.updatedAt,
      submissionFreshness: buildSubmissionFreshness({
        updatedAt: row.updatedAt,
        cliVersion: row.cliVersion,
        schemaVersion: row.schemaVersion,
        trustGeneration: row.trustGeneration,
      }),
    });
  }

  return Array.from(usersById.values()).sort((left, right) =>
    compareLeaderboardUsers(left, right, sortBy)
  );
}

function buildPeriodLeaderboardData(
  rows: LeaderboardPeriodRow[],
  page: number,
  limit: number,
  period: Period,
  sortBy: SortBy = "tokens"
): LeaderboardData {
  const offset = (page - 1) * limit;
  const aggregatedUsers = aggregatePeriodRows(rows, sortBy);
  const pagedUsers = aggregatedUsers.slice(offset, offset + limit);

  return {
    users: pagedUsers.map((user, index) => ({
      ...user,
      rank: offset + index + 1,
    })),
    submissionTrustPolicy: getSubmissionTrustPolicy(),
    pagination: {
      page,
      limit,
      totalUsers: aggregatedUsers.length,
      totalPages: Math.ceil(aggregatedUsers.length / limit),
      hasNext: offset + limit < aggregatedUsers.length,
      hasPrev: page > 1,
    },
    stats: {
      totalTokens: aggregatedUsers.reduce((sum, user) => sum + user.totalTokens, 0),
      totalCost: aggregatedUsers.reduce((sum, user) => sum + user.totalCost, 0),
      // submitCount lives on the all-time submission row, so period-scoped submit totals are unavailable here.
      totalSubmissions: null,
      uniqueUsers: aggregatedUsers.length,
    },
    period,
    sortBy,
  };
}

function buildPeriodUserRank(
  rows: LeaderboardPeriodRow[],
  username: string,
  sortBy: SortBy = "tokens"
): LeaderboardUser | null {
  const aggregatedUsers = aggregatePeriodRows(rows, sortBy);
  const userIndex = aggregatedUsers.findIndex((user) => user.username === username);

  if (userIndex === -1) {
    return null;
  }

  return {
    ...aggregatedUsers[userIndex],
    rank: userIndex + 1,
  };
}

async function fetchPeriodLeaderboardRows(
  period: Exclude<Period, "all">
): Promise<LeaderboardPeriodRow[]> {
  const dateRange = getPeriodDateRange(period);

  if (!dateRange) {
    return [];
  }

  const rows: PeriodLeaderboardDbRow[] = await db
    .select({
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      tokens: dailyBreakdown.tokens,
      cost: dailyBreakdown.cost,
      updatedAt: submissions.updatedAt,
      cliVersion: submissions.cliVersion,
      schemaVersion: submissions.schemaVersion,
      trustGeneration: submissions.trustGeneration,
    })
    .from(dailyBreakdown)
    .innerJoin(submissions, eq(dailyBreakdown.submissionId, submissions.id))
    .innerJoin(users, eq(submissions.userId, users.id))
    .where(
      and(
        gte(dailyBreakdown.date, dateRange.start),
        lte(dailyBreakdown.date, dateRange.end)
      )
    );

  return rows.map((row: PeriodLeaderboardDbRow) => ({
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    tokens: Number(row.tokens) || 0,
    cost: Number(row.cost) || 0,
    updatedAt: row.updatedAt instanceof Date
      ? row.updatedAt.toISOString()
      : new Date(row.updatedAt).toISOString(),
    cliVersion: row.cliVersion,
    schemaVersion: Number(row.schemaVersion) || 0,
    trustGeneration: Number(row.trustGeneration) || 0,
  }));
}

async function fetchLeaderboardData(
  period: Period,
  page: number,
  limit: number,
  sortBy: SortBy = "tokens"
): Promise<LeaderboardData> {
  if (period !== "all") {
    const rows = await fetchPeriodLeaderboardRows(period);
    return buildPeriodLeaderboardData(rows, page, limit, period, sortBy);
  }

  const offset = (page - 1) * limit;

  const orderByColumn = sortBy === "cost"
    ? sql`SUM(CAST(${submissions.totalCost} AS DECIMAL(12,4)))`
    : sql`SUM(${submissions.totalTokens})`;

  const leaderboardQuery = db
    .select({
      rank: sql<number>`ROW_NUMBER() OVER (ORDER BY ${orderByColumn} DESC)`.as("rank"),
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      totalTokens: sql<number>`SUM(${submissions.totalTokens})`.as("total_tokens"),
      totalCost: sql<number>`SUM(CAST(${submissions.totalCost} AS DECIMAL(12,4)))`.as("total_cost"),
      submissionCount: sql<number>`COALESCE(SUM(${submissions.submitCount}), 0)`.as("submission_count"),
    })
    .from(submissions)
    .innerJoin(users, eq(submissions.userId, users.id))
    .groupBy(users.id, users.username, users.displayName, users.avatarUrl)
    .orderBy(desc(orderByColumn))
    .limit(limit)
    .offset(offset);

  const [results, globalStats] = await Promise.all([
    leaderboardQuery,
    db
      .select({
        totalTokens: sql<number>`SUM(${submissions.totalTokens})`,
        totalCost: sql<number>`SUM(CAST(${submissions.totalCost} AS DECIMAL(12,4)))`,
        totalSubmissions: sql<number>`COUNT(${submissions.id})`,
        uniqueUsers: sql<number>`COUNT(DISTINCT ${submissions.userId})`,
      })
      .from(submissions),
  ]);

  const totalUsers = Number(globalStats[0]?.uniqueUsers) || 0;
  const totalPages = Math.ceil(totalUsers / limit);
  const userIds = (results as AllTimeLeaderboardDbRow[]).map((row) => row.userId);
  const latestMetadataByUserId = await fetchLatestSubmissionMetadataByUserIds(userIds);

  return {
    users: (results as AllTimeLeaderboardDbRow[]).map((row, index) => {
      const latestMetadata = latestMetadataByUserId.get(row.userId);

      return {
        rank: offset + index + 1,
        userId: row.userId,
        username: row.username,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        totalTokens: Number(row.totalTokens) || 0,
        totalCost: Number(row.totalCost) || 0,
        submissionCount: Number(row.submissionCount) || 0,
        lastSubmission: latestMetadata?.updatedAt ?? "",
        submissionFreshness: buildSubmissionFreshness({
          updatedAt: latestMetadata?.updatedAt,
          cliVersion: latestMetadata?.cliVersion,
          schemaVersion: latestMetadata?.schemaVersion,
          trustGeneration: latestMetadata?.trustGeneration,
        }),
      };
    }),
    submissionTrustPolicy: getSubmissionTrustPolicy(),
    pagination: {
      page,
      limit,
      totalUsers,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
    stats: {
      totalTokens: Number(globalStats[0]?.totalTokens) || 0,
      totalCost: Number(globalStats[0]?.totalCost) || 0,
      totalSubmissions: Number(globalStats[0]?.totalSubmissions) || 0,
      uniqueUsers: Number(globalStats[0]?.uniqueUsers) || 0,
    },
    period,
    sortBy,
  };
}

export function getLeaderboardData(
  period: Period = "all",
  page: number = 1,
  limit: number = 50,
  sortBy: SortBy = "tokens"
): Promise<LeaderboardData> {
  return unstable_cache(
    () => fetchLeaderboardData(period, page, limit, sortBy),
    [`leaderboard:${period}:${page}:${limit}:${sortBy}`],
    {
      tags: ["leaderboard", `leaderboard:${period}`],
      revalidate: 60,
    }
  )();
}

// ============================================================================
// USER RANK
// ============================================================================

async function fetchUserRank(
  username: string,
  period: Period,
  sortBy: SortBy
): Promise<LeaderboardUser | null> {
  if (period !== "all") {
    const rows = await fetchPeriodLeaderboardRows(period);
    return buildPeriodUserRank(rows, username, sortBy);
  }

  const userResult = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (userResult.length === 0) {
    return null;
  }

  const user = userResult[0];

  const userStatsResult = await db
    .select({
      totalTokens: sql<number>`SUM(${submissions.totalTokens})`.as("total_tokens"),
      totalCost: sql<number>`SUM(CAST(${submissions.totalCost} AS DECIMAL(12,4)))`.as("total_cost"),
      submissionCount: sql<number>`COALESCE(SUM(${submissions.submitCount}), 0)`.as("submission_count"),
    })
    .from(submissions)
    .where(eq(submissions.userId, user.id));

  if (!userStatsResult[0] || userStatsResult[0].totalTokens == null) {
    return null;
  }

  const userStats = userStatsResult[0];
  const latestSubmissionResult = await db
    .select({
      userId: submissions.userId,
      updatedAt: submissions.updatedAt,
      cliVersion: submissions.cliVersion,
      schemaVersion: submissions.schemaVersion,
      trustGeneration: submissions.trustGeneration,
    })
    .from(submissions)
    .where(eq(submissions.userId, user.id))
    .orderBy(desc(submissions.updatedAt))
    .limit(1);

  const latestSubmission = latestSubmissionResult[0];
  const userTotalTokens = Number(userStats.totalTokens);
  const userTotalCost = userStats.totalCost != null ? Number(userStats.totalCost) : 0;

  const userCompareValue = sortBy === "cost" ? userTotalCost : userTotalTokens;
  const compareColumn = sortBy === "cost"
    ? sql`SUM(CAST(${submissions.totalCost} AS DECIMAL(12,4)))`
    : sql`SUM(${submissions.totalTokens})`;

  const higherRankedResult = await db
    .select({
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(
      db
        .select({
          userId: submissions.userId,
          total: compareColumn.as("total"),
        })
        .from(submissions)
        .groupBy(submissions.userId)
        .having(sql`${compareColumn} > ${userCompareValue}`)
        .as("higher_ranked")
    );

  const rank = Number(higherRankedResult[0]?.count || 0) + 1;

  return {
    rank,
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    totalTokens: userTotalTokens,
    totalCost: userTotalCost,
    submissionCount: Number(userStats.submissionCount) || 0,
    lastSubmission: latestSubmission?.updatedAt instanceof Date
      ? latestSubmission.updatedAt.toISOString()
      : latestSubmission?.updatedAt ?? "",
    submissionFreshness: buildSubmissionFreshness({
      updatedAt: latestSubmission?.updatedAt,
      cliVersion: latestSubmission?.cliVersion,
      schemaVersion: latestSubmission?.schemaVersion,
      trustGeneration: latestSubmission?.trustGeneration,
    }),
  };
}

async function fetchLatestSubmissionMetadataByUserIds(
  userIds: string[]
): Promise<Map<string, {
  updatedAt: string;
  cliVersion: string | null;
  schemaVersion: number | null;
  trustGeneration: number | null;
}>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const rows: SubmissionMetadataRow[] = await db
    .select({
      userId: submissions.userId,
      updatedAt: submissions.updatedAt,
      cliVersion: submissions.cliVersion,
      schemaVersion: submissions.schemaVersion,
      trustGeneration: submissions.trustGeneration,
    })
    .from(submissions)
    .where(inArray(submissions.userId, userIds))
    .orderBy(desc(submissions.updatedAt));

  const latestByUserId = new Map<string, {
    updatedAt: string;
    cliVersion: string | null;
    schemaVersion: number | null;
    trustGeneration: number | null;
  }>();

  for (const row of rows) {
    if (latestByUserId.has(row.userId)) {
      continue;
    }

    latestByUserId.set(row.userId, {
      updatedAt: row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : new Date(row.updatedAt).toISOString(),
      cliVersion: row.cliVersion,
      schemaVersion: row.schemaVersion,
      trustGeneration: row.trustGeneration,
    });
  }

  return latestByUserId;
}

export function getUserRank(
  username: string,
  period: Period = "all",
  sortBy: SortBy = "tokens"
): Promise<LeaderboardUser | null> {
  return unstable_cache(
    () => fetchUserRank(username, period, sortBy),
    [`user-rank:${username}:${period}:${sortBy}`],
    {
      tags: ["leaderboard", "user-rank", `user-rank:${username}`],
      revalidate: 60,
    }
  )();
}
