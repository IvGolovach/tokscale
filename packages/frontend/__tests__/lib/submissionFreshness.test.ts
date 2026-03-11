import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_SUBMISSION_TRUST_GENERATION,
  DEFAULT_SUBMISSION_FRESHNESS_DAYS,
  buildSubmissionFreshness,
  getSubmissionTrustPolicy,
  getSubmissionTrustState,
  getSubmissionFreshnessWindowDays,
  isSubmissionOutdated,
  isSubmissionStale,
} from "../../src/lib/submissionFreshness";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("submission freshness", () => {
  it("marks submissions older than the default window as stale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-11T12:00:00.000Z"));

    expect(getSubmissionFreshnessWindowDays()).toBe(DEFAULT_SUBMISSION_FRESHNESS_DAYS);
    expect(isSubmissionStale("2026-02-08T11:59:59.000Z")).toBe(true);
    expect(isSubmissionStale("2026-02-09T12:00:00.000Z")).toBe(false);
  });

  it("respects the configured freshness window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-11T12:00:00.000Z"));
    vi.stubEnv("SUBMISSION_FRESHNESS_DAYS", "7");

    expect(getSubmissionFreshnessWindowDays()).toBe(7);
    expect(isSubmissionStale("2026-03-03T11:59:59.000Z")).toBe(true);
    expect(isSubmissionStale("2026-03-04T12:00:00.000Z")).toBe(false);
  });

  it("clamps fractional positive freshness windows to at least one day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-11T12:00:00.000Z"));
    vi.stubEnv("SUBMISSION_FRESHNESS_DAYS", "0.5");

    expect(getSubmissionFreshnessWindowDays()).toBe(1);
    expect(isSubmissionStale("2026-03-10T11:59:59.000Z")).toBe(true);
    expect(isSubmissionStale("2026-03-10T12:00:00.000Z")).toBe(false);
  });

  it("builds the submission freshness payload from latest submission metadata", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-11T12:00:00.000Z"));

    expect(
      buildSubmissionFreshness({
        updatedAt: "2026-01-15T10:30:00.000Z",
        cliVersion: "1.4.2",
        schemaVersion: 1,
        trustGeneration: 0,
      })
    ).toEqual({
      lastUpdated: "2026-01-15T10:30:00.000Z",
      cliVersion: "1.4.2",
      schemaVersion: 1,
      trustGeneration: 0,
      currentTrustGeneration: CURRENT_SUBMISSION_TRUST_GENERATION,
      isStale: true,
      isOutdated: true,
    });
  });

  it("treats trust generations older than the current generation as outdated", () => {
    expect(isSubmissionOutdated(0, 1)).toBe(true);
    expect(isSubmissionOutdated(1, 1)).toBe(false);
    expect(isSubmissionOutdated(2, 1)).toBe(false);
  });

  it("keeps stale and outdated decisions independent when building freshness", () => {
    const now = new Date("2026-03-11T10:30:00.000Z");

    expect(
      buildSubmissionFreshness(
        {
          updatedAt: "2026-03-10T10:30:00.000Z",
          trustGeneration: 0,
        },
        now
      )
    ).toMatchObject({
      isStale: false,
      isOutdated: true,
    });

    expect(
      buildSubmissionFreshness(
        {
          updatedAt: "2026-01-10T10:30:00.000Z",
          trustGeneration: 1,
        },
        now
      )
    ).toMatchObject({
      isStale: true,
      isOutdated: false,
    });
  });

  it("distinguishes stale and outdated trust states", () => {
    expect(getSubmissionTrustState({ isStale: false, isOutdated: false })).toBe("fresh");
    expect(getSubmissionTrustState({ isStale: true, isOutdated: false })).toBe("stale");
    expect(getSubmissionTrustState({ isStale: false, isOutdated: true })).toBe("outdated");
    expect(getSubmissionTrustState({ isStale: true, isOutdated: true })).toBe("stale-outdated");
  });

  it("returns the default social trust policy", () => {
    expect(getSubmissionTrustPolicy()).toEqual({
      rankingMode: "include-all",
      labelsAffectRanking: false,
      refreshCommand: "bunx tokscale submit",
    });
  });
});
