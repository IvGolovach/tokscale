import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, groupMembers } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth/requestSession";
import { revalidateGroupCaches } from "@/lib/groups/cache";
import { getGroupMembership } from "@/lib/groups/permissions";
import { getGroupBySlug } from "@/lib/groups/queries";
import { canManageGroupRole, isGroupRole } from "@/lib/groups/utils";
import type { GroupRole } from "@/lib/db";

interface RouteParams {
  params: Promise<{ slug: string; userId: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { slug, userId } = await params;
    const group = await getGroupBySlug(slug);
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const nextRole = body.role;
    if (!isGroupRole(nextRole) || nextRole === "owner") {
      return NextResponse.json({ error: "Role must be member or admin" }, { status: 400 });
    }

    const [actor, target] = await Promise.all([
      getGroupMembership(group.id, session.id),
      getGroupMembership(group.id, userId),
    ]);

    if (!group.isPublic && !actor) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    if (
      !actor ||
      !target ||
      !canManageGroupRole(actor.role, target.role) ||
      !canManageGroupRole(actor.role, nextRole)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [updated] = await db
      .update(groupMembers)
      .set({ role: nextRole as GroupRole })
      .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, userId)))
      .returning({
        id: groupMembers.id,
        userId: groupMembers.userId,
        role: groupMembers.role,
      });

    if (!updated) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    try {
      await revalidateGroupCaches(group.id, group.slug);
    } catch (cacheError) {
      console.error("Update group member role cache invalidation failed:", cacheError);
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update group member role error:", error);
    return NextResponse.json({ error: "Failed to update role" }, { status: 500 });
  }
}
