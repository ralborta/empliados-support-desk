import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { sessionOptions, type SessionData } from "@/lib/auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as { password?: string }));
  const password = body.password;

  if (!process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "APP_PASSWORD no configurada" }, { status: 500 });
  }

  if (!password || password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
  }

  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  session.user = {
    id: "admin",
    role: "ADMIN",
    name: "Operador",
  };
  await session.save();

  return NextResponse.json({ ok: true });
}
