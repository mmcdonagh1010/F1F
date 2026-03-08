import { config } from "../config.js";
import { buildDebugPreviewUrl, buildFrontendTokenUrl } from "./authTokens.js";
import { isEmailDeliveryConfigured, sendEmail } from "./email.js";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function deliverAuthEmail({ to, subject, intro, actionLabel, path, token, expiryText }) {
  const actionUrl = buildFrontendTokenUrl(path, token);
  const escapedIntro = escapeHtml(intro);
  const escapedActionLabel = escapeHtml(actionLabel);
  const escapedExpiryText = escapeHtml(expiryText);

  if (isEmailDeliveryConfigured()) {
    await sendEmail({
      to,
      subject,
      text: `${intro}\n\n${actionLabel}: ${actionUrl}\n\n${expiryText}\n\nIf you did not request this, you can ignore this email.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
          <p>${escapedIntro}</p>
          <p>
            <a href="${actionUrl}" style="display: inline-block; padding: 12px 18px; background: #dc2626; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 700;">${escapedActionLabel}</a>
          </p>
          <p>${escapedExpiryText}</p>
          <p>If you did not request this, you can ignore this email.</p>
        </div>
      `
    });

    return { delivery: "email", previewUrl: null };
  }

  if (config.emailPreviewFallback) {
    return { delivery: "preview", previewUrl: buildDebugPreviewUrl(path, token) };
  }

  throw new Error("Email delivery is not configured");
}

export function getVerificationEmailPreparedMessage(delivery) {
  return delivery === "email"
    ? "Verification email sent. Check your inbox before logging in."
    : "Verification email prepared.";
}

export function getPasswordResetPreparedMessage(delivery) {
  return delivery === "email"
    ? "Password reset email sent. Check your inbox for the reset link."
    : "Password reset link prepared.";
}

export async function sendVerificationEmail({ to, token }) {
  return deliverAuthEmail({
    to,
    token,
    path: "/verify-email",
    subject: "Verify your Fantasy F1 account",
    intro: "Finish setting up your Fantasy F1 account by verifying this email address.",
    actionLabel: "Verify email",
    expiryText: "This verification link expires in 24 hours."
  });
}

export async function sendPasswordResetEmail({ to, token }) {
  return deliverAuthEmail({
    to,
    token,
    path: "/reset-password",
    subject: "Reset your Fantasy F1 password",
    intro: "Use the secure link below to reset your Fantasy F1 password.",
    actionLabel: "Reset password",
    expiryText: "This password reset link expires in 1 hour."
  });
}