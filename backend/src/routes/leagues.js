import express from "express";
import { query } from "../db.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

router.use(authRequired);

router.get("/mine", async (req, res) => {
  const leagues = await query(
    `SELECT l.id, l.name, l.invite_code, lm.joined_at
     FROM league_members lm
     JOIN leagues l ON l.id = lm.league_id
     WHERE lm.user_id = $1
     ORDER BY lm.joined_at DESC`,
    [req.user.id]
  );

  return res.json(leagues.rows);
});

router.post("/join", async (req, res) => {
  const inviteCode = String(req.body?.inviteCode || "").trim().toUpperCase();
  if (!inviteCode) {
    return res.status(400).json({ error: "inviteCode is required" });
  }

  const league = await query(
    `SELECT id, name, invite_code
     FROM leagues
     WHERE invite_code = $1
     LIMIT 1`,
    [inviteCode]
  );

  if (league.rowCount === 0) {
    return res.status(404).json({ error: "Invalid invite code" });
  }

  await query(
    `INSERT INTO league_members (league_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [league.rows[0].id, req.user.id]
  );

  return res.json({ message: "Joined league", league: league.rows[0] });
});

export default router;
