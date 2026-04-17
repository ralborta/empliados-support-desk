import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/auth";

export async function requireUserApi(): Promise<
  { ok: true; session: SessionData } | { ok: false; response: NextResponse }
> {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  if (!session.user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { ok: true, session };
}

export async function requireAdminApi(): Promise<
  { ok: true; session: SessionData } | { ok: false; response: NextResponse }
> {
  const r = await requireUserApi();
  if (!r.ok) return r;
  if (r.session.user!.role !== "ADMIN") {
    return { ok: false, response: NextResponse.json({ error: "Solo administradores" }, { status: 403 }) };
  }
  return r;
}
