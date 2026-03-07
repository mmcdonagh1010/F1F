import express from "express";
import { authRequired } from "../middleware/auth.js";
import LeagueMember from "../models/LeagueMember.js";
import League from "../models/League.js";
import Race from "../models/Race.js";
import PickCategory from "../models/PickCategory.js";
import Pick from "../models/Pick.js";
import Result from "../models/Result.js";
import Score from "../models/Score.js";
import User from "../models/User.js";
import mongoose from "mongoose";

const router = express.Router();

async function getUserLeagues(userId, role = "player") {
  if (role === "admin") {
    const leagues = await League.find({}).sort({ name: 1 }).lean().exec();
    return leagues.map((league) => ({ id: String(league._id), name: league.name }));
  }

  const members = await LeagueMember.find({ user: userId }).populate('league', 'name').sort({ 'league.name': 1 }).lean().exec();
  return members.map((m) => ({ id: String(m.league._id), name: m.league.name }));
}

function resolveLeagueId(userLeagues, requestedLeagueId) {
  if (!userLeagues || userLeagues.length === 0) return null;
  const ids = userLeagues.map((league) => league.id);
  if (!requestedLeagueId) return ids[0];
  return ids.includes(requestedLeagueId) ? requestedLeagueId : ids[0];
}

function toObjectIdIfValid(value) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : value;
}

function parsePositionCategoryMeta(categoryName) {
  const match = String(categoryName || "").match(/(race result|sprint result|race qualification|sprint qualification)\s*p(\d+)/i);
  if (!match) return null;

  let scope = "race-result";
  const normalized = match[1].toLowerCase();
  if (normalized.includes("sprint") && normalized.includes("qualification")) scope = "sprint-qualification";
  else if (normalized.includes("race") && normalized.includes("qualification")) scope = "race-qualification";
  else if (normalized.includes("sprint")) scope = "sprint-result";

  return {
    scope,
    position: Number(match[2])
  };
}

function isDriverOfWeekendCategory(category) {
  return String(category?.name || "").toLowerCase().includes("driver of the weekend");
}

function calculatePickPoints(category, pick, result, actualPositionByScopeAndDriver) {
  if (!pick || !result) return 0;

  const exactText =
    pick.value_text !== null &&
    result.value_text !== null &&
    pick.value_text === result.value_text;

  const exactNumber =
    pick.value_number !== null &&
    result.value_number !== null &&
    Number(pick.value_number) === Number(result.value_number);

  if (exactText || exactNumber) {
    return Number(category.exact_points);
  }

  const meta = parsePositionCategoryMeta(category.name);
  if (meta && pick.value_text !== null) {
    const pickedDriver = String(pick.value_text || "").trim().toLowerCase();
    const actualPosition = actualPositionByScopeAndDriver.get(`${meta.scope}:${pickedDriver}`);
    if (Number.isInteger(actualPosition)) {
      const step = Math.max(1, Number(category.partial_points) || 1);
      const distance = Math.abs(actualPosition - meta.position);
      return Math.max(0, Number(category.exact_points) - distance * step);
    }
  }

  if (isDriverOfWeekendCategory(category) && pick.value_number !== null && result.value_number !== null) {
    const step = Math.max(1, Number(category.partial_points) || 1);
    const distance = Math.abs(Number(result.value_number) - Number(pick.value_number));
    return Math.max(0, Number(category.exact_points) - distance * step);
  }

  return 0;
}

router.get("/season", authRequired, async (req, res) => {
  const nowYear = new Date().getUTCFullYear();
  const year = Number(req.query.year || nowYear);

  if (!Number.isInteger(year) || year < 1950 || year > 2100) {
    return res.status(400).json({ error: "Invalid year" });
  }

  const requestedLeagueId = String(req.query.leagueId || "").trim() || null;
  const userLeagues = await getUserLeagues(req.user.id, req.user.role);
  if (userLeagues.length === 0) {
    return res.status(403).json({ error: "You are not a member of any league" });
  }

  const leagueId = resolveLeagueId(userLeagues, requestedLeagueId);
  if (!leagueId) {
    return res.status(403).json({ error: "You are not a member of the selected league" });
  }
  const leagueObjectId = toObjectIdIfValid(leagueId);

  const races = await Race.find({ leagues: leagueId, race_date: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) } }).sort({ race_date: 1 }).select('name race_date').lean().exec();
  const availableYearsRes = await Race.aggregate([
    { $unwind: "$leagues" },
    { $match: { leagues: leagueObjectId } },
    { $project: { year: { $year: "$race_date" } } },
    { $group: { _id: "$year" } },
    { $sort: { _id: -1 } }
  ]).exec();
  const availableYears = availableYearsRes.map((r) => r._id);

  const raceIds = races.map((r) => String(r._id));
  const members = await LeagueMember.find({ league: leagueId }).populate({ path: 'user', select: 'name' }).lean().exec();

  const pointsDocs = await Score.find({ league: leagueId, race: { $in: raceIds } }).lean().exec();
  const pointsByUser = new Map();
  for (const row of pointsDocs) {
    const userMap = pointsByUser.get(String(row.user)) || new Map();
    userMap.set(String(row.race), Number(row.points));
    pointsByUser.set(String(row.user), userMap);
  }

  const rows = members.map((m) => {
    const userId = String(m.user._id);
    const userRaceMap = pointsByUser.get(userId) || new Map();
    let totalPoints = 0;
    const racePoints = {};
    for (const raceId of raceIds) {
      const pts = Number(userRaceMap.get(raceId) || 0);
      racePoints[raceId] = pts;
      totalPoints += pts;
    }
    return { id: userId, name: m.user.name, totalPoints, racePoints };
  }).sort((a,b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));

  return res.json({ year, leagueId, availableLeagues: userLeagues, availableYears, races: races.map(r=>({ id: String(r._id), name: r.name, race_date: r.race_date })), rows });
});

router.get("/latest", authRequired, async (req, res) => {
  const nowYear = new Date().getUTCFullYear();
  const year = Number(req.query.year || nowYear);

  if (!Number.isInteger(year) || year < 1950 || year > 2100) {
    return res.status(400).json({ error: "Invalid year" });
  }

  const requestedLeagueId = String(req.query.leagueId || "").trim() || null;
  const userLeagues = await getUserLeagues(req.user.id, req.user.role);
  if (userLeagues.length === 0) {
    return res.status(403).json({ error: "You are not a member of any league" });
  }

  const leagueId = resolveLeagueId(userLeagues, requestedLeagueId);
  if (!leagueId) {
    return res.status(403).json({ error: "You are not a member of the selected league" });
  }
  const leagueObjectId = toObjectIdIfValid(leagueId);

  const latestRace = await Race.findOne({ leagues: leagueId, race_date: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) } }).where('_id').ne(null).sort({ race_date: -1 }).lean().exec();
  if (!latestRace) return res.json({ year, leagueId, availableLeagues: userLeagues, latestRace: null, categories: [], rows: [] });

  const categories = await PickCategory.find({ race: latestRace._id }).sort({ display_order: 1 }).lean().exec();
  const members = await LeagueMember.find({ league: leagueId }).populate({ path: 'user', select: 'name' }).lean().exec();
  const picks = await Pick.find({ race: latestRace._id, league: leagueId }).lean().exec();
  const results = await Result.find({ race: latestRace._id }).lean().exec();

  const overallDocs = await Score.aggregate([
    { $match: { league: leagueObjectId } },
    { $lookup: { from: 'races', localField: 'race', foreignField: '_id', as: 'race' } },
    { $unwind: '$race' },
    { $match: { 'race.race_date': { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) } } },
    { $group: { _id: '$user', total_points: { $sum: '$points' } } }
  ]).exec();
  const overallByUser = new Map(overallDocs.map((d) => [String(d._id), Number(d.total_points)]));

  const pickMap = new Map(picks.map((p) => [`${String(p.user)}:${String(p.category)}`, p]));
  const resultMap = new Map(results.map((r) => [String(r.category), r]));

  const actualPositionByScopeAndDriver = new Map();
  for (const category of categories) {
    const meta = parsePositionCategoryMeta(category.name);
    if (!meta) continue;
    const official = resultMap.get(String(category._id));
    const driverName = String(official?.value_text || '').trim().toLowerCase();
    if (!driverName) continue;
    actualPositionByScopeAndDriver.set(`${meta.scope}:${driverName}`, meta.position);
  }

  const rows = members.map((m) => {
    let raceTotal = 0;
    const categoryPoints = {};
    for (const category of categories) {
      const pick = pickMap.get(`${String(m.user._id)}:${String(category._id)}`);
      const result = resultMap.get(String(category._id));
      const points = calculatePickPoints(category, pick, result, actualPositionByScopeAndDriver);
      categoryPoints[String(category._id)] = points;
      raceTotal += points;
    }
    return { id: String(m.user._id), name: m.user.name, raceTotal, overallPoints: overallByUser.get(String(m.user._id)) || 0, categoryPoints };
  }).sort((a,b) => b.raceTotal - a.raceTotal || b.overallPoints - a.overallPoints || a.name.localeCompare(b.name));

  return res.json({ year, leagueId, availableLeagues: userLeagues, latestRace: { id: String(latestRace._id), name: latestRace.name, race_date: latestRace.race_date }, categories, rows });
});

router.get("/season/player/:userId", authRequired, async (req, res) => {
  const nowYear = new Date().getUTCFullYear();
  const year = Number(req.query.year || nowYear);
  const raceIdFilter = req.query.raceId ? String(req.query.raceId) : null;
  const { userId } = req.params;

  if (!Number.isInteger(year) || year < 1950 || year > 2100) {
    return res.status(400).json({ error: "Invalid year" });
  }

  const requestedLeagueId = String(req.query.leagueId || "").trim() || null;
  const userLeagues = await getUserLeagues(req.user.id, req.user.role);
  if (userLeagues.length === 0) {
    return res.status(403).json({ error: "You are not a member of any league" });
  }

  const leagueId = resolveLeagueId(userLeagues, requestedLeagueId);
  if (!leagueId) {
    return res.status(403).json({ error: "You are not a member of the selected league" });
  }

  const membership = await LeagueMember.findOne({ league: leagueId, user: userId }).lean().exec();
  if (!membership) return res.status(403).json({ error: "User is not a member of this league" });

  const userDoc = await User.findById(userId).select('name').lean().exec();
  if (!userDoc) return res.status(404).json({ error: 'User not found' });

  const racesDocs = await Race.find({ leagues: leagueId, race_date: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) } })
    .sort({ race_date: 1 })
    .select('name race_date')
    .lean()
    .exec();

  const availableRaces = racesDocs.map((race) => ({ raceId: String(race._id), raceName: race.name, raceDate: race.race_date }));

  if (raceIdFilter && !availableRaces.some((race) => race.raceId === raceIdFilter)) {
    return res.status(404).json({ error: "Race not found for selected year" });
  }

  const selectedRaceIds = raceIdFilter
    ? [raceIdFilter]
    : racesRes.rows.map((race) => race.id);

  if (selectedRaceIds.length === 0) {
    return res.json({
      year,
      selectedRaceId: raceIdFilter,
      user: userRes.rows[0],
      totalPoints: 0,
      races: [],
      availableRaces
    });
  }

  const raceDetails = racesRes.rows.filter((race) => selectedRaceIds.includes(race.id));

  // Convert selectedRaceIds to ObjectId array for mongoose queries
  const selectedRaceObjectIds = selectedRaceIds.map((id) => (mongoose.Types.ObjectId.isValid(id) ? mongoose.Types.ObjectId(id) : id));

  const categoryDocs = await PickCategory.find({ race: { $in: selectedRaceObjectIds } }).sort({ race: 1, display_order: 1 }).lean().exec();
  const pickDocs = await Pick.find({ user: userId, league: leagueId, race: { $in: selectedRaceObjectIds } }).lean().exec();
  const resultDocs = await Result.find({ race: { $in: selectedRaceObjectIds } }).lean().exec();

  const pickMap = new Map();
  for (const row of pickDocs) {
    pickMap.set(`${String(row.race)}:${String(row.category)}`, row);
  }

  const resultMap = new Map();
  for (const row of resultDocs) {
    resultMap.set(`${String(row.race)}:${String(row.category)}`, row);
  }

  const categoriesByRace = new Map();
  for (const category of categoryDocs) {
    const key = String(category.race);
    const list = categoriesByRace.get(key) || [];
    list.push(category);
    categoriesByRace.set(key, list);
  }

  function formatPickValue(entry) {
    if (!entry) return null;
    if (entry.value_text !== null && entry.value_text !== undefined) return entry.value_text;
    if (entry.value_number !== null && entry.value_number !== undefined) return String(entry.value_number);
    return null;
  }

  let totalPoints = 0;
  const races = raceDetails.map((race) => {
    const categories = categoriesByRace.get(race.id) || [];
    let racePoints = 0;

    const picks = categories.map((category) => {
      const key = `${race.id}:${category.id}`;
      const pick = pickMap.get(key);
      const result = resultMap.get(key);
      const points = calculatePickPoints(category, pick, result);
      racePoints += points;

      return {
        categoryId: category.id,
        categoryName: category.name,
        pickValue: formatPickValue(pick),
        resultValue: formatPickValue(result),
        points
      };
    });

    totalPoints += racePoints;

    return {
      raceId: race.id,
      raceName: race.name,
      raceDate: race.race_date,
      racePoints,
      picks
    };
  });

  return res.json({
    year,
    leagueId,
    availableLeagues: userLeagues,
    selectedRaceId: raceIdFilter,
    user: { id: String(userDoc._id), name: userDoc.name },
    totalPoints,
    races,
    availableRaces
  });
});

router.get("/race/:raceId", authRequired, async (req, res) => {
  const { raceId } = req.params;
  const requestedLeagueId = String(req.query.leagueId || "").trim() || null;
  const userLeagues = await getUserLeagues(req.user.id, req.user.role);
  if (userLeagues.length === 0) {
    return res.status(403).json({ error: "You are not a member of any league" });
  }

  const leagueId = resolveLeagueId(userLeagues, requestedLeagueId);
  if (!leagueId) {
    return res.status(403).json({ error: "You are not a member of the selected league" });
  }

  try {
    const members = await LeagueMember.find({ league: leagueId }).populate({ path: 'user', select: 'name' }).lean().exec();
    const rows = [];
    for (const m of members) {
      const uid = m.user ? String(m.user._id) : null;
      const scoreDoc = uid ? await Score.findOne({ user: uid, race: raceId, league: leagueId }).lean().exec() : null;
      const points = scoreDoc ? Number(scoreDoc.points) : 0;
      rows.push({ id: uid, name: m.user ? m.user.name : null, points });
    }
    rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    return res.json({ leagueId, rows });
  } catch (err) {
    console.error('Fetch race leaderboard failed', err);
    return res.status(500).json({ error: 'Failed to fetch race leaderboard' });
  }
});

export default router;
