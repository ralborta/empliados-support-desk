/**
 * Emails del panel. Dos backends posibles, probados en este orden:
 *
 * 1) Resend (RESEND_API_KEY) — preferido, no requiere infraestructura SMTP propia.
 * 2) SMTP vía Nodemailer (SMTP_HOST/SMTP_USER/SMTP_PASS) — fallback si algún día
 *    se prefiere un proveedor SMTP propio (Gmail, Office 365, SES, etc.).
 *
 * Variables:
 *   RESEND_API_KEY    → API key de Resend (dominio remitente debe estar verificado ahí)
 *   PANEL_EMAIL_FROM  → ej. "Atilio <notificaciones@nivel41.com>"
 *   PANEL_BASE_URL    → https://wara.nivel41.com
 *   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_SECURE=true (fallback opcional)
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { Resend } from "resend";
import type { WaraHealthStatus } from "@/lib/waraHealthCheck";
import type { BbcRuntimeStatus } from "@/lib/bbcRuntimeMonitor";

const PANEL_BASE_URL = process.env.PANEL_BASE_URL?.trim() || "https://wara.nivel41.com";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
};

function readSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.PANEL_EMAIL_FROM?.trim();
  if (!host || !from) return null;

  const port = Number(process.env.SMTP_PORT?.trim() || "587");
  const secure =
    process.env.SMTP_SECURE?.trim().toLowerCase() === "true" || port === 465;

  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    user: process.env.SMTP_USER?.trim() || undefined,
    pass: process.env.SMTP_PASS?.trim() || undefined,
    from,
  };
}

let cachedTransport: { key: string; transport: Transporter } | null = null;

function getTransport(cfg: SmtpConfig): Transporter {
  const key = `${cfg.host}:${cfg.port}:${cfg.user ?? ""}:${cfg.secure}`;
  if (cachedTransport?.key === key) return cachedTransport.transport;

  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user && cfg.pass ? { user: cfg.user, pass: cfg.pass } : undefined,
  });

  cachedTransport = { key, transport };
  return transport;
}

let cachedResend: Resend | null = null;

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  if (!cachedResend) cachedResend = new Resend(apiKey);
  return cachedResend;
}

export function panelEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim() || readSmtpConfig() !== null;
}

async function sendViaResend(to: string, subject: string, html: string): Promise<boolean> {
  const resend = getResendClient();
  const from = process.env.PANEL_EMAIL_FROM?.trim();
  if (!resend || !from) return false;

  const { error } = await resend.emails.send({ from, to: to.trim(), subject, html });
  if (error) {
    console.error("[panelEmail] Error Resend:", error.message ?? error);
    return false;
  }
  return true;
}

async function sendViaSmtp(to: string, subject: string, html: string): Promise<boolean> {
  const cfg = readSmtpConfig();
  if (!cfg) return false;

  try {
    const transport = getTransport(cfg);
    await transport.sendMail({
      from: cfg.from,
      to: to.trim(),
      subject,
      html,
    });
    return true;
  } catch (err) {
    console.error("[panelEmail] Error SMTP:", err instanceof Error ? err.message : err);
    return false;
  }
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!to.trim()) return false;

  if (process.env.RESEND_API_KEY?.trim()) {
    return sendViaResend(to, subject, html);
  }
  return sendViaSmtp(to, subject, html);
}

export async function sendAdvisorWelcomeEmail(params: {
  to: string;
  name: string;
  role: "ADMIN" | "SUPPORT";
}): Promise<void> {
  const roleLabel = params.role === "ADMIN" ? "Administrador" : "Asesor de soporte";
  const html = `
    <p>Hola ${escapeHtml(params.name)},</p>
    <p>Te crearon una cuenta en el panel de Atilio con rol <strong>${roleLabel}</strong>.</p>
    <p>Ingresá acá: <a href="${PANEL_BASE_URL}/login">${PANEL_BASE_URL}/login</a></p>
    <p>Usá el email <strong>${escapeHtml(params.to)}</strong> y la contraseña que te compartió el administrador.</p>
    <p style="color:#64748b;font-size:12px;">Este es un mensaje automático del panel Wara.</p>
  `;

  const ok = await sendEmail(params.to, "Tu acceso al panel Atilio", html);
  if (ok) console.log(`[panelEmail] Bienvenida enviada a ${params.to}`);
}

export async function sendTicketAssignedEmail(params: {
  to: string;
  agentName: string;
  ticketCode: string;
  ticketTitle: string;
  companyName: string;
  ticketId: string;
  type: "ASSIGNED" | "REASSIGNED";
}): Promise<void> {
  const action = params.type === "REASSIGNED" ? "Te reasignaron" : "Te asignaron";
  const url = `${PANEL_BASE_URL}/tickets/${params.ticketId}`;
  const html = `
    <p>Hola ${escapeHtml(params.agentName)},</p>
    <p>${action} un caso en el panel Atilio:</p>
    <ul>
      <li><strong>${escapeHtml(params.ticketCode)}</strong> — ${escapeHtml(params.ticketTitle)}</li>
      <li>Empresa: ${escapeHtml(params.companyName)}</li>
    </ul>
    <p><a href="${url}">Abrir caso en el panel</a></p>
    <p style="color:#64748b;font-size:12px;">También verás la alerta en la campana del panel.</p>
  `;

  const ok = await sendEmail(
    params.to,
    `${params.ticketCode} — ${action.toLowerCase()} un caso`,
    html,
  );
  if (ok) console.log(`[panelEmail] Asignación ${params.ticketCode} → ${params.to}`);
}

export async function sendUnassignedTicketAlertEmail(params: {
  to: string;
  adminName: string;
  ticketCode: string;
  ticketTitle: string;
  companyName: string;
  ticketId: string;
}): Promise<void> {
  const url = `${PANEL_BASE_URL}/tickets/${params.ticketId}`;
  const html = `
    <p>Hola ${escapeHtml(params.adminName)},</p>
    <p>Llegó un caso nuevo y <strong>no hay ningún asesor conectado</strong> en el panel Atilio para asignarlo automáticamente:</p>
    <ul>
      <li><strong>${escapeHtml(params.ticketCode)}</strong> — ${escapeHtml(params.ticketTitle)}</li>
      <li>Empresa: ${escapeHtml(params.companyName)}</li>
    </ul>
    <p><a href="${url}">Abrir caso en el panel</a></p>
    <p style="color:#64748b;font-size:12px;">Te avisamos a vos como administrador porque este caso quedaría sin nadie atendiéndolo hasta que un asesor se conecte. Se te notifica una sola vez por caso.</p>
  `;

  const ok = await sendEmail(
    params.to,
    `${params.ticketCode} — caso sin asesor conectado`,
    html,
  );
  if (ok) console.log(`[panelEmail] Alerta de caso sin asignar ${params.ticketCode} → ${params.to}`);
}

let lastWaraHealthAlertAt = 0;
const WARA_HEALTH_ALERT_COOLDOWN_MS = 30 * 60 * 1000;

function opsAlertRecipients(): string[] {
  const raw =
    process.env.WARA_OPS_ALERT_EMAIL?.trim() ||
    process.env.PANEL_USER_ADMIN_EMAIL?.trim() ||
    "";
  return raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

/** Email ops cuando Wara no responde (cron / monitor). Cooldown 30 min. */
export async function sendWaraHealthAlertEmail(health: WaraHealthStatus): Promise<boolean> {
  const recipients = opsAlertRecipients();
  if (!recipients.length) return false;

  const now = Date.now();
  if (now - lastWaraHealthAlertAt < WARA_HEALTH_ALERT_COOLDOWN_MS) return false;

  const html = `
    <p><strong>Alerta: API de Wara no disponible o mal configurada</strong></p>
    <p>Esto <strong>no es un fallo del bot</strong> — la plataforma no pudo consultar datos en Wara.</p>
    <ul>
      <li>Estado: ${escapeHtml(health.stage)}</li>
      <li>URL: ${escapeHtml(health.apiBaseUrl)}</li>
      <li>Detalle: ${escapeHtml(health.message)}</li>
      ${health.configWarning ? `<li>Aviso config: ${escapeHtml(health.configWarning)}</li>` : ""}
    </ul>
    <p>Revisá <a href="${PANEL_BASE_URL}/monitor">monitor de operaciones</a> o variables WARA_* en Vercel.</p>
  `;

  let sent = false;
  for (const to of recipients) {
    if (await sendEmail(to, "[Wara] API no disponible — no es fallo del bot", html)) sent = true;
  }
  if (sent) {
    lastWaraHealthAlertAt = now;
    console.log("[panelEmail] Alerta Wara health enviada");
  }
  return sent;
}

let lastBbcAlertAt = 0;
const BBC_ALERT_COOLDOWN_MS = 5 * 60 * 1000;

/** Email ops cuando BBC se reinicia o queda offline. Cooldown 5 min. */
export async function sendBbcRuntimeAlertEmail(
  bbc: BbcRuntimeStatus
): Promise<boolean> {
  const recipients = opsAlertRecipients();
  if (!recipients.length) return false;

  const now = Date.now();
  if (now - lastBbcAlertAt < BBC_ALERT_COOLDOWN_MS) return false;

  const kind = bbc.restarted
    ? "reinicio"
    : bbc.healthy
      ? "estado"
      : "offline";
  const title =
    kind === "reinicio"
      ? "[BBC] Runtime se reinició y volvió ONLINE"
      : kind === "offline"
        ? `[BBC] Runtime ${bbc.status || "OFFLINE"}`
        : `[BBC] Estado ${bbc.status}`;

  const html = `
    <p><strong>${escapeHtml(title)}</strong></p>
    <p>Esto es el <strong>agente BuilderBot Cloud (WhatsApp/Meta)</strong>, no la API de Wara.</p>
    <ul>
      <li>Estado: ${escapeHtml(bbc.status)}${bbc.healthy ? " (healthy)" : " (no healthy)"}</li>
      <li>Reinicios acumulados: ${bbc.restartCount}</li>
      <li>Host: ${escapeHtml(bbc.host || "—")}</li>
      <li>Último evento: ${escapeHtml(bbc.lastEventAt || "—")}</li>
      <li>Último ONLINE: ${escapeHtml(bbc.lastOnlineAt || "—")}</li>
      <li>Fuente: ${escapeHtml(bbc.source || "—")}</li>
    </ul>
    <p>Revisá <a href="${PANEL_BASE_URL}/monitor">monitor.nivel41.com</a> o la consola BBC (Session Status).</p>
  `;

  let sent = false;
  for (const to of recipients) {
    if (await sendEmail(to, title, html)) sent = true;
  }
  if (sent) {
    lastBbcAlertAt = now;
    console.log("[panelEmail] Alerta BBC runtime enviada:", kind);
  }
  return sent;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
