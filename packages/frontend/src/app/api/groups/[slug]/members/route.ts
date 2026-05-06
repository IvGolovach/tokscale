import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, groupMembers, users } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth/requestSession";
import { revalidateGroupCaches } from "@/lib/groups/cache";
import { canManageGroupMember, getGroupMembership } from "@/lib/groups/permissions";
import { getGroupBySlug } from "@/lib/groups/queries";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

async function resolveGroupAccess(request: Request, slug: string) {
  const group = await getGroupBySlug(slug);
  if (!group) {
    return { response: NextResponse.json({ error: "Group not found" }, { status: 404 }) };
  }

  const session = await getSessionFromRequest(request);
  const membership = session ? await getGroupMembership(group.id, session.id) : null;

  if (!group.isPublic && !membership) {
    return { response: NextResponse.json({ error: "Group not found" }, { status: 404 }) };
  }

  return { group, session, membership };
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const access = await resolveGroupAccess(request, slug);
    if ("response" in access) {
      return access.response;
    }

    const members = await db
      .select({
        id: groupMembers.id,
        userId: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        role: groupMembers.role,
        joinedAt: groupMembers.joinedAt,
      })
      .from(groupMembers)
      .innerJoin(users, eq(groupMembers.userId, users.id))
      .where(eq(groupMembers.groupId, access.group.id));

    return NextResponse.json({ members });
  } catch (error) {
    console.error("List group members error:", error);
    return NextResponse.json({ error: "Failed to fetch group members" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { slug } = await params;
    const group = await getGroupBySlug(slug);
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    if (userId === session.id) {
      return NextResponse.json({ error: "Use the leave endpoint to remove yourself" }, { status: 400 });
    }

    const membership = await getGroupMembership(group.id, session.id);
    if (!group.isPublic && !membership) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    if (!membership || !(await canManageGroupMember(group.id, session.id, userId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const deleted = await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, userId)))
      .returning({ id: groupMembers.id });

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    try {
      await revalidateGroupCaches(group.id, group.slug);
    } catch (cacheError) {
      console.error("Remove group member cache invalidation failed:", cacheError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Remove group member error:", error);
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }
}
