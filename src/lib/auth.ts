import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type SessionUser = {
  id: string;
  email?: string;
  name?: string;
  role: "ADMIN" | "SUPPORT";
};

export type SessionData = {
  user?: SessionUser;
};

const fallbackPassword = "change-this-session-password-in-env-please";

export const sessionOptions: SessionOptions = {
  cookieName: "empliados_support_session",
  password: process.env.SESSION_PASSWORD || fallbackPassword,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export async function requireSession() {
  const session = await getSession();
  if (!session.user) {
    redirect("/login");
  }
  return session;
}

export function ensureAppPasswordConfigured() {
  if (!process.env.APP_PASSWORD) {
    throw new Error("APP_PASSWORD no está configurada en el entorno");
  }
}
