import { config } from "../config.js";

function requireEmailConfig() {
  if (config.emailProvider !== "resend") {
    throw new Error("Email delivery is not configured");
  }

  if (!config.resendApiKey || !config.emailFrom) {
    throw new Error("Resend email delivery is missing required configuration");
  }
}

export function isEmailDeliveryConfigured() {
  return config.emailProvider === "resend" && Boolean(config.resendApiKey) && Boolean(config.emailFrom);
}

export async function sendEmail({ to, subject, text, html }) {
  requireEmailConfig();

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [to],
      reply_to: config.emailReplyTo || undefined,
      subject,
      text,
      html
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Email provider error (${response.status})`);
    error.providerResponse = errorText;
    throw error;
  }

  return response.json();
}