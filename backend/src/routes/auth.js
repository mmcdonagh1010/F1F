import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../config.js";
import { connectMongo } from "../mongo.js";
import User from "../models/User.js";

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
    { id: String(id), email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { name, email, password } = parsed.data;
  await connectMongo();
  const existing = await User.findOne({ email }).lean().exec();
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(password, 10);
  const created = await User.create({ name, email, password_hash: passwordHash });
  const user = { id: String(created._id), name: created.name, email: created.email, role: created.role };
  const token = signToken({ id: user.id, email: user.email, role: user.role });
  return res.status(201).json({ token, user });
});

router.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;
  await connectMongo();
  const found = await User.findOne({ email }).exec();
  if (!found) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, found.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken({ id: String(found._id), email: found.email, role: found.role });
  return res.json({ token, user: { id: String(found._id), name: found.name, email: found.email, role: found.role } });
});

router.post("/password-reset", async (_req, res) => {
  return res.json({
    message: "Password reset endpoint placeholder. Integrate with email provider in production."
  });
});

export default router;
