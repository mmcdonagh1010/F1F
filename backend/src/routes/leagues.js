import express from "express";
import mongoose from 'mongoose';
import { authRequired } from "../middleware/auth.js";
import League from "../models/League.js";
import LeagueMember from "../models/LeagueMember.js";

const router = express.Router();

router.use(authRequired);

router.get("/mine", async (req, res) => {
  if (req.user.role === "admin") {
    return res.json([]);
  }

  const userId = req.user.id;
  const members = await LeagueMember.find({ user: userId }).populate('league').sort({ joined_at: -1 }).exec();

  const mapped = members.map((m) => ({
    id: m.league._id,
    name: m.league.name,
    invite_code: m.league.invite_code,
    joined_at: m.joined_at
  }));

  return res.json(mapped);
});

router.post("/join", async (req, res) => {
  if (req.user.role === "admin") {
    return res.status(403).json({ error: "Admin users cannot join leagues for predictions" });
  }

  const inviteCode = String(req.body?.inviteCode || "").trim().toUpperCase();
  if (!inviteCode) {
    return res.status(400).json({ error: "inviteCode is required" });
  }

  const league = await League.findOne({ invite_code: inviteCode }).lean().exec();
  if (!league) {
    return res.status(404).json({ error: "Invalid invite code" });
  }

  await LeagueMember.updateOne(
    { league: league._id, user: req.user.id },
    { $setOnInsert: { joined_at: new Date() } },
    { upsert: true }
  ).exec();

  return res.json({ message: "Joined league", league: { id: league._id, name: league.name, invite_code: league.invite_code } });
});

export default router;
