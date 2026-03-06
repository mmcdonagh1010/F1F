import express from "express";
import { query } from "../db.js";
import { authRequired } from "../middleware/auth.js";
import { getPickLockMinutesBeforeDeadline } from "../services/settings.js";

const router = express.Router();

function getLockAt(deadlineAt, lockMinutes) {
  const lockMs = lockMinutes * 60 * 1000;
  return new Date(new Date(deadlineAt).getTime() - lockMs).toISOString();
}

router.get("/", authRequired, async (req, res) => {
  const lockMinutes = await getPickLockMinutesBeforeDeadline();
  const role = req.user.role || "player";
  const races = role === "admin"
    ? await query(
      `SELECT r.id, r.league_id, r.name, r.circuit_name, r.external_round, r.race_date, r.deadline_at, r.status, r.is_visible
       FROM races r
       ORDER BY r.race_date ASC`
    )
    : await query(
      `SELECT DISTINCT r.id, r.league_id, r.name, r.circuit_name, r.external_round, r.race_date, r.deadline_at, r.status, r.is_visible
       FROM races r
       JOIN race_leagues rl ON rl.race_id = r.id
       JOIN league_members lm ON lm.league_id = rl.league_id
       WHERE lm.user_id = $1
         AND r.is_visible = TRUE
       ORDER BY r.race_date ASC`,
      [req.user.id]
    );

  const withLockInfo = races.rows.map((race) => {
    const lockAt = getLockAt(race.deadline_at, lockMinutes);
    return {
      ...race,
      lock_at: lockAt,
      is_locked: new Date(lockAt).getTime() <= Date.now()
    };
  });

  return res.json(withLockInfo);
});

router.get("/:raceId", authRequired, async (req, res) => {
  const { raceId } = req.params;
  const lockMinutes = await getPickLockMinutesBeforeDeadline();
  const role = req.user.role || "player";

  const race = await query(
    `SELECT id, league_id, name, circuit_name, external_round, race_date, deadline_at, status, is_visible
     FROM races
     WHERE id = $1`,
    [raceId]
  );

  if (race.rowCount === 0) {
    return res.status(404).json({ error: "Race not found" });
  }

  const categories = await query(
    `SELECT id, name, display_order, is_position_based, exact_points, partial_points
     FROM pick_categories
     WHERE race_id = $1
     ORDER BY display_order ASC`,
    [raceId]
  );

  const drivers = await query(
    `SELECT id, driver_name, team_name, metadata, display_order
     FROM race_drivers
     WHERE race_id = $1
     ORDER BY display_order ASC`,
    [raceId]
  );

  const userLeagueRes = role === "admin"
    ? await query(
      `SELECT l.id, l.name
       FROM race_leagues rl
       JOIN leagues l ON l.id = rl.league_id
       WHERE rl.race_id = $1
       ORDER BY l.name ASC`,
      [raceId]
    )
    : await query(
      `SELECT l.id, l.name
       FROM race_leagues rl
       JOIN league_members lm ON lm.league_id = rl.league_id
       JOIN leagues l ON l.id = rl.league_id
       WHERE rl.race_id = $1
         AND lm.user_id = $2
       ORDER BY l.name ASC`,
      [raceId, req.user.id]
    );

  const availableLeagues = userLeagueRes.rows;

  if (role !== "admin" && race.rows[0].is_visible === false) {
    return res.status(404).json({ error: "Race not found" });
  }

  if (role !== "admin" && availableLeagues.length === 0) {
    return res.status(403).json({ error: "Race is not available in your leagues" });
  }

  const lockAt = getLockAt(race.rows[0].deadline_at, lockMinutes);

  return res.json({
    ...race.rows[0],
    available_leagues: availableLeagues,
    lock_at: lockAt,
    is_locked: new Date(lockAt).getTime() <= Date.now(),
    categories: categories.rows,
    drivers: drivers.rows
  });
});

export default router;
