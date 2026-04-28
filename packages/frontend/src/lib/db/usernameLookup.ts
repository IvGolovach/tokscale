import { sql } from "drizzle-orm";
import { users } from "./schema";

export function usernameEqualsIgnoreCase(username: string) {
  return sql`LOWER(${users.username}) = LOWER(${username})`;
}

export function normalizeUsernameCacheKey(username: string): string {
  return username.toLowerCase();
}
