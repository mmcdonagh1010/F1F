import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import { connectMongo } from "../mongo.js";
import User from "../models/User.js";
import { buildDebugPreviewUrl, createRawToken, hashToken } from "../services/authTokens.js";

const router = express.Router();

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
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

router.post("/register", async (req, res) => {
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
  await User.create({
    name,
    email: normalizedEmail,
    password_hash: passwordHash,
    email_verification_token_hash: verification.tokenHash,
    email_verification_sent_at: verification.sentAt
  });
  return res.status(201).json({
    message: "Account created. Verify your email before logging in.",
    email: normalizedEmail,
    verificationPreviewUrl: buildDebugPreviewUrl("/verify-email", verification.rawToken)
  });
});

router.post("/login", async (req, res) => {
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

  const token = signToken({ id: String(found._id), name: found.name, email: found.email, role: found.role });
  return res.json({ token, user: { id: String(found._id), name: found.name, email: found.email, role: found.role } });
});

router.post("/verify-email", async (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (!token) return res.status(400).json({ error: "token is required" });

  await connectMongo();
  const found = await User.findOne({ email_verification_token_hash: hashToken(token) }).exec();
  if (!found) return res.status(400).json({ error: "Verification link is invalid or expired" });

  found.email_verified_at = new Date();
  found.email_verification_token_hash = null;
  found.email_verification_sent_at = null;
  await found.save();

  return res.json({ message: "Email verified. You can now log in." });
});

router.post("/verify-email/resend", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "email is required" });

  await connectMongo();
  const found = await User.findOne({ email }).exec();
  if (!found) {
    return res.json({ message: "If that account exists, a verification email has been prepared." });
  }

  if (found.email_verified_at) {
    return res.json({ message: "Email is already verified." });
  }

  const verification = createVerificationTokenFields();
  found.email_verification_token_hash = verification.tokenHash;
  found.email_verification_sent_at = verification.sentAt;
  await found.save();

  return res.json({
    message: "Verification email prepared.",
    verificationPreviewUrl: buildDebugPreviewUrl("/verify-email", verification.rawToken)
  });
});

router.post("/password-reset", async (_req, res) => {
  return res.json({
    message: "Password reset endpoint placeholder. Integrate with email provider in production."
  });
});

export default router;
