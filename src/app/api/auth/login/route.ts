import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionOptions, type SessionData } from "@/lib/auth";
import { panelAuthConfigured, panelAuthMissingDescription, tryAgentUserLogin, tryPanelLogin } from "@/lib/panelAuth";
import { onAdvisorLogin } from "@/lib/advisorDistribution";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  if (!panelAuthConfigured()) {
    return NextResponse.json(
      {
        error: panelAuthMissingDescription(),
      },
      { status: 503 }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Email y contraseña requeridos" }, { status: 400 });
  }

  // Bug real, producción 2026-07-23: si el mismo email/contraseña matchea TANTO una
  // cuenta de variables de entorno (PANEL_USER_ADMIN_*/PANEL_USER_WARA_*) COMO un
  // AgentUser real en base, tryPanelLogin (env) ganaba SIEMPRE por ir primero — la
  // sesión quedaba con un id sintético ("panel-admin"/"panel-wara") sin fila en la
  // base. Eso rompe todo lo que depende de un AgentUser real: presencia para el
  // monitor externo, notificaciones (AgentNotification), y reparto de casos. Se
  // prioriza la cuenta real en base (con su propio passwordHash) cuando existe; las
  // cuentas de entorno quedan como respaldo de emergencia si no hay una fila en base
  // con ese email/contraseña.
  const user =
    (await tryAgentUserLogin(parsed.data.email, parsed.data.password)) ??
    tryPanelLogin(parsed.data.email, parsed.data.password);
  if (!user) {
    return NextResponse.json({ error: "Credenciales inválidas" }, { status: 401 });
  }

  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  session.user = user;
  await session.save();

  try {
    await onAdvisorLogin(user.id);
  } catch (e) {
    console.error("[auth/login] onAdvisorLogin:", e);
  }

  return NextResponse.json({ ok: true });
}
