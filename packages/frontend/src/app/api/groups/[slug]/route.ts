import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, groups } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth/requestSession";
import { revalidateGroupCaches } from "@/lib/groups/cache";
import { getGroupMembership, requireGroupRole } from "@/lib/groups/permissions";
import { getGroupBySlug, getGroupMemberCount } from "@/lib/groups/queries";
import { generateUniqueGroupSlug } from "@/lib/groups/slugs";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

function parseString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

async function authorizeGroupRead(request: Request, slug: string) {
  const group = await getGroupBySlug(slug);
  if (!group) {
    return { response: NextResponse.json({ error: "Group not found" }, { status: 404 }) };
  }

  const session = await getSessionFromRequest(request);
  const membership = session ? await getGroupMembership(group.id, session.id) : null;

  if (!group.isPublic && !membership) {
    return {
      response: NextResponse.json(
        { error: session ? "Forbidden" : "Not authenticated" },
        { status: session ? 403 : 401 }
      ),
    };
  }

  return { group, session, membership };
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const authorized = await authorizeGroupRead(request, slug);

    if ("response" in authorized) {
      return authorized.response;
    }

    const memberCount = await getGroupMemberCount(authorized.group.id);
    return NextResponse.json({
      ...authorized.group,
      memberCount,
      membership: authorized.membership,
    });
  } catch (error) {
    console.error("Get group error:", error);
    return NextResponse.json({ error: "Failed to fetch group" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
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

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const updateData: {
      name?: string;
      slug?: string;
      description?: string | null;
      isPublic?: boolean;
      avatarUrl?: string | null;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (body.name !== undefined) {
      const name = parseString(body.name);
      if (!name) {
        return NextResponse.json({ error: "Group name cannot be empty" }, { status: 400 });
      }
      if (name.length > 100) {
        return NextResponse.json({ error: "Group name must be 100 characters or less" }, { status: 400 });
      }
      updateData.name = name;
      if (name !== group.name) {
        updateData.slug = await generateUniqueGroupSlug(name);
      }
    }

    if (body.description !== undefined) {
      updateData.description = parseString(body.description);
    }
    if (body.avatarUrl !== undefined) {
      updateData.avatarUrl = parseString(body.avatarUrl);
    }
    if (typeof body.isPublic === "boolean") {
      updateData.isPublic = body.isPublic;
    }

    const [updated] = await db
      .update(groups)
      .set(updateData)
      .where(eq(groups.id, group.id))
      .returning();

    await revalidateGroupCaches(group.id, updated?.slug ?? group.slug);
    if (updated?.slug && updated.slug !== group.slug) {
      revalidatePath(`/groups/${group.slug}`);
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update group error:", error);
    return NextResponse.json({ error: "Failed to update group" }, { status: 500 });
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

    const membership = await getGroupMembership(group.id, session.id);
    if (!membership || membership.role !== "owner") {
      return NextResponse.json({ error: "Only the owner can delete this group" }, { status: 403 });
    }

    const deleted = await db
      .delete(groups)
      .where(eq(groups.id, group.id))
      .returning({ id: groups.id });

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    await revalidateGroupCaches(group.id, group.slug);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete group error:", error);
    return NextResponse.json({ error: "Failed to delete group" }, { status: 500 });
  }
}
