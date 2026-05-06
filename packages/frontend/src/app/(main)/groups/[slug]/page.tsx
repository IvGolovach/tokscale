import Link from "next/link";
import { notFound } from "next/navigation";
import { Navigation } from "@/components/layout/Navigation";
import { Footer } from "@/components/layout/Footer";
import { getSession } from "@/lib/auth/session";
import { getGroupLeaderboardData } from "@/lib/groups/getGroupLeaderboard";
import { getGroupMembership } from "@/lib/groups/permissions";
import { getGroupBySlug, getGroupMemberCount } from "@/lib/groups/queries";
import GroupDetailClient from "./GroupDetailClient";

interface GroupPageProps {
  params: Promise<{ slug: string }>;
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--color-bg-default)",
      }}
    >
      <Navigation />
      <main className="main-container">{children}</main>
      <Footer />
    </div>
  );
}

function AccessMessage({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <PageShell>
      <section
        style={{
          margin: "32px 0",
          padding: 24,
          border: "1px solid var(--color-border-default)",
          borderRadius: 8,
          background: "var(--color-bg-default)",
        }}
      >
        <h1 style={{ margin: "0 0 8px", color: "var(--color-fg-default)" }}>
          Private group
        </h1>
        <p style={{ margin: "0 0 16px", color: "var(--color-fg-muted)" }}>
          This group is only visible to members.
        </p>
        {!isSignedIn && (
          <Link href="/api/auth/github" style={{ color: "var(--color-primary)" }}>
            Sign in with GitHub
          </Link>
        )}
      </section>
    </PageShell>
  );
}

export default async function GroupPage({ params }: GroupPageProps) {
  const { slug } = await params;
  const group = await getGroupBySlug(slug);

  if (!group) {
    notFound();
  }

  const session = await getSession();
  const membership = session ? await getGroupMembership(group.id, session.id) : null;

  if (!group.isPublic && !membership) {
    return <AccessMessage isSignedIn={!!session} />;
  }

  const [memberCount, initialData] = await Promise.all([
    getGroupMemberCount(group.id),
    getGroupLeaderboardData(group.id, "all", 1, 50, "tokens"),
  ]);

  return (
    <PageShell>
      <GroupDetailClient
        group={{
          id: group.id,
          name: group.name,
          slug: group.slug,
          description: group.description,
          avatarUrl: group.avatarUrl,
          isPublic: group.isPublic,
          memberCount,
          membership,
        }}
        currentUser={session}
        initialData={initialData}
      />
    </PageShell>
  );
}
