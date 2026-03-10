import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import { authRequired } from "../middleware/auth.js";
import { buildRateLimiter } from "../middleware/rateLimit.js";
import { connectMongo } from "../mongo.js";
import User from "../models/User.js";
import { createRawToken, hashToken } from "../services/authTokens.js";
import {
  getPasswordResetPreparedMessage,
  getVerificationEmailPreparedMessage,
  sendPasswordResetEmail,
  sendVerificationEmail
} from "../services/authEmail.js";

const router = express.Router();

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8)
});

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const forgotPasswordSchema = z.object({
  email: z.string().email()
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8)
});

const registerRateLimit = buildRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Too many registration attempts. Try again later."
});

const loginRateLimit = buildRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: "Too many login attempts. Try again later."
});

const emailActionRateLimit = buildRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many email requests. Try again later."
});

const resetPasswordRateLimit = buildRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many password reset attempts. Try again later."
});

function signToken(user) {
  const id = user.id || user._id || (user._id && user._id.toString());
  return jwt.sign(
    { id: String(id), name: user.name, email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

function createVerificationTokenFields() {
  const rawToken = createRawToken();
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    sentAt: new Date()
  };
}

function buildSessionUser(user) {
  return {
    id: String(user._id || user.id),
    name: user.name,
    email: user.email,
    role: user.role
  };
}

function getSessionExpiresAt(token) {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded !== "object" || typeof decoded.exp !== "number") {
    return null;
  }

  return new Date(decoded.exp * 1000).toISOString();
}

function getAuthCookieOptions(token) {
  const expiresAt = getSessionExpiresAt(token);
  const cookieOptions = {
    httpOnly: true,
    secure: config.authCookieSecure,
    sameSite: config.authCookieSameSite,
    partitioned: config.authCookiePartitioned,
    path: "/"
  };

  if (expiresAt) {
    cookieOptions.expires = new Date(expiresAt);
  }

  return cookieOptions;
}

function setAuthCookie(res, token) {
  res.cookie(config.authCookieName, token, getAuthCookieOptions(token));
}

function clearAuthCookie(res) {
  res.clearCookie(config.authCookieName, {
    httpOnly: true,
    secure: config.authCookieSecure,
    sameSite: config.authCookieSameSite,
    partitioned: config.authCookiePartitioned,
    path: "/"
  });
}

router.post("/register", registerRateLimit, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { name, email, password } = parsed.data;
  const normalizedEmail = String(email).trim().toLowerCase();
  await connectMongo();
  const existing = await User.findOne({ email: normalizedEmail }).lean().exec();
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(password, 10);
  const verification = createVerificationTokenFields();
  const createdUser = await User.create({
    name,
    email: normalizedEmail,
    password_hash: passwordHash,
    email_verification_token_hash: verification.tokenHash,
    email_verification_sent_at: verification.sentAt
  });

  try {
    const delivery = await sendVerificationEmail({ to: normalizedEmail, token: verification.rawToken });
    return res.status(201).json({
      message: delivery.delivery === "email"
        ? "Account created. Check your email to verify your account before logging in."
        : "Account created. Verify your email before logging in.",
      email: normalizedEmail,
      verificationPreviewUrl: delivery.previewUrl
    });
  } catch (error) {
    await User.deleteOne({ _id: createdUser._id }).exec();
    console.error("Failed to deliver registration verification email", {
      email: normalizedEmail,
      message: error.message,
      providerResponse: error.providerResponse || null,
      emailProvider: config.emailProvider,
      hasResendApiKey: Boolean(config.resendApiKey),
      emailFrom: config.emailFrom || null
    });
    return res.status(502).json({ error: "Unable to send verification email right now. Please try again later." });
  }
});

router.post("/login", loginRateLimit, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;
  const normalizedEmail = String(email).trim().toLowerCase();
  await connectMongo();
  const found = await User.findOne({ email: normalizedEmail }).exec();
  if (!found) return res.status(401).json({ error: 'Invalid credentials' });

  if (!found.email_verified_at) {
    return res.status(403).json({
      error: "Verify your email before logging in",
      verificationRequired: true
    });
  }

  const ok = await bcrypt.compare(password, found.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const sessionUser = buildSessionUser(found);
  const token = signToken(sessionUser);
  setAuthCookie(res, token);

  return res.json({
    user: sessionUser,
    sessionExpiresAt: getSessionExpiresAt(token)
  });
});

router.get("/me", authRequired, async (req, res) => {
  await connectMongo();
  const found = await User.findById(req.user.id).lean().exec();
  if (!found) {
    clearAuthCookie(res);
    return res.status(401).json({ error: "Session is no longer valid" });
  }

  return res.json({
    user: buildSessionUser(found),
    sessionExpiresAt: req.user.exp ? new Date(req.user.exp * 1000).toISOString() : null
  });
});

router.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  return res.json({ message: "Logged out" });
});

router.post("/verify-email", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!token) return res.status(400).json({ error: "token is required" });

  await connectMongo();
  const found = await User.findOne({ email_verification_token_hash: hashToken(token) }).exec();
  if (!found) return res.status(400).json({ error: "Verification link is invalid or expired" });

  const sentAt = found.email_verification_sent_at ? new Date(found.email_verification_sent_at).getTime() : 0;
  if (!sentAt || sentAt + EMAIL_VERIFICATION_TTL_MS < Date.now()) {
    found.email_verification_token_hash = null;
    await found.save();
    return res.status(400).json({ error: "Verification link is invalid or expired" });
  }

  found.email_verified_at = new Date();
  found.email_verification_token_hash = null;
  found.email_verification_sent_at = null;
  await found.save();

  return res.json({ message: "Email verified. You can now log in." });
});

router.post("/verify-email/resend", emailActionRateLimit, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "email is required" });

  await connectMongo();
  const found = await User.findOne({ email }).exec();
  if (!found) {
    return res.json({ message: "If that account exists, a verification email has been sent." });
  }

  if (found.email_verified_at) {
    return res.json({ message: "Email is already verified." });
  }

  const verification = createVerificationTokenFields();
  found.email_verification_token_hash = verification.tokenHash;
  found.email_verification_sent_at = verification.sentAt;
  await found.save();

  try {
    const delivery = await sendVerificationEmail({ to: found.email, token: verification.rawToken });
    return res.json({
      message: getVerificationEmailPreparedMessage(delivery.delivery),
      verificationPreviewUrl: delivery.previewUrl
    });
  } catch (error) {
    found.email_verification_token_hash = null;
    found.email_verification_sent_at = null;
    await found.save();
    console.error("Failed to resend verification email", {
      email: found.email,
      message: error.message,
      providerResponse: error.providerResponse || null,
      emailProvider: config.emailProvider,
      hasResendApiKey: Boolean(config.resendApiKey),
      emailFrom: config.emailFrom || null
    });
    return res.status(502).json({ error: "Unable to send verification email right now. Please try again later." });
  }
});

router.post("/forgot-password", emailActionRateLimit, async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const email = String(parsed.data.email).trim().toLowerCase();
  await connectMongo();
  const found = await User.findOne({ email }).exec();

  if (!found || !found.email_verified_at) {
    return res.json({ message: "If that account exists, a password reset email has been sent." });
  }

  const reset = createVerificationTokenFields();
  found.password_reset_token_hash = reset.tokenHash;
  found.password_reset_expires_at = new Date(Date.now() + 60 * 60 * 1000);
  await found.save();

  try {
    const delivery = await sendPasswordResetEmail({ to: found.email, token: reset.rawToken });
    return res.json({
      message: getPasswordResetPreparedMessage(delivery.delivery),
      resetPreviewUrl: delivery.previewUrl
    });
  } catch (error) {
    found.password_reset_token_hash = null;
    found.password_reset_expires_at = null;
    await found.save();
    console.error("Failed to send password reset email", {
      email: found.email,
      message: error.message,
      providerResponse: error.providerResponse || null,
      emailProvider: config.emailProvider,
      hasResendApiKey: Boolean(config.resendApiKey),
      emailFrom: config.emailFrom || null
    });
    return res.status(502).json({ error: "Unable to send password reset email right now. Please try again later." });
  }
});

router.post("/reset-password", resetPasswordRateLimit, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  await connectMongo();
  const found = await User.findOne({ password_reset_token_hash: hashToken(parsed.data.token) }).exec();
  if (!found || !found.password_reset_expires_at || found.password_reset_expires_at.getTime() < Date.now()) {
    return res.status(400).json({ error: "Password reset link is invalid or expired" });
  }

  found.password_hash = await bcrypt.hash(parsed.data.password, 10);
  found.password_reset_token_hash = null;
  found.password_reset_expires_at = null;
  await found.save();

  return res.json({ message: "Password updated. You can now log in." });
});

export default router;
