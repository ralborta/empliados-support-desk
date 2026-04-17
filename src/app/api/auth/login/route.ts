import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { panelAuthConfigured, tryPanelLogin } from "@/lib/panelAuth";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  if (!panelAuthConfigured()) {
    return NextResponse.json(
      {
        error:
          "Acceso no configurado: definí PANEL_USER_WARA_EMAIL, PANEL_USER_WARA_PASSWORD, PANEL_USER_ADMIN_EMAIL y PANEL_USER_ADMIN_PASSWORD en el entorno.",
      },
      { status: 503 }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Email y contraseña requeridos" }, { status: 400 });
  }

  const user = tryPanelLogin(parsed.data.email, parsed.data.password);
  if (!user) {
    return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
  }

  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.user = user;
  await session.save();

  return NextResponse.json({ ok: true });
}
