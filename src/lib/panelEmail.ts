/**
 * Emails opcionales del panel vía SMTP (Nodemailer).
 * Compatible con Gmail, Office 365, SendGrid SMTP, Mailgun, SES, etc.
 *
 * Variables:
 *   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS
 *   SMTP_SECURE=true  → puerto 465 TLS implícito
 *   PANEL_EMAIL_FROM  → ej. "Atilio <notificaciones@waragps.com>"
 *   PANEL_BASE_URL    → https://wara.nivel41.com
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

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

export function panelEmailConfigured(): boolean {
  return readSmtpConfig() !== null;
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const cfg = readSmtpConfig();
  if (!cfg || !to.trim()) return false;

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
