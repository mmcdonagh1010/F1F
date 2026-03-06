import express from "express";
import { authRequired, adminRequired } from "../middleware/auth.js";
import { query } from "../db.js";

const router = express.Router();

router.post("/subscribe", authRequired, async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: "Missing push endpoint" });
  }

  await query(
    `INSERT INTO notifications (user_id, type, payload)
     VALUES ($1, 'push_subscribed', $2::jsonb)`,
    [req.user.id, JSON.stringify({ endpoint, keys })]
  );

  return res.json({ message: "Push subscription saved" });
});

router.post("/send-deadline-reminders/:raceId", authRequired, adminRequired, async (req, res) => {
  const { raceId } = req.params;

  const recipients = await query(
    `SELECT DISTINCT n.user_id, n.payload
     FROM notifications n
     JOIN league_members lm ON lm.user_id = n.user_id
     JOIN races r ON r.league_id = lm.league_id
     WHERE r.id = $1 AND n.type = 'push_subscribed'`,
    [raceId]
  );

  await query(
    `INSERT INTO notifications (user_id, race_id, type, payload)
     SELECT user_id, $1, 'deadline_reminder', jsonb_build_object('sent_at', NOW())
     FROM (
       SELECT DISTINCT n.user_id
       FROM notifications n
       WHERE n.type = 'push_subscribed'
     ) sq`,
    [raceId]
  );

  return res.json({
    message: "Reminder job queued. Integrate web-push service in production.",
    usersTargeted: recipients.rowCount
  });
});

export default router;
