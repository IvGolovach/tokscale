import { Suspense } from "react";
import { Navigation } from "@/components/layout/Navigation";
import { Footer } from "@/components/layout/Footer";
import { getSession } from "@/lib/auth/session";
import { listPublicGroups, listUserGroups } from "@/lib/groups/queries";
import GroupsClient from "./GroupsClient";

function isMissingDatabaseUrl(error: unknown): boolean {
  return error instanceof Error && error.message === "DATABASE_URL environment variable is not set";
}

export default function GroupsPage() {
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
      <main className="main-container">
        <Suspense fallback={null}>
          <GroupsContent />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}

async function GroupsContent() {
  const session = await getSession().catch((error) => {
    if (isMissingDatabaseUrl(error)) return null;
    throw error;
  });
  const [publicGroups, myGroups] = await Promise.all([
    listPublicGroups(1, 20).catch((error) => {
      if (isMissingDatabaseUrl(error)) {
        return { groups: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false } };
      }
      throw error;
    }),
    session
      ? listUserGroups(session.id, 1, 20).catch((error) => {
          if (isMissingDatabaseUrl(error)) {
            return { groups: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false } };
          }
          throw error;
        })
      : Promise.resolve(null),
  ]);

  return (
    <GroupsClient
      currentUser={session}
      initialPublicGroups={publicGroups.groups}
      initialMyGroups={myGroups?.groups ?? []}
    />
  );
}
