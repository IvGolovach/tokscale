import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/requestSession";
import { revalidateGroupCaches } from "@/lib/groups/cache";
import { createGroupInvite, GroupInviteError } from "@/lib/groups/invites";
import { requireGroupRole } from "@/lib/groups/permissions";
import { getGroupBySlug } from "@/lib/groups/queries";
import { isGroupRole } from "@/lib/groups/utils";
import type { GroupRole } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
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

    const membership = await requireGroupRole(group.id, session.id, "admin");
    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const role = isGroupRole(body.role) ? body.role : "member";
    const invitedUsername = typeof body.invitedUsername === "string"
      ? body.invitedUsername
      : null;

    const invite = await createGroupInvite({
      groupId: group.id,
      invitedBy: session.id,
      role: role as GroupRole,
      invitedUsername,
    });

    await revalidateGroupCaches(group.id, group.slug);

    return NextResponse.json(
      {
        invite,
        joinUrl: `/groups/join/${invite.token}`,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof GroupInviteError) {
      return NextResponse.json({ error: error.message }, { status: error.code === "invalid" ? 400 : 403 });
    }
    console.error("Create group invite error:", error);
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
  }
}
