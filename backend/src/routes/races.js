import express from "express";
import { authRequired } from "../middleware/auth.js";
import Race from "../models/Race.js";
import PickCategory from "../models/PickCategory.js";
import RaceDriver from "../models/RaceDriver.js";
import League from "../models/League.js";
import LeagueMember from "../models/LeagueMember.js";
import Result from "../models/Result.js";
import mongoose from "mongoose";

const router = express.Router();

function serializeCategory(category) {
  return {
    ...category,
    id: String(category._id)
  };
}

function serializeDriver(driver) {
  return {
    ...driver,
    id: String(driver._id)
  };
}

function arePredictionsLive(race) {
  return race?.predictions_live !== false;
}

router.get("/", authRequired, async (req, res) => {
  const role = req.user.role || "player";
  let racesDocs = [];
  if (role === 'admin') {
    racesDocs = await Race.find({}).sort({ race_date: 1 }).lean().exec();
  } else {
    const memberships = await LeagueMember.find({ user: req.user.id }).select('league').lean().exec();
    const leagueIds = memberships.map((m) => String(m.league));
    if (leagueIds.length > 0) {
      racesDocs = await Race.find({ leagues: { $in: leagueIds } }).sort({ race_date: 1 }).lean().exec();
    } else {
      racesDocs = [];
    }
  }

  if (role !== 'admin' && racesDocs.length > 0) {
    const categoryCounts = await PickCategory.aggregate([
      { $match: { race: { $in: racesDocs.map((race) => race._id) } } },
      { $group: { _id: "$race", count: { $sum: 1 } } }
    ]).exec();
    const configuredRaceIds = new Set(
      categoryCounts.filter((row) => row.count > 0).map((row) => String(row._id))
    );
    racesDocs = racesDocs.filter((race) => configuredRaceIds.has(String(race._id)));
  }

  const resultCounts = racesDocs.length > 0
    ? await Result.aggregate([
        { $match: { race: { $in: racesDocs.map((race) => race._id) } } },
        { $group: { _id: '$race', count: { $sum: 1 } } }
      ]).exec()
    : [];
  const resultsByRaceId = new Map(resultCounts.map((row) => [String(row._id), row.count > 0]));

  const withLockInfo = racesDocs.map((race) => {
    const lockAt = race.deadline_at;
    return {
      id: String(race._id),
      league_id: race.league || null,
      name: race.name,
      circuit_name: race.circuit_name,
      external_round: race.external_round || null,
      race_date: race.race_date,
      deadline_at: race.deadline_at,
      status: race.status || null,
      is_visible: Boolean(race.is_visible),
      predictions_live: arePredictionsLive(race),
      has_results: Boolean(resultsByRaceId.get(String(race._id))),
      lock_at: lockAt,
      is_locked: new Date(lockAt).getTime() <= Date.now()
    };
  });

  return res.json(withLockInfo);
});

router.get("/:raceId", authRequired, async (req, res) => {
  const { raceId } = req.params;
  const role = req.user.role || "player";

  // Load race
  const raceDoc = await Race.findById(raceId).lean().exec();
  if (!raceDoc) return res.status(404).json({ error: 'Race not found' });

  const categories = await PickCategory.find({ race: raceId }).sort({ display_order: 1 }).lean().exec();
  const drivers = await RaceDriver.find({ race: raceId }).sort({ display_order: 1 }).lean().exec();
  const hasResults = Boolean(await Result.exists({ race: raceId }));

  let availableLeagues = [];
  if (role === 'admin') {
    if (Array.isArray(raceDoc.leagues) && raceDoc.leagues.length) {
      const leagueDocs = await League.find({ _id: { $in: raceDoc.leagues } }).select('name').sort({ name: 1 }).lean().exec();
      availableLeagues = leagueDocs.map((l) => ({ id: String(l._id), name: l.name }));
    }
  } else {
    const membershipDocs = await LeagueMember.find({ user: req.user.id, league: { $in: raceDoc.leagues || [] } }).populate({ path: 'league', select: 'name' }).lean().exec();
    availableLeagues = membershipDocs.map((m) => ({ id: String(m.league._id), name: m.league.name }));
    if (availableLeagues.length === 0) return res.status(403).json({ error: 'Race is not available in your leagues' });
    if (categories.length === 0) return res.status(404).json({ error: 'Race not found' });
  }

  const lockAt = raceDoc.deadline_at;

  return res.json({
    id: String(raceDoc._id),
    league_id: raceDoc.league || null,
    name: raceDoc.name,
    circuit_name: raceDoc.circuit_name,
    external_round: raceDoc.external_round || null,
    race_date: raceDoc.race_date,
    deadline_at: raceDoc.deadline_at,
    status: raceDoc.status || null,
    is_visible: Boolean(raceDoc.is_visible),
    predictions_live: arePredictionsLive(raceDoc),
    has_results: hasResults,
    available_leagues: availableLeagues,
    lock_at: lockAt,
    is_locked: new Date(lockAt).getTime() <= Date.now(),
    categories: categories.map(serializeCategory),
    drivers: drivers.map(serializeDriver)
  });
});

export default router;
