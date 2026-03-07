import express from "express";
import { authRequired } from "../middleware/auth.js";
import { getPickLockMinutesBeforeDeadline } from "../services/settings.js";
import Pick from "../models/Pick.js";
import PickCategory from "../models/PickCategory.js";
import Race from "../models/Race.js";
import RaceDriver from "../models/RaceDriver.js";
import LeagueMember from "../models/LeagueMember.js";
import User from "../models/User.js";

const router = express.Router();

function getLockAt(deadlineAt, lockMinutes) {
  const lockMs = lockMinutes * 60 * 1000;
  return new Date(new Date(deadlineAt).getTime() - lockMs);
}

function isTeamBattleMarginCategory(categoryName) {
  const normalized = categoryName.toLowerCase();
  return normalized.includes("team battle") && normalized.includes("margin");
}

function isDriverOfWeekendCategory(categoryName) {
  return String(categoryName || "").toLowerCase().includes("driver of the weekend");
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
  if (isDriverOfWeekendCategory(normalized)) return false;
  if (category.is_position_based) return true;

  if (/\bp\d+\b/i.test(normalized)) return true;

  return ["driver", "winner", "pole", "fastest lap", "qualification", "result"].some((token) =>
    normalized.includes(token)
  );
}

function isReferencedPositionCategory(category) {
  const normalized = String(category?.name || "").toLowerCase();
  if (!category) return false;
  if (isDriverOfWeekendCategory(normalized)) return false;
  if (isTeamOfWeekendCategory(normalized)) return false;
  if (isTeamBattleDriverCategory(normalized) || isTeamBattleMarginCategory(normalized)) return false;
  return Boolean(category.is_position_based) || /\bp\d+\b/i.test(normalized);
}

function getConfiguredTeamForCategory(category) {
  return String(category?.metadata?.fixedTeam || "").trim().toLowerCase();
}

router.get("/:raceId", authRequired, async (req, res) => {
  const { raceId } = req.params;
  const requestedLeagueId = String(req.query.leagueId || "").trim() || null;

  // determine member leagues for this user and race
  const leagueMembers = await LeagueMember.find({ league: { $in: (await Race.findById(raceId).select('leagues league').lean().exec()).leagues || [] }, user: req.user.id }).lean().exec();
  if (!leagueMembers || leagueMembers.length === 0) return res.status(403).json({ error: "Race is not available in your leagues" });

  const availableLeagueIds = leagueMembers.map((m) => String(m.league));
  const effectiveLeagueId = requestedLeagueId || availableLeagueIds[0];
  if (!availableLeagueIds.includes(effectiveLeagueId)) return res.status(403).json({ error: "You are not a member of the selected league for this race" });

  const picks = await Pick.find({ race: raceId, league: effectiveLeagueId, user: req.user.id }).select('category value_text value_number').lean().exec();
  return res.json({ leagueId: effectiveLeagueId, picks });
});

router.post("/:raceId", authRequired, async (req, res) => {
  const { raceId } = req.params;
  const { picks, leagueId, applyToAllLeagues } = req.body;
  const lockMinutes = await getPickLockMinutesBeforeDeadline();

  if (!Array.isArray(picks) || picks.length === 0) {
    return res.status(400).json({ error: "picks must be a non-empty array" });
  }

  const race = await Race.findById(raceId).select('deadline_at').lean().exec();
  if (!race) return res.status(404).json({ error: 'Race not found' });
  if (getLockAt(race.deadline_at, lockMinutes).getTime() <= Date.now()) return res.status(423).json({ error: 'Picks are locked for this race' });

  const categories = await PickCategory.find({ race: raceId }).select('name is_position_based metadata').lean().exec();
  const categoriesById = new Map(categories.map((row) => [String(row._id), row]));
  const teamOfWeekendCategory = categories.find((row) => isTeamOfWeekendCategory(row.name));

  const driversRes = await RaceDriver.find({ race: raceId }).lean().exec();
  const validDrivers = new Set(driversRes.map((row) => row.driver_name.toLowerCase()));
  const validTeams = new Set(driversRes.map((row) => String(row.team_name || '').trim()).filter(Boolean).map((t) => t.toLowerCase()));
  const allowedMarginBands = new Set(['1-2','3-4','5+']);

  const leagueMembers = await LeagueMember.find({ league: { $in: (await Race.findById(raceId).select('leagues league').lean().exec()).leagues || [] }, user: req.user.id }).lean().exec();
  if (!leagueMembers || leagueMembers.length === 0) return res.status(403).json({ error: 'Race is not available in your leagues' });

  const availableLeagueIds = leagueMembers.map((r) => String(r.league));
  const defaultLeagueId = availableLeagueIds[0];
  const requestedLeagueIdLocal = String(leagueId || '').trim() || defaultLeagueId;
  if (!availableLeagueIds.includes(requestedLeagueIdLocal)) return res.status(403).json({ error: 'You are not a member of the selected league for this race' });

  const targetLeagueIds = applyToAllLeagues ? availableLeagueIds : [requestedLeagueIdLocal];
  const submittedByCategoryId = new Map((Array.isArray(picks) ? picks : []).map((pick) => [pick.categoryId, pick]));
  const selectedTeamOfWeekend = teamOfWeekendCategory ? String(submittedByCategoryId.get(String(teamOfWeekendCategory._id))?.valueText || '').trim().toLowerCase() : '';

  for (const pick of picks) {
    const category = categoriesById.get(pick.categoryId);
    if (!category) return res.status(400).json({ error: `Invalid category for race: ${pick.categoryId}` });
    if (isDriverOfWeekendCategory(category.name)) {
      const selectedPosition = Number(pick.valueNumber);
      if (!Number.isInteger(selectedPosition) || selectedPosition < 1 || selectedPosition > 20) {
        return res.status(400).json({ error: `Pick for '${category.name}' must be a position from 1 to 20` });
      }
      continue;
    }
    if (isDriverSelectionCategory(category)) {
      const selectedDriver = String(pick.valueText || '').trim().toLowerCase();
      if (!selectedDriver || !validDrivers.has(selectedDriver)) return res.status(400).json({ error: `Pick for '${category.name}' must be selected from the race driver list` });
    }
    if (isTeamOfWeekendCategory(category.name)) {
      const selectedTeam = String(pick.valueText || '').trim().toLowerCase();
      if (!selectedTeam || !validTeams.has(selectedTeam)) return res.status(400).json({ error: `Pick for '${category.name}' must be selected from a valid race team` });
    }
    const configuredTeam = getConfiguredTeamForCategory(category);
    const effectiveTeam = configuredTeam || selectedTeamOfWeekend;
    if (isTeamBattleDriverCategory(category.name) && effectiveTeam) {
      const selectedDriver = String(pick.valueText || '').trim().toLowerCase();
      const allowedTeamDrivers = new Set(driversRes.filter((row) => String(row.team_name || '').trim().toLowerCase() === effectiveTeam).map((row) => row.driver_name.toLowerCase()));
      if (!allowedTeamDrivers.has(selectedDriver)) return res.status(400).json({ error: 'Team Battle driver must belong to the selected Team of the Weekend' });
    }
    if (isTeamBattleMarginCategory(category.name)) {
      const selectedBand = String(pick.valueText || '').trim();
      if (!allowedMarginBands.has(selectedBand)) return res.status(400).json({ error: 'Team Battle Winning Margin must be one of: 1-2, 3-4, 5+' });
    }
  }

  for (const targetLeagueId of targetLeagueIds) {
    await Pick.deleteMany({ race: raceId, league: targetLeagueId, user: req.user.id }).exec();
    const docs = picks.map((p) => ({ race: raceId, league: targetLeagueId, user: req.user.id, category: p.categoryId, value_text: p.valueText || null, value_number: p.valueNumber ?? null }));
    if (docs.length) await Pick.insertMany(docs);
  }

  return res.json({ message: 'Picks saved', leagueIds: targetLeagueIds });
});

router.get("/:raceId/reveal", authRequired, async (req, res) => {
  const { raceId } = req.params;
  const requestedLeagueId = String(req.query.leagueId || "").trim() || null;
  const lockMinutes = await getPickLockMinutesBeforeDeadline();

  const race = await Race.findById(raceId).select('deadline_at leagues league').lean().exec();
  if (!race) return res.status(404).json({ error: 'Race not found' });
  if (getLockAt(race.deadline_at, lockMinutes).getTime() > Date.now()) return res.status(403).json({ error: 'Other picks unlock after race lock' });

  const memberLeagues = await LeagueMember.find({ league: { $in: race.leagues || [] }, user: req.user.id }).lean().exec();
  if (!memberLeagues || memberLeagues.length === 0) return res.status(403).json({ error: 'Race is not available in your leagues' });

  const availableLeagueIds = memberLeagues.map((m) => String(m.league));
  const effectiveLeagueIdLocal = requestedLeagueId || availableLeagueIds[0];
  if (!availableLeagueIds.includes(effectiveLeagueIdLocal)) return res.status(403).json({ error: 'You are not a member of the selected league for this race' });

  const allPicks = await Pick.find({ race: raceId, league: effectiveLeagueIdLocal }).populate({ path: 'user', select: 'name' }).populate({ path: 'category', select: 'name display_order' }).lean().exec();
  const mapped = allPicks.map((p) => ({ player_name: p.user ? p.user.name : null, category_id: String(p.category ? p.category._id : p.category), category_name: p.category ? p.category.name : null, value_text: p.value_text, value_number: p.value_number }));
  return res.json({ leagueId: effectiveLeagueIdLocal, picks: mapped });
});

export default router;
