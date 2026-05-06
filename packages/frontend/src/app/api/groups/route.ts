import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { db, groupMembers, groups } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth/requestSession";
import { generateUniqueGroupSlug } from "@/lib/groups/slugs";
import { listPublicGroups, listUserGroups } from "@/lib/groups/queries";

function parseIntSafe(value: string | null, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : defaultValue;
}

function parseString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseIntSafe(searchParams.get("page"), 1));
    const limit = Math.min(100, Math.max(1, parseIntSafe(searchParams.get("limit"), 20)));
    const session = await getSessionFromRequest(request);

    if (searchParams.get("my") === "true") {
      if (!session) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      }

      return NextResponse.json(await listUserGroups(session.id, page, limit));
    }

    return NextResponse.json(await listPublicGroups(page, limit));
  } catch (error) {
    console.error("List groups error:", error);
    return NextResponse.json({ error: "Failed to fetch groups" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const name = parseString(body.name);
    if (!name) {
      return NextResponse.json({ error: "Group name is required" }, { status: 400 });
    }

    if (name.length > 100) {
      return NextResponse.json({ error: "Group name must be 100 characters or less" }, { status: 400 });
    }

    const description = parseString(body.description);
    const isPublic = typeof body.isPublic === "boolean" ? body.isPublic : true;

    const createdGroup = await db.transaction(async (tx) => {
      const slug = await generateUniqueGroupSlug(name, tx);
      const [newGroup] = await tx
        .insert(groups)
        .values({
          name,
          slug,
          description,
          isPublic,
          createdBy: session.id,
        })
        .returning();

      await tx.insert(groupMembers).values({
        groupId: newGroup.id,
        userId: session.id,
        role: "owner",
      });

      return newGroup;
    });

    revalidatePath("/groups");
    return NextResponse.json(createdGroup, { status: 201 });
  } catch (error) {
    console.error("Create group error:", error);
    return NextResponse.json({ error: "Failed to create group" }, { status: 500 });
  }
}
