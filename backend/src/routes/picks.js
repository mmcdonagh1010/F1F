import express from "express";
import { query } from "../db.js";
import { authRequired } from "../middleware/auth.js";
import { getPickLockMinutesBeforeDeadline } from "../services/settings.js";

const router = express.Router();

function getLockAt(deadlineAt, lockMinutes) {
  const lockMs = lockMinutes * 60 * 1000;
  return new Date(new Date(deadlineAt).getTime() - lockMs);
}

function isTeamBattleMarginCategory(categoryName) {
  const normalized = categoryName.toLowerCase();
  return normalized.includes("team battle") && normalized.includes("margin");
}

function isTeamOfWeekendCategory(categoryName) {
  return String(categoryName || "").toLowerCase().includes("team of the weekend");
}

function isTeamBattleDriverCategory(categoryName) {
  const normalized = String(categoryName || "").toLowerCase();
  return normalized.includes("team battle") && normalized.includes("driver");
}

function isDriverSelectionCategory(category) {
  const normalized = category.name.toLowerCase();
  if (isTeamBattleMarginCategory(normalized)) return false;
  if (category.is_position_based) return true;

  if (/\bp\d+\b/i.test(normalized)) return true;

  return ["driver", "winner", "pole", "fastest lap", "qualification", "result"].some((token) =>
    normalized.includes(token)
  );
}

router.get("/:raceId", authRequired, async (req, res) => {
  const { raceId } = req.params;
  const requestedLeagueId = String(req.query.leagueId || "").trim() || null;

  const memberLeagues = await query(
    `SELECT rl.league_id
     FROM race_leagues rl
     JOIN league_members lm ON lm.league_id = rl.league_id
     WHERE rl.race_id = $1
       AND lm.user_id = $2
     ORDER BY rl.league_id ASC`,
    [raceId, req.user.id]
  );

  if (memberLeagues.rowCount === 0) {
    return res.status(403).json({ error: "Race is not available in your leagues" });
  }

  const availableLeagueIds = memberLeagues.rows.map((row) => row.league_id);
  const effectiveLeagueId = requestedLeagueId || availableLeagueIds[0];
  if (!availableLeagueIds.includes(effectiveLeagueId)) {
    return res.status(403).json({ error: "You are not a member of the selected league for this race" });
  }

  const picks = await query(
    `SELECT category_id, value_text, value_number
     FROM picks
     WHERE race_id = $1 AND league_id = $2 AND user_id = $3`,
    [raceId, effectiveLeagueId, req.user.id]
  );
  return res.json({ leagueId: effectiveLeagueId, picks: picks.rows });
});

router.post("/:raceId", authRequired, async (req, res) => {
  const { raceId } = req.params;
  const { picks, leagueId, applyToAllLeagues } = req.body;
  const lockMinutes = await getPickLockMinutesBeforeDeadline();

  if (!Array.isArray(picks) || picks.length === 0) {
    return res.status(400).json({ error: "picks must be a non-empty array" });
  }

  const raceRes = await query(
    `SELECT id, deadline_at
     FROM races
     WHERE id = $1`,
    [raceId]
  );

  if (raceRes.rowCount === 0) {
    return res.status(404).json({ error: "Race not found" });
  }

  const race = raceRes.rows[0];
  if (getLockAt(race.deadline_at, lockMinutes).getTime() <= Date.now()) {
    return res.status(423).json({ error: "Picks are locked for this race" });
  }

  const categoriesRes = await query(
    `SELECT id, name, is_position_based
     FROM pick_categories
     WHERE race_id = $1`,
    [raceId]
  );
  const categoriesById = new Map(categoriesRes.rows.map((row) => [row.id, row]));
  const teamOfWeekendCategory = categoriesRes.rows.find((row) => isTeamOfWeekendCategory(row.name));

  const driversRes = await query(
    `SELECT driver_name, team_name
     FROM race_drivers
     WHERE race_id = $1`,
    [raceId]
  );
  const validDrivers = new Set(driversRes.rows.map((row) => row.driver_name.toLowerCase()));
  const validTeams = new Set(
    driversRes.rows
      .map((row) => String(row.team_name || "").trim())
      .filter(Boolean)
      .map((team) => team.toLowerCase())
  );
  const allowedMarginBands = new Set(["1-2", "3-4", "5+"]);

  const memberLeagues = await query(
    `SELECT rl.league_id
     FROM race_leagues rl
     JOIN league_members lm ON lm.league_id = rl.league_id
     WHERE rl.race_id = $1
       AND lm.user_id = $2
     ORDER BY rl.league_id ASC`,
    [raceId, req.user.id]
  );

  if (memberLeagues.rowCount === 0) {
    return res.status(403).json({ error: "Race is not available in your leagues" });
  }

  const availableLeagueIds = memberLeagues.rows.map((row) => row.league_id);
  const defaultLeagueId = availableLeagueIds[0];
  const requestedLeagueId = String(leagueId || "").trim() || defaultLeagueId;
  if (!availableLeagueIds.includes(requestedLeagueId)) {
    return res.status(403).json({ error: "You are not a member of the selected league for this race" });
  }

  const targetLeagueIds = applyToAllLeagues ? availableLeagueIds : [requestedLeagueId];
  const submittedByCategoryId = new Map(
    (Array.isArray(picks) ? picks : []).map((pick) => [pick.categoryId, pick])
  );

  const selectedTeamOfWeekend = teamOfWeekendCategory
    ? String(submittedByCategoryId.get(teamOfWeekendCategory.id)?.valueText || "").trim().toLowerCase()
    : "";

  for (const pick of picks) {
    const category = categoriesById.get(pick.categoryId);
    if (!category) {
      return res.status(400).json({ error: `Invalid category for race: ${pick.categoryId}` });
    }

    if (isDriverSelectionCategory(category)) {
      const selectedDriver = String(pick.valueText || "").trim().toLowerCase();
      if (!selectedDriver || !validDrivers.has(selectedDriver)) {
        return res.status(400).json({
          error: `Pick for '${category.name}' must be selected from the race driver list`
        });
      }
    }

    if (isTeamOfWeekendCategory(category.name)) {
      const selectedTeam = String(pick.valueText || "").trim().toLowerCase();
      if (!selectedTeam || !validTeams.has(selectedTeam)) {
        return res.status(400).json({
          error: `Pick for '${category.name}' must be selected from a valid race team`
        });
      }
    }

    if (isTeamBattleDriverCategory(category.name) && selectedTeamOfWeekend) {
      const selectedDriver = String(pick.valueText || "").trim().toLowerCase();
      const allowedTeamDrivers = new Set(
        driversRes.rows
          .filter((row) => String(row.team_name || "").trim().toLowerCase() === selectedTeamOfWeekend)
          .map((row) => row.driver_name.toLowerCase())
      );

      if (!allowedTeamDrivers.has(selectedDriver)) {
        return res.status(400).json({
          error: "Team Battle driver must belong to the selected Team of the Weekend"
        });
      }
    }

    if (isTeamBattleMarginCategory(category.name)) {
      const selectedBand = String(pick.valueText || "").trim();
      if (!allowedMarginBands.has(selectedBand)) {
        return res.status(400).json({
          error: "Team Battle Winning Margin must be one of: 1-2, 3-4, 5+"
        });
      }
    }
  }

  for (const targetLeagueId of targetLeagueIds) {
    await query("DELETE FROM picks WHERE race_id = $1 AND league_id = $2 AND user_id = $3", [raceId, targetLeagueId, req.user.id]);

    for (const pick of picks) {
      await query(
        `INSERT INTO picks (race_id, league_id, user_id, category_id, value_text, value_number)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [raceId, targetLeagueId, req.user.id, pick.categoryId, pick.valueText || null, pick.valueNumber ?? null]
      );
    }
  }

  return res.json({ message: "Picks saved", leagueIds: targetLeagueIds });
});

router.get("/:raceId/reveal", authRequired, async (req, res) => {
  const { raceId } = req.params;
  const requestedLeagueId = String(req.query.leagueId || "").trim() || null;
  const lockMinutes = await getPickLockMinutesBeforeDeadline();

  const raceRes = await query("SELECT deadline_at FROM races WHERE id = $1", [raceId]);
  if (raceRes.rowCount === 0) {
    return res.status(404).json({ error: "Race not found" });
  }

  if (getLockAt(raceRes.rows[0].deadline_at, lockMinutes).getTime() > Date.now()) {
    return res.status(403).json({ error: "Other picks unlock after race lock" });
  }

  const memberLeagues = await query(
    `SELECT rl.league_id
     FROM race_leagues rl
     JOIN league_members lm ON lm.league_id = rl.league_id
     WHERE rl.race_id = $1
       AND lm.user_id = $2
     ORDER BY rl.league_id ASC`,
    [raceId, req.user.id]
  );
  if (memberLeagues.rowCount === 0) {
    return res.status(403).json({ error: "Race is not available in your leagues" });
  }

  const availableLeagueIds = memberLeagues.rows.map((row) => row.league_id);
  const effectiveLeagueId = requestedLeagueId || availableLeagueIds[0];
  if (!availableLeagueIds.includes(effectiveLeagueId)) {
    return res.status(403).json({ error: "You are not a member of the selected league for this race" });
  }

  const allPicks = await query(
    `SELECT u.name AS player_name, p.category_id, pc.name AS category_name, p.value_text, p.value_number
     FROM picks p
     JOIN users u ON u.id = p.user_id
     JOIN pick_categories pc ON pc.id = p.category_id
     WHERE p.race_id = $1
       AND p.league_id = $2
     ORDER BY u.name ASC, pc.display_order ASC`,
    [raceId, effectiveLeagueId]
  );

  return res.json({ leagueId: effectiveLeagueId, picks: allPicks.rows });
});

export default router;
