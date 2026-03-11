"use client";

import styled from "styled-components";
import type { SubmissionFreshness } from "@/lib/submissionFreshness";

function formatLastUpdatedDate(lastUpdated: string): string {
  return new Date(lastUpdated).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function SubmissionFreshnessBanner({
  freshness,
}: {
  freshness: SubmissionFreshness | null;
}) {
  if (!freshness?.isStale) {
    return null;
  }

  return (
    <BannerWrapper role="status" aria-live="polite" data-submission-freshness-banner="stale">
      <BannerContent>
        <BannerTitle>Submission may be outdated.</BannerTitle>
        <BannerText>
          Re-run <BannerCode>bunx tokscale submit</BannerCode> to refresh the totals shown on this profile.
        </BannerText>
        <BannerMeta>Last refreshed on {formatLastUpdatedDate(freshness.lastUpdated)}.</BannerMeta>
      </BannerContent>
    </BannerWrapper>
  );
}

export function SubmissionFreshnessBadge({
  freshness,
}: {
  freshness: SubmissionFreshness | null;
}) {
  if (!freshness?.isStale) {
    return null;
  }

  return (
    <Badge
      data-submission-freshness-badge="stale"
      title={`Last refreshed on ${formatLastUpdatedDate(freshness.lastUpdated)}`}
      aria-label="Stale submission"
    >
      Stale
    </Badge>
  );
}

const BannerWrapper = styled.div`
  background-color: rgba(245, 158, 11, 0.1);
  border-bottom: 1px solid rgba(245, 158, 11, 0.2);
`;

const BannerContent = styled.div`
  max-width: 800px;
  margin-left: auto;
  margin-right: auto;
  padding: 12px 16px;

  @media (min-width: 640px) {
    padding-left: 24px;
    padding-right: 24px;
  }
`;

const BannerTitle = styled.p`
  font-size: 14px;
  font-weight: 700;
  color: #fde68a;
`;

const BannerText = styled.p`
  margin-top: 4px;
  font-size: 14px;
  color: #fde68a;
`;

const BannerMeta = styled.p`
  margin-top: 6px;
  font-size: 12px;
  color: rgba(253, 230, 138, 0.85);
`;

const BannerCode = styled.code`
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba(245, 158, 11, 0.2);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 9999px;
  border: 1px solid rgba(245, 158, 11, 0.35);
  background-color: rgba(245, 158, 11, 0.12);
  color: #fbbf24;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;
