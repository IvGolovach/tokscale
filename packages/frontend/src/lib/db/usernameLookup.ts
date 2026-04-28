import { sql } from "drizzle-orm";
import { users } from "./schema";

export const USERNAME_LOOKUP_LIMIT = 2;

export class AmbiguousUsernameError extends Error {
  constructor(username: string) {
    super(`Multiple users match username ${username} case-insensitively`);
    this.name = "AmbiguousUsernameError";
  }
}

export function usernameEqualsIgnoreCase(username: string) {
  return sql`LOWER(${users.username}) = LOWER(${username})`;
}

export function normalizeUsernameCacheKey(username: string): string {
  return username.toLowerCase();
}

export function getSingleUsernameMatch<T>(
  rows: readonly T[],
  username: string,
): T | null {
  if (rows.length > 1) {
    throw new AmbiguousUsernameError(username);
  }

  return rows[0] ?? null;
}
