/**
 * SMTP mail helpers for Project Suez (test mail + employee invites).
 */
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string;
}

export function normalizeSmtpConfig(raw: unknown): SmtpConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const host = typeof o.host === 'string' ? o.host.trim() : '';
  const fromEmail = typeof o.fromEmail === 'string' ? o.fromEmail.trim() : '';
  const username = typeof o.username === 'string' ? o.username.trim() : '';
  const password = typeof o.password === 'string' ? o.password : '';
  const port = typeof o.port === 'number' ? o.port : Number(o.port) || 587;
  if (!host || !fromEmail || !username || !password) return null;
  // Port dictates TLS mode: 465 = implicit SSL; 587 = plain then STARTTLS.
  // Forcing secure:true on 587 causes "wrong version number".
  const secure = port === 465 ? true : port === 587 ? false : Boolean(o.secure);
  return {
    host,
    port,
    secure,
    username,
    password,
    fromEmail,
    fromName: typeof o.fromName === 'string' && o.fromName.trim() ? o.fromName.trim() : fromEmail,
    replyTo: typeof o.replyTo === 'string' && o.replyTo.trim() ? o.replyTo.trim() : undefined,
  };
}

function createTransport(cfg: SmtpConfig): Transporter {
  const isImplicitTls = cfg.port === 465 || cfg.secure;
  const useStartTls = cfg.port === 587 || (!isImplicitTls && cfg.port !== 465);
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: isImplicitTls,
    requireTLS: useStartTls,
    auth: { user: cfg.username, pass: cfg.password },
    // Prefer IPv4 — many local networks can't route Hostinger/Cloudflare IPv6 (EHOSTUNREACH).
    family: 4,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
    tls: {
      // Hostinger / shared mail often needs modern TLS; reject unauthorized stays on by default.
      minVersion: 'TLSv1.2',
    },
  });
}

export async function sendMail(
  cfg: SmtpConfig,
  opts: { to: string; subject: string; text: string; html?: string },
): Promise<{ messageId: string }> {
  const transporter = createTransport(cfg);
  const info = await transporter.sendMail({
    from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
    to: opts.to,
    replyTo: cfg.replyTo || cfg.fromEmail,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
  return { messageId: info.messageId || '' };
}

export async function verifySmtp(cfg: SmtpConfig): Promise<void> {
  const transporter = createTransport(cfg);
  await transporter.verify();
}

export function buildInviteEmail(params: {
  orgName: string;
  inviteeName?: string;
  inviteUrl: string;
  expiresAt: string;
  designation?: string;
}): { subject: string; text: string; html: string } {
  const greeting = params.inviteeName ? `Hi ${params.inviteeName},` : 'Hi,';
  const roleLine = params.designation ? ` for the role of ${params.designation}` : '';
  const subject = `You're invited to join ${params.orgName}`;
  const text = `${greeting}

You've been invited to join ${params.orgName}${roleLine} on Project Suez.

Complete your employee profile (personal details, bank info, and documents) using this link:
${params.inviteUrl}

This invite expires on ${new Date(params.expiresAt).toLocaleString()}.

If you did not expect this email, you can ignore it.
`;
  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: system-ui, -apple-system, sans-serif; color: #0f172a; line-height: 1.5;">
  <p>${greeting}</p>
  <p>You've been invited to join <strong>${escapeHtml(params.orgName)}</strong>${roleLine ? escapeHtml(roleLine) : ''} on Project Suez.</p>
  <p>Please complete your employee profile — personal details, bank information, and document uploads — so HR, leave, and payroll can be set up.</p>
  <p style="margin: 28px 0;">
    <a href="${escapeAttr(params.inviteUrl)}"
       style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;">
      Complete your profile
    </a>
  </p>
  <p style="font-size:13px;color:#64748b;">Or copy this link:<br/><a href="${escapeAttr(params.inviteUrl)}">${escapeHtml(params.inviteUrl)}</a></p>
  <p style="font-size:12px;color:#94a3b8;">Expires ${escapeHtml(new Date(params.expiresAt).toLocaleString())}.</p>
</body>
</html>`;
  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
