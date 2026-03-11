"use client";

import { useState, useMemo } from "react";
import styled from "styled-components";
import { Navigation } from "@/components/layout/Navigation";
import { Footer } from "@/components/layout/Footer";
import { SubmissionFreshnessBanner } from "@/components/profile/SubmissionFreshness";
import {
  ProfileHeader,
  ProfileTabBar,
  TokenBreakdown,
  ProfileModels,
  ProfileActivity,
  ProfileEmptyActivity,
  ProfileStats,
  type ProfileUser,
  type ProfileStatsData,
  type ProfileTab,
  type ModelUsage,
} from "@/components/profile";
import type { SubmissionFreshness } from "@/lib/submissionFreshness";
import type { TokenContributionData, DailyContribution, ClientType } from "@/lib/types";

interface ProfileData {
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    createdAt: string;
    rank: number | null;
  };
  stats: {
    totalTokens: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    submissionCount: number;
    activeDays: number;
  };
  dateRange: {
    start: string | null;
    end: string | null;
  };
  updatedAt: string | null;
  submissionFreshness: SubmissionFreshness | null;
  clients: string[];
  models: string[];
  modelUsage?: ModelUsage[];
  contributions: DailyContribution[];
}

interface ProfilePageClientProps {
  initialData: ProfileData;
}

export default function ProfilePageClient({ initialData }: ProfilePageClientProps) {
  const [activeTab, setActiveTab] = useState<ProfileTab>("activity");
  const data = initialData;

  const graphData: TokenContributionData | null = useMemo(() => {
    if (!data || data.contributions.length === 0) return null;

    const contributions = data.contributions;
    const totalCost = data.stats.totalCost;
    const totalTokens = data.stats.totalTokens;
    const maxCost = Math.max(...contributions.map((c) => c.totals.cost), 0);

    const yearMap = new Map<string, { totalTokens: number; totalCost: number; start: string; end: string }>();
    for (const day of contributions) {
      const year = day.date.split("-")[0];
      const existing = yearMap.get(year);
      if (existing) {
        existing.totalTokens += day.totals.tokens;
        existing.totalCost += day.totals.cost;
        if (day.date < existing.start) existing.start = day.date;
        if (day.date > existing.end) existing.end = day.date;
      } else {
        yearMap.set(year, {
          totalTokens: day.totals.tokens,
          totalCost: day.totals.cost,
          start: day.date,
          end: day.date,
        });
      }
    }

    const years = Array.from(yearMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([year, stats]) => ({
        year,
        totalTokens: stats.totalTokens,
        totalCost: stats.totalCost,
        range: { start: stats.start, end: stats.end },
      }));

    return {
      meta: {
        generatedAt: new Date().toISOString(),
        version: "1.0.0",
        dateRange: {
          start: data.dateRange.start || contributions[0]?.date || "",
          end: data.dateRange.end || contributions[contributions.length - 1]?.date || "",
        },
      },
      summary: {
        totalTokens,
        totalCost,
        totalDays: contributions.length,
        activeDays: data.stats.activeDays,
        averagePerDay: data.stats.activeDays > 0 ? totalCost / data.stats.activeDays : 0,
        maxCostInSingleDay: maxCost,
        clients: data.clients as ClientType[],
        models: data.models,
      },
      years,
      contributions: contributions as DailyContribution[],
    };
  }, [data]);

  const user: ProfileUser = useMemo(() => ({
    username: data.user.username,
    displayName: data.user.displayName,
    avatarUrl: data.user.avatarUrl,
    rank: data.user.rank,
  }), [data]);

  const stats: ProfileStatsData = useMemo(() => ({
    totalTokens: data.stats.totalTokens,
    totalCost: data.stats.totalCost,
    inputTokens: data.stats.inputTokens,
    outputTokens: data.stats.outputTokens,
    cacheReadTokens: data.stats.cacheReadTokens,
    cacheWriteTokens: data.stats.cacheWriteTokens,
    activeDays: data.stats.activeDays,
    submissionCount: data.stats.submissionCount,
  }), [data]);

  return (
    <PageContainer style={{ backgroundColor: "#10121C" }}>
      <Navigation />

      <SubmissionFreshnessBanner freshness={data.submissionFreshness} />

      <MainContent>
        <ContentWrapper>
          <ProfileHeader
            user={user}
            stats={stats}
            lastUpdated={data.submissionFreshness?.lastUpdated || data.updatedAt || undefined}
          />

          <ProfileTabBar activeTab={activeTab} onTabChange={setActiveTab} />

          {activeTab === "activity" && (
            graphData ? (
              <ActivitySection>
                <ProfileActivity data={graphData} />
                <ProfileStats
                  stats={stats}
                  favoriteModel={
                    data.modelUsage?.reduce((max, current) => current.cost > max.cost ? current : max, data.modelUsage[0])?.model
                  }
                />
              </ActivitySection>
            ) : <ProfileEmptyActivity />
          )}
          {activeTab === "breakdown" && <TokenBreakdown stats={stats} />}
          {activeTab === "models" && <ProfileModels models={data.models} modelUsage={data.modelUsage} />}
        </ContentWrapper>
      </MainContent>

      <Footer />
    </PageContainer>
  );
}

const PageContainer = styled.div`
  min-height: 100vh;
  display: flex;
  flex-direction: column;

  padding-top: 64px;
`;

const MainContent = styled.main`
  flex: 1;
  max-width: 800px;
  margin-left: auto;
  margin-right: auto;
  padding-left: 16px;
  padding-right: 16px;
  padding-top: 24px;
  padding-bottom: 24px;
  width: 100%;

  @media (min-width: 640px) {
    padding-left: 24px;
    padding-right: 24px;
    padding-top: 40px;
    padding-bottom: 40px;
  }
`;

const ContentWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 32px;
`;

const ActivitySection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;
