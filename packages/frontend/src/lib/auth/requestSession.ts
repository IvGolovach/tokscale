import { getSession, getSessionFromHeader, type SessionUser } from "./session";

export async function getSessionFromRequest(request: Request): Promise<SessionUser | null> {
  if (request.headers.get("Authorization")) {
    return getSessionFromHeader(request);
  }

  return getSession();
}
