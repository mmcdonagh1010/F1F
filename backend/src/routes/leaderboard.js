import express from "express";
import { authRequired } from "../middleware/auth.js";
import LeagueMember from "../models/LeagueMember.js";
import League from "../models/League.js";
import Race from "../models/Race.js";
import PickCategory from "../models/PickCategory.js";
import Pick from "../models/Pick.js";
import Result from "../models/Result.js";
import User from "../models/User.js";
import mongoose from "mongoose";
import {
  buildPickScoreDetail,
  formatEntryValue,
  resolveActualPositionByScopeAndDriver
} from "../services/scoring.js";

const router = express.Router();

async function getUserLeagues(userId, role = "player") {
  if (role === "admin") {
    const leagues = await League.find({}).sort({ name: 1 }).lean().exec();
    return leagues.map((league) => ({ id: String(league._id), name: league.name }));
  }

  const members = await LeagueMember.find({ user: userId }).populate('league', 'name').sort({ 'league.name': 1 }).lean().exec();
  return members.map((m) => ({ id: String(m.league._id), name: m.league.name }));
}

async function getPredictionLeagueMembers(leagueId) {
  const members = await LeagueMember.find({ league: leagueId })
    .populate({ path: 'user', select: 'name role' })
    .lean()
    .exec();

  return members.filter((member) => member.user && member.user.role !== 'admin');
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

async function buildSeasonLeaderboardScoreMaps({ leagueId, races, members, year }) {
  const raceIds = races.map((race) => String(race._id));
  const memberIds = members.map((member) => String(member.user._id));

  const pointsByUser = new Map(memberIds.map((userId) => [userId, new Map()]));
  const totalPointsByUser = new Map(memberIds.map((userId) => [userId, 0]));

  if (raceIds.length === 0 || memberIds.length === 0) {
    return { pointsByUser, totalPointsByUser };
  }

  const [categoryDocs, pickDocs, resultDocs] = await Promise.all([
    PickCategory.find({ race: { $in: raceIds } }).sort({ race: 1, display_order: 1 }).lean().exec(),
    Pick.find({ race: { $in: raceIds }, league: leagueId, status: "submitted" }).lean().exec(),
    Result.find({ race: { $in: raceIds } }).lean().exec()
  ]);

  const categoriesByRace = new Map();
  for (const category of categoryDocs) {
    const key = String(category.race);
    const list = categoriesByRace.get(key) || [];
    list.push(category);
    categoriesByRace.set(key, list);
  }

  const picksByRaceCategoryAndUser = new Map();
  for (const pick of pickDocs) {
    picksByRaceCategoryAndUser.set(`${String(pick.race)}:${String(pick.category)}:${String(pick.user)}`, pick);
  }

  const resultsByRace = new Map();
  for (const result of resultDocs) {
    const key = String(result.race);
    const list = resultsByRace.get(key) || [];
    list.push(result);
    resultsByRace.set(key, list);
  }

  for (const race of races) {
    const raceId = String(race._id);
    const categories = categoriesByRace.get(raceId) || [];
    const raceResults = resultsByRace.get(raceId) || [];
    const resultsByCategory = new Map(raceResults.map((row) => [String(row.category), row]));
    const actualPositionByScopeAndDriver = await resolveActualPositionByScopeAndDriver({
      race,
      categories,
      resultsByCategory,
      yearOverride: year
    });

    for (const member of members) {
      const userId = String(member.user._id);
      let racePoints = 0;

      for (const category of categories) {
        const categoryId = String(category._id);
        const pick = picksByRaceCategoryAndUser.get(`${raceId}:${categoryId}:${userId}`);
        const result = resultsByCategory.get(categoryId);
        const scoreDetail = buildPickScoreDetail(category, pick, result, actualPositionByScopeAndDriver);
        racePoints += scoreDetail.points;
      }

      pointsByUser.get(userId)?.set(raceId, racePoints);
      totalPointsByUser.set(userId, (totalPointsByUser.get(userId) || 0) + racePoints);
    }
  }

  return { pointsByUser, totalPointsByUser };
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
  const members = await getPredictionLeagueMembers(leagueId);
  const { pointsByUser } = await buildSeasonLeaderboardScoreMaps({ leagueId, races, members, year });

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
  const requestedRaceId = String(req.query.raceId || "").trim() || null;

  const candidateRaces = await Race.find({
    leagues: leagueId,
    race_date: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) }
  })
    .sort({ race_date: -1 })
    .lean()
    .exec();

  if (candidateRaces.length === 0) {
    return res.json({ year, leagueId, availableLeagues: userLeagues, latestRace: null, categories: [], rows: [] });
  }

  const candidateRaceIds = candidateRaces.map((race) => race._id);
  const racesWithResults = await Result.distinct("race", { race: { $in: candidateRaceIds } }).exec();
  const resultRaceIdSet = new Set(racesWithResults.map((raceId) => String(raceId)));

  const now = Date.now();
  const requestedRace = requestedRaceId
    ? candidateRaces.find((race) => String(race._id) === requestedRaceId) || null
    : null;
  const ongoingRace = candidateRaces.find((race) => {
    const deadlineAt = new Date(race.deadline_at || race.race_date).getTime();
    const raceAt = new Date(race.race_date).getTime();
    const weekendEnd = raceAt + 36 * 60 * 60 * 1000;
    return Number.isFinite(deadlineAt) && Number.isFinite(raceAt) && deadlineAt <= now && now <= weekendEnd;
  }) || null;
  const latestRaceWithResults = candidateRaces.find((race) => resultRaceIdSet.has(String(race._id))) || null;
  const latestRace = requestedRace || ongoingRace || latestRaceWithResults || candidateRaces[0] || null;

  if (!latestRace) return res.json({ year, leagueId, availableLeagues: userLeagues, latestRace: null, categories: [], rows: [] });

  const categories = await PickCategory.find({ race: latestRace._id }).sort({ display_order: 1 }).lean().exec();
  const members = await getPredictionLeagueMembers(leagueId);
  const picks = await Pick.find({ race: latestRace._id, league: leagueId, status: 'submitted' }).lean().exec();
  const results = await Result.find({ race: latestRace._id }).lean().exec();

  const { totalPointsByUser: overallByUser } = await buildSeasonLeaderboardScoreMaps({
    leagueId,
    races: candidateRaces,
    members,
    year
  });

  const pickMap = new Map(picks.map((p) => [`${String(p.user)}:${String(p.category)}`, p]));
  const resultMap = new Map(results.map((r) => [String(r.category), r]));
  const actualPositionByScopeAndDriver = await resolveActualPositionByScopeAndDriver({
    race: latestRace,
    categories,
    resultsByCategory: resultMap,
    yearOverride: year
  });

  const rows = members.map((m) => {
    let raceTotal = 0;
    const categoryPoints = {};
    const categoryPicks = {};
    const categoryDetails = {};
    for (const category of categories) {
      const pick = pickMap.get(`${String(m.user._id)}:${String(category._id)}`);
      const result = resultMap.get(String(category._id));
      const scoreDetail = buildPickScoreDetail(category, pick, result, actualPositionByScopeAndDriver);
      categoryPoints[String(category._id)] = scoreDetail.points;
      categoryPicks[String(category._id)] = scoreDetail.pickValue;
      categoryDetails[String(category._id)] = {
        pickValue: scoreDetail.pickValue,
        officialValue: scoreDetail.officialValue,
        points: scoreDetail.points,
        isPositionPrediction: scoreDetail.isPositionPrediction,
        positionsAway: scoreDetail.positionsAway,
        targetPosition: scoreDetail.targetPosition,
        actualPickedPosition: scoreDetail.actualPickedPosition
      };
      raceTotal += scoreDetail.points;
    }
    return {
      id: String(m.user._id),
      name: m.user.name,
      raceTotal,
      overallPoints: overallByUser.get(String(m.user._id)) || 0,
      categoryPoints,
      categoryPicks,
      categoryDetails
    };
  }).sort((a,b) => b.raceTotal - a.raceTotal || b.overallPoints - a.overallPoints || a.name.localeCompare(b.name));

  return res.json({
    year,
    leagueId,
    availableLeagues: userLeagues,
    latestRace: { id: String(latestRace._id), name: latestRace.name, race_date: latestRace.race_date },
    categories: categories.map((category) => ({
      id: String(category._id),
      name: category.name,
      display_order: category.display_order,
      officialValue: formatEntryValue(resultMap.get(String(category._id)))
    })),
    rows
  });
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

  const userDoc = await User.findById(userId).select('name role').lean().exec();
  if (!userDoc) return res.status(404).json({ error: 'User not found' });
  if (userDoc.role === 'admin') {
    return res.status(403).json({ error: 'Admin users do not participate in league predictions' });
  }

  const racesDocs = await Race.find({ leagues: leagueId, race_date: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) } })
    .sort({ race_date: 1 })
    .select('name race_date external_round')
    .lean()
    .exec();

  const availableRaces = racesDocs.map((race) => ({ raceId: String(race._id), raceName: race.name, raceDate: race.race_date }));

  if (raceIdFilter && !availableRaces.some((race) => race.raceId === raceIdFilter)) {
    return res.status(404).json({ error: "Race not found for selected year" });
  }

  const selectedRaceIds = raceIdFilter
    ? [raceIdFilter]
    : availableRaces.map((race) => race.raceId);

  if (selectedRaceIds.length === 0) {
    return res.json({
      year,
      leagueId,
      availableLeagues: userLeagues,
      selectedRaceId: raceIdFilter,
      user: { id: String(userDoc._id), name: userDoc.name },
      totalPoints: 0,
      races: [],
      availableRaces
    });
  }

  const raceDetails = availableRaces.filter((race) => selectedRaceIds.includes(race.raceId));

  // Convert selectedRaceIds to ObjectId array for mongoose queries
  const selectedRaceObjectIds = selectedRaceIds.map((id) => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id));

  const categoryDocs = await PickCategory.find({ race: { $in: selectedRaceObjectIds } }).sort({ race: 1, display_order: 1 }).lean().exec();
  const pickDocs = await Pick.find({ user: userId, league: leagueId, race: { $in: selectedRaceObjectIds }, status: 'submitted' }).lean().exec();
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

  let totalPoints = 0;
  const races = await Promise.all(raceDetails.map(async (race) => {
    const raceId = race.raceId || String(race._id);
    const categories = categoriesByRace.get(raceId) || [];
    const raceResults = resultDocs.filter((row) => String(row.race) === raceId);
    const actualPositionByScopeAndDriver = await resolveActualPositionByScopeAndDriver({
      race: {
        _id: raceId,
        race_date: race.raceDate || race.race_date,
        external_round: racesDocs.find((row) => String(row._id) === raceId)?.external_round || null
      },
      categories,
      resultsByCategory: new Map(raceResults.map((row) => [String(row.category), row])),
      yearOverride: year
    });
    let racePoints = 0;

    const picks = categories.map((category) => {
      const categoryId = String(category._id || category.id);
      const key = `${raceId}:${categoryId}`;
      const pick = pickMap.get(key);
      const result = resultMap.get(key);
      const scoreDetail = buildPickScoreDetail(category, pick, result, actualPositionByScopeAndDriver);
      racePoints += scoreDetail.points;

      return {
        categoryId,
        categoryName: category.name,
        pickValue: scoreDetail.pickValue,
        resultValue: scoreDetail.officialValue,
        points: scoreDetail.points,
        isPositionPrediction: scoreDetail.isPositionPrediction,
        positionsAway: scoreDetail.positionsAway,
        targetPosition: scoreDetail.targetPosition,
        actualPickedPosition: scoreDetail.actualPickedPosition
      };
    });

    totalPoints += racePoints;

    return {
      raceId,
      raceName: race.raceName || race.name,
      raceDate: race.raceDate || race.race_date,
      racePoints,
      picks
    };
  }));

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
    const members = await getPredictionLeagueMembers(leagueId);
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
