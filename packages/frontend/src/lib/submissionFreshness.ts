export const DEFAULT_SUBMISSION_FRESHNESS_DAYS = 30;
export const CURRENT_SUBMISSION_TRUST_GENERATION = 1;
export const SUBMISSION_REFRESH_COMMAND = "bunx tokscale submit";

export interface SubmissionTrustPolicy {
  rankingMode: "include-all";
  labelsAffectRanking: false;
  refreshCommand: typeof SUBMISSION_REFRESH_COMMAND;
}

const DEFAULT_SUBMISSION_TRUST_POLICY: SubmissionTrustPolicy = Object.freeze({
  rankingMode: "include-all",
  labelsAffectRanking: false,
  refreshCommand: SUBMISSION_REFRESH_COMMAND,
});

export interface SubmissionFreshness {
  lastUpdated: string;
  cliVersion: string | null;
  schemaVersion: number;
  trustGeneration: number;
  currentTrustGeneration: number;
  isStale: boolean;
  isOutdated: boolean;
}

interface SubmissionFreshnessInput {
  updatedAt: Date | string | null | undefined;
  cliVersion?: string | null;
  schemaVersion?: number | null;
  trustGeneration?: number | null;
}

export type SubmissionTrustState =
  | "fresh"
  | "stale"
  | "outdated"
  | "stale-outdated";

function normalizeTrustGeneration(value: number | null | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

export function getSubmissionTrustPolicy(): SubmissionTrustPolicy {
  return DEFAULT_SUBMISSION_TRUST_POLICY;
}

export function getSubmissionFreshnessWindowDays(): number {
  const rawValue = process.env.SUBMISSION_FRESHNESS_DAYS;
  if (!rawValue) {
    return DEFAULT_SUBMISSION_FRESHNESS_DAYS;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SUBMISSION_FRESHNESS_DAYS;
  }

  return Math.max(1, Math.floor(parsed));
}

export function isSubmissionStale(
  updatedAt: Date | string,
  now: Date = new Date(),
  freshnessWindowDays: number = getSubmissionFreshnessWindowDays()
): boolean {
  const updatedAtDate = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  const updatedAtTime = updatedAtDate.getTime();

  if (Number.isNaN(updatedAtTime)) {
    return false;
  }

  const freshnessWindowMs = freshnessWindowDays * 24 * 60 * 60 * 1000;
  return now.getTime() - updatedAtTime > freshnessWindowMs;
}

export function isSubmissionOutdated(
  trustGeneration: number | null | undefined,
  currentTrustGeneration: number = CURRENT_SUBMISSION_TRUST_GENERATION
): boolean {
  return normalizeTrustGeneration(trustGeneration) < normalizeTrustGeneration(currentTrustGeneration);
}

export function getSubmissionTrustState(
  freshness: Pick<SubmissionFreshness, "isStale" | "isOutdated"> | null | undefined
): SubmissionTrustState {
  if (!freshness?.isStale && !freshness?.isOutdated) {
    return "fresh";
  }

  if (freshness.isStale && freshness.isOutdated) {
    return "stale-outdated";
  }

  return freshness.isOutdated ? "outdated" : "stale";
}

export function buildSubmissionFreshness(
  input: SubmissionFreshnessInput | null | undefined,
  now: Date = new Date(),
  freshnessWindowDays: number = getSubmissionFreshnessWindowDays(),
  currentTrustGeneration: number = CURRENT_SUBMISSION_TRUST_GENERATION
): SubmissionFreshness | null {
  if (!input?.updatedAt) {
    return null;
  }

  const updatedAtDate = input.updatedAt instanceof Date
    ? input.updatedAt
    : new Date(input.updatedAt);

  if (Number.isNaN(updatedAtDate.getTime())) {
    return null;
  }

  const updatedAt = updatedAtDate.toISOString();
  const trustGeneration = normalizeTrustGeneration(input.trustGeneration);

  return {
    lastUpdated: updatedAt,
    cliVersion: input.cliVersion ?? null,
    schemaVersion: input.schemaVersion ?? 0,
    trustGeneration,
    currentTrustGeneration: normalizeTrustGeneration(currentTrustGeneration),
    isStale: isSubmissionStale(updatedAt, now, freshnessWindowDays),
    isOutdated: isSubmissionOutdated(trustGeneration, currentTrustGeneration),
  };
}
