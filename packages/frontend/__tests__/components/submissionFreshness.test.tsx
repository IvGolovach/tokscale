import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  SubmissionFreshnessBadge,
  SubmissionFreshnessBanner,
  SubmissionTrustPolicyNotice,
} from "../../src/components/profile/SubmissionFreshness";

vi.mock("@/lib/submissionFreshness", async () =>
  import("../../src/lib/submissionFreshness")
);

const staleFreshness = {
  lastUpdated: "2026-01-10T10:00:00.000Z",
  cliVersion: "1.4.2",
  schemaVersion: 1,
  trustGeneration: 1,
  currentTrustGeneration: 1,
  isStale: true,
  isOutdated: false,
} as const;

const outdatedFreshness = {
  ...staleFreshness,
  trustGeneration: 0,
  isStale: false,
  isOutdated: true,
} as const;

const staleAndOutdatedFreshness = {
  ...outdatedFreshness,
  isStale: true,
} as const;

const submissionTrustPolicy = {
  rankingMode: "include-all",
  labelsAffectRanking: false,
  refreshCommand: "bunx tokscale submit",
} as const;

describe("submission freshness UI", () => {
  it("renders the stale profile banner with a re-submit command", () => {
    const html = renderToStaticMarkup(
      <SubmissionFreshnessBanner freshness={staleFreshness} policy={submissionTrustPolicy} />
    );

    expect(html).toContain("Submission is stale.");
    expect(html).toContain("bunx tokscale submit");
    expect(html).toContain("Last refreshed on");
    expect(html).toContain("remain ranked until refreshed");
  });

  it("does not render the profile banner for fresh submissions", () => {
    const html = renderToStaticMarkup(
      <SubmissionFreshnessBanner
        freshness={{ ...staleFreshness, isStale: false }}
        policy={submissionTrustPolicy}
      />
    );

    expect(html).toBe("");
  });

  it("renders an outdated profile banner with trust-generation details", () => {
    const html = renderToStaticMarkup(
      <SubmissionFreshnessBanner freshness={outdatedFreshness} policy={submissionTrustPolicy} />
    );

    expect(html).toContain("Submission is outdated.");
    expect(html).toContain("current trust generation");
    expect(html).toContain("Computed under trust generation 0");
  });

  it("renders trust badges for stale and outdated submissions", () => {
    expect(
      renderToStaticMarkup(<SubmissionFreshnessBadge freshness={staleFreshness} />)
    ).toContain("Stale");

    expect(
      renderToStaticMarkup(<SubmissionFreshnessBadge freshness={outdatedFreshness} />)
    ).toContain("Outdated");

    const combined = renderToStaticMarkup(
      <SubmissionFreshnessBadge freshness={staleAndOutdatedFreshness} />
    );
    expect(combined).toContain("Outdated");
    expect(combined).toContain("Stale");

    expect(
      renderToStaticMarkup(
        <SubmissionFreshnessBadge freshness={{ ...staleFreshness, isStale: false }} />
      )
    ).toBe("");
  });

  it("renders the current leaderboard policy notice", () => {
    const html = renderToStaticMarkup(
      <SubmissionTrustPolicyNotice policy={submissionTrustPolicy} />
    );

    expect(html).toContain("Stale and outdated submissions");
    expect(html).toContain("remain ranked until refreshed");
  });
});
