import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SubmissionFreshnessBadge,
  SubmissionFreshnessBanner,
} from "../../src/components/profile/SubmissionFreshness";

const staleFreshness = {
  lastUpdated: "2026-01-10T10:00:00.000Z",
  cliVersion: "1.4.2",
  schemaVersion: 1,
  isStale: true,
} as const;

describe("submission freshness UI", () => {
  it("renders the stale profile banner with a re-submit command", () => {
    const html = renderToStaticMarkup(
      <SubmissionFreshnessBanner freshness={staleFreshness} />
    );

    expect(html).toContain("Submission may be outdated.");
    expect(html).toContain("bunx tokscale submit");
    expect(html).toContain("Last refreshed on");
  });

  it("does not render the profile banner for fresh submissions", () => {
    const html = renderToStaticMarkup(
      <SubmissionFreshnessBanner freshness={{ ...staleFreshness, isStale: false }} />
    );

    expect(html).toBe("");
  });

  it("renders a stale badge only for stale submissions", () => {
    expect(
      renderToStaticMarkup(<SubmissionFreshnessBadge freshness={staleFreshness} />)
    ).toContain("Stale");

    expect(
      renderToStaticMarkup(
        <SubmissionFreshnessBadge freshness={{ ...staleFreshness, isStale: false }} />
      )
    ).toBe("");
  });
});
