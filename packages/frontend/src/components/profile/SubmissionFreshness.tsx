"use client";

import styled from "styled-components";
import {
  getSubmissionTrustState,
  type SubmissionFreshness,
  type SubmissionTrustPolicy,
} from "@/lib/submissionFreshness";

type TrustTone = "stale" | "outdated";

function formatLastUpdatedDate(lastUpdated: string): string {
  return new Date(lastUpdated).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getTrustTone(freshness: SubmissionFreshness): TrustTone {
  return freshness.isOutdated ? "outdated" : "stale";
}

function getBannerTitle(freshness: SubmissionFreshness): string {
  switch (getSubmissionTrustState(freshness)) {
    case "stale":
      return "Submission is stale.";
    case "outdated":
      return "Submission is outdated.";
    case "stale-outdated":
      return "Submission is stale and outdated.";
    default:
      return "Submission is current.";
  }
}

function getBannerBody(freshness: SubmissionFreshness): string {
  switch (getSubmissionTrustState(freshness)) {
    case "stale":
      return "These totals have not been refreshed recently.";
    case "outdated":
      return "These totals were computed before the current trust generation and may not reflect the latest parser or pricing corrections.";
    case "stale-outdated":
      return "These totals have not been refreshed recently and were computed before the current trust generation.";
    default:
      return "";
  }
}

function getPolicyLine(policy: SubmissionTrustPolicy): string {
  if (policy.rankingMode === "include-all" && policy.labelsAffectRanking === false) {
    return "Stale and outdated submissions remain ranked until refreshed. Labels are informational only.";
  }

  return "";
}

function getBadgeTitle(freshness: SubmissionFreshness): string {
  const facts = [`Last refreshed on ${formatLastUpdatedDate(freshness.lastUpdated)}.`];

  if (freshness.isStale) {
    facts.unshift("This submission has not been refreshed recently.");
  }

  if (freshness.isOutdated) {
    facts.push(
      `Computed under trust generation ${freshness.trustGeneration} while the current generation is ${freshness.currentTrustGeneration}.`
    );
  }

  return facts.join(" ");
}

export function SubmissionFreshnessBanner({
  freshness,
  policy,
}: {
  freshness: SubmissionFreshness | null;
  policy: SubmissionTrustPolicy;
}) {
  if (!freshness || getSubmissionTrustState(freshness) === "fresh") {
    return null;
  }

  const tone = getTrustTone(freshness);
  const policyLine = getPolicyLine(policy);

  return (
    <BannerWrapper
      $tone={tone}
      role="status"
      aria-live="polite"
      data-submission-freshness-banner={getSubmissionTrustState(freshness)}
    >
      <BannerContent>
        <BannerTitle>{getBannerTitle(freshness)}</BannerTitle>
        <BannerText>
          {getBannerBody(freshness)} Run <BannerCode>{policy.refreshCommand}</BannerCode> to refresh the totals shown on this profile.
        </BannerText>
        <BannerMeta>Last refreshed on {formatLastUpdatedDate(freshness.lastUpdated)}.</BannerMeta>
        {freshness.isOutdated && (
          <BannerMeta>
            Computed under trust generation {freshness.trustGeneration}; current generation is {freshness.currentTrustGeneration}.
          </BannerMeta>
        )}
        {policyLine && <BannerPolicy>{policyLine}</BannerPolicy>}
      </BannerContent>
    </BannerWrapper>
  );
}

export function SubmissionFreshnessBadge({
  freshness,
}: {
  freshness: SubmissionFreshness | null;
}) {
  if (!freshness || getSubmissionTrustState(freshness) === "fresh") {
    return null;
  }

  return (
    <BadgeList aria-label="Submission trust state">
      {freshness.isOutdated && (
        <Badge
          $tone="outdated"
          data-submission-freshness-badge="outdated"
          title={getBadgeTitle(freshness)}
          aria-label="Outdated submission"
        >
          Outdated
        </Badge>
      )}
      {freshness.isStale && (
        <Badge
          $tone="stale"
          data-submission-freshness-badge="stale"
          title={getBadgeTitle(freshness)}
          aria-label="Stale submission"
        >
          Stale
        </Badge>
      )}
    </BadgeList>
  );
}

export function SubmissionTrustPolicyNotice({
  policy,
}: {
  policy: SubmissionTrustPolicy;
}) {
  const policyLine = getPolicyLine(policy);

  if (!policyLine) {
    return null;
  }

  return <PolicyNotice>{policyLine}</PolicyNotice>;
}

const BannerWrapper = styled.div<{ $tone: TrustTone }>`
  background-color: ${({ $tone }) =>
    $tone === "outdated" ? "rgba(248, 113, 113, 0.1)" : "rgba(245, 158, 11, 0.1)"};
  border-bottom: 1px solid
    ${({ $tone }) =>
      $tone === "outdated" ? "rgba(248, 113, 113, 0.22)" : "rgba(245, 158, 11, 0.2)"};
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
  color: #f8fafc;
`;

const BannerText = styled.p`
  margin-top: 4px;
  font-size: 14px;
  color: rgba(248, 250, 252, 0.92);
`;

const BannerMeta = styled.p`
  margin-top: 6px;
  font-size: 12px;
  color: rgba(248, 250, 252, 0.72);
`;

const BannerPolicy = styled.p`
  margin-top: 6px;
  font-size: 12px;
  color: rgba(248, 250, 252, 0.84);
`;

const BannerCode = styled.code`
  padding: 2px 6px;
  border-radius: 4px;
  background-color: rgba(245, 158, 11, 0.2);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
`;

const PolicyNotice = styled.p`
  margin-bottom: 20px;
  font-size: 13px;
  color: var(--color-fg-muted);
`;

const BadgeList = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

const Badge = styled.span<{ $tone: TrustTone }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 9999px;
  border: 1px solid
    ${({ $tone }) =>
      $tone === "outdated" ? "rgba(248, 113, 113, 0.4)" : "rgba(245, 158, 11, 0.35)"};
  background-color: ${({ $tone }) =>
    $tone === "outdated" ? "rgba(248, 113, 113, 0.12)" : "rgba(245, 158, 11, 0.12)"};
  color: ${({ $tone }) => ($tone === "outdated" ? "#fca5a5" : "#fbbf24")};
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;
