import express from "express";
import { authRequired, adminRequired } from "../middleware/auth.js";
import Notification from "../models/Notification.js";
import LeagueMember from "../models/LeagueMember.js";
import Race from "../models/Race.js";

const router = express.Router();

router.post("/subscribe", authRequired, async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: "Missing push endpoint" });
  }

  await Notification.create({ user: req.user.id, type: 'push_subscribed', payload: { endpoint, keys } });

  return res.json({ message: "Push subscription saved" });
});

router.post("/send-deadline-reminders/:raceId", authRequired, adminRequired, async (req, res) => {
  const { raceId } = req.params;
  const race = await Race.findById(raceId).lean().exec();
  if (!race) return res.status(404).json({ error: 'Race not found' });

  const leagueIds = (race.leagues && race.leagues.length) ? race.leagues : (race.league ? [race.league] : []);

  const memberUsers = await LeagueMember.find({ league: { $in: leagueIds } }).distinct('user').exec();

  const recipients = await Notification.find({ user: { $in: memberUsers }, type: 'push_subscribed' }).exec();

  if (recipients.length > 0) {
    const docs = memberUsers.map((u) => ({ user: u, race: raceId, type: 'deadline_reminder', payload: { sent_at: new Date() } }));
    await Notification.insertMany(docs);
  }

  return res.json({ message: "Reminder job queued. Integrate web-push service in production.", usersTargeted: recipients.length });
});

export default router;
