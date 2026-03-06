import express from "express";
import { query } from "../db.js";
import { authRequired } from "../middleware/auth.js";

const router = express.Router();

async function getUserLeagues(userId) {
  const leaguesRes = await query(
    `SELECT l.id, l.name
     FROM league_members lm
     JOIN leagues l ON l.id = lm.league_id
     WHERE lm.user_id = $1
     ORDER BY l.name ASC`,
    [userId]
  );
  return leaguesRes.rows;
}

function resolveLeagueId(userLeagues, requestedLeagueId) {
  if (!userLeagues || userLeagues.length === 0) return null;
  const ids = userLeagues.map((league) => league.id);
  if (!requestedLeagueId) return ids[0];
  return ids.includes(requestedLeagueId) ? requestedLeagueId : null;
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

  return 0;
}

router.get("/season", authRequired, async (req, res) => {
  const nowYear = new Date().getUTCFullYear();
  const year = Number(req.query.year || nowYear);

  if (!Number.isInteger(year) || year < 1950 || year > 2100) {
    return res.status(400).json({ error: "Invalid year" });
  }

  const requestedLeagueId = String(req.query.leagueId || "").trim() || null;
  const userLeagues = await getUserLeagues(req.user.id);
  if (userLeagues.length === 0) {
    return res.status(403).json({ error: "You are not a member of any league" });
  }

  const leagueId = resolveLeagueId(userLeagues, requestedLeagueId);
  if (!leagueId) {
    return res.status(403).json({ error: "You are not a member of the selected league" });
  }

  const yearsRes = await query(
    `SELECT DISTINCT EXTRACT(YEAR FROM r.race_date)::int AS year
     FROM races r
     JOIN race_leagues rl ON rl.race_id = r.id
     WHERE rl.league_id = $1
     ORDER BY year DESC`
    , [leagueId]
  );
  const availableYears = yearsRes.rows.map((row) => row.year);

  const racesRes = await query(
    `SELECT r.id, r.name, r.race_date
     FROM races r
     JOIN race_leagues rl ON rl.race_id = r.id
     WHERE rl.league_id = $1
       AND EXTRACT(YEAR FROM r.race_date)::int = $2
     ORDER BY r.race_date ASC`,
    [leagueId, year]
  );
  const races = racesRes.rows;
  const raceIds = races.map((race) => race.id);

  const usersRes = await query(
    `SELECT u.id, u.name
     FROM league_members lm
     JOIN users u ON u.id = lm.user_id
     WHERE lm.league_id = $1
     ORDER BY u.name ASC`,
    [leagueId]
  );

  const pointsRes = await query(
    `SELECT s.user_id, s.race_id, s.points
     FROM scores s
     JOIN races r ON r.id = s.race_id
     WHERE s.league_id = $1
       AND EXTRACT(YEAR FROM r.race_date)::int = $2`,
    [leagueId, year]
  );

  const pointsByUser = new Map();
  for (const row of pointsRes.rows) {
    const userMap = pointsByUser.get(row.user_id) || new Map();
    userMap.set(row.race_id, Number(row.points));
    pointsByUser.set(row.user_id, userMap);
  }

  const rows = usersRes.rows
    .map((user) => {
      const userRaceMap = pointsByUser.get(user.id) || new Map();
      let totalPoints = 0;
      const racePoints = {};

      for (const raceId of raceIds) {
        const pts = Number(userRaceMap.get(raceId) || 0);
        racePoints[raceId] = pts;
        totalPoints += pts;
      }

      return {
        id: user.id,
        name: user.name,
        totalPoints,
        racePoints
      };
    })
    .sort((a, b) => b.totalPoints - a.totalPoints || a.name.localeCompare(b.name));

  return res.json({
    year,
    leagueId,
    availableLeagues: userLeagues,
    availableYears,
    races,
    rows
  });
});

router.get("/latest", authRequired, async (req, res) => {
  const nowYear = new Date().getUTCFullYear();
  const year = Number(req.query.year || nowYear);

  if (!Number.isInteger(year) || year < 1950 || year > 2100) {
    return res.status(400).json({ error: "Invalid year" });
  }

  const requestedLeagueId = String(req.query.leagueId || "").trim() || null;
  const userLeagues = await getUserLeagues(req.user.id);
  if (userLeagues.length === 0) {
    return res.status(403).json({ error: "You are not a member of any league" });
  }

  const leagueId = resolveLeagueId(userLeagues, requestedLeagueId);
  if (!leagueId) {
    return res.status(403).json({ error: "You are not a member of the selected league" });
  }

  const latestRaceRes = await query(
    `SELECT r.id, r.name, r.race_date
     FROM races r
     JOIN race_leagues rl ON rl.race_id = r.id
     WHERE EXTRACT(YEAR FROM r.race_date)::int = $1
       AND rl.league_id = $2
       AND EXISTS (
         SELECT 1
         FROM results rr
         WHERE rr.race_id = r.id
       )
     ORDER BY r.race_date DESC
     LIMIT 1`,
    [year, leagueId]
  );

  if (latestRaceRes.rowCount === 0) {
    return res.json({
      year,
      leagueId,
      availableLeagues: userLeagues,
      latestRace: null,
      categories: [],
      rows: []
    });
  }

  const latestRace = latestRaceRes.rows[0];

  const categoriesRes = await query(
    `SELECT id, name, display_order, is_position_based, exact_points, partial_points
     FROM pick_categories
     WHERE race_id = $1
     ORDER BY display_order ASC`,
    [latestRace.id]
  );
  const categories = categoriesRes.rows;

  const usersRes = await query(
    `SELECT u.id, u.name
     FROM league_members lm
     JOIN users u ON u.id = lm.user_id
     WHERE lm.league_id = $1
     ORDER BY u.name ASC`,
    [leagueId]
  );

  const picksRes = await query(
    `SELECT user_id, category_id, value_text, value_number
     FROM picks
     WHERE race_id = $1
       AND league_id = $2`,
    [latestRace.id, leagueId]
  );

  const resultsRes = await query(
    `SELECT category_id, value_text, value_number
     FROM results
     WHERE race_id = $1`,
    [latestRace.id]
  );

  const overallRes = await query(
    `SELECT s.user_id, COALESCE(SUM(s.points), 0) AS total_points
     FROM scores s
     JOIN races r ON r.id = s.race_id
     WHERE s.league_id = $1
       AND EXTRACT(YEAR FROM r.race_date)::int = $2
     GROUP BY s.user_id`,
    [leagueId, year]
  );

  const overallByUser = new Map(overallRes.rows.map((row) => [row.user_id, Number(row.total_points)]));

  const pickMap = new Map();
  for (const pick of picksRes.rows) {
    pickMap.set(`${pick.user_id}:${pick.category_id}`, pick);
  }

  const resultMap = new Map();
  for (const result of resultsRes.rows) {
    resultMap.set(result.category_id, result);
  }

  const actualPositionByScopeAndDriver = new Map();
  for (const category of categories) {
    const meta = parsePositionCategoryMeta(category.name);
    if (!meta) continue;

    const official = resultMap.get(category.id);
    const driverName = String(official?.value_text || "").trim().toLowerCase();
    if (!driverName) continue;
    actualPositionByScopeAndDriver.set(`${meta.scope}:${driverName}`, meta.position);
  }

  const rows = usersRes.rows
    .map((user) => {
      let raceTotal = 0;
      const categoryPoints = {};

      for (const category of categories) {
        const pick = pickMap.get(`${user.id}:${category.id}`);
        const result = resultMap.get(category.id);
        const points = calculatePickPoints(category, pick, result, actualPositionByScopeAndDriver);
        categoryPoints[category.id] = points;
        raceTotal += points;
      }

      return {
        id: user.id,
        name: user.name,
        raceTotal,
        overallPoints: overallByUser.get(user.id) || 0,
        categoryPoints
      };
    })
    .sort((a, b) => b.raceTotal - a.raceTotal || b.overallPoints - a.overallPoints || a.name.localeCompare(b.name));

  return res.json({
    year,
    leagueId,
    availableLeagues: userLeagues,
    latestRace,
    categories,
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
  const userLeagues = await getUserLeagues(req.user.id);
  if (userLeagues.length === 0) {
    return res.status(403).json({ error: "You are not a member of any league" });
  }

  const leagueId = resolveLeagueId(userLeagues, requestedLeagueId);
  if (!leagueId) {
    return res.status(403).json({ error: "You are not a member of the selected league" });
  }

  const targetMembership = await query(
    `SELECT 1
     FROM league_members
     WHERE league_id = $1
       AND user_id = $2`,
    [leagueId, userId]
  );
  if (targetMembership.rowCount === 0) {
    return res.status(403).json({ error: "User is not a member of this league" });
  }

  const userRes = await query(
    `SELECT id, name
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (userRes.rowCount === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  const racesRes = await query(
    `SELECT r.id, r.name, r.race_date
     FROM races r
     JOIN race_leagues rl ON rl.race_id = r.id
     WHERE rl.league_id = $1
       AND EXTRACT(YEAR FROM r.race_date)::int = $2
     ORDER BY r.race_date ASC`,
    [leagueId, year]
  );

  const availableRaces = racesRes.rows.map((race) => ({
    raceId: race.id,
    raceName: race.name,
    raceDate: race.race_date
  }));

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

  const categoryRes = await query(
    `SELECT id, race_id, name, display_order, is_position_based, exact_points, partial_points
     FROM pick_categories
     WHERE race_id = ANY($1::uuid[])
     ORDER BY race_id ASC, display_order ASC`,
    [selectedRaceIds]
  );

  const pickRes = await query(
    `SELECT race_id, category_id, value_text, value_number
     FROM picks
     WHERE user_id = $1
       AND league_id = $2
       AND race_id = ANY($3::uuid[])`,
    [userId, leagueId, selectedRaceIds]
  );

  const resultRes = await query(
    `SELECT race_id, category_id, value_text, value_number
     FROM results
     WHERE race_id = ANY($1::uuid[])`,
    [selectedRaceIds]
  );

  const pickMap = new Map();
  for (const row of pickRes.rows) {
    pickMap.set(`${row.race_id}:${row.category_id}`, row);
  }

  const resultMap = new Map();
  for (const row of resultRes.rows) {
    resultMap.set(`${row.race_id}:${row.category_id}`, row);
  }

  const categoriesByRace = new Map();
  for (const category of categoryRes.rows) {
    const list = categoriesByRace.get(category.race_id) || [];
    list.push(category);
    categoriesByRace.set(category.race_id, list);
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
    user: userRes.rows[0],
    totalPoints,
    races,
    availableRaces
  });
});

router.get("/race/:raceId", authRequired, async (req, res) => {
  const { raceId } = req.params;
  const requestedLeagueId = String(req.query.leagueId || "").trim() || null;
  const userLeagues = await getUserLeagues(req.user.id);
  if (userLeagues.length === 0) {
    return res.status(403).json({ error: "You are not a member of any league" });
  }

  const leagueId = resolveLeagueId(userLeagues, requestedLeagueId);
  if (!leagueId) {
    return res.status(403).json({ error: "You are not a member of the selected league" });
  }

  const board = await query(
    `SELECT u.id, u.name, COALESCE(s.points, 0) AS points
     FROM league_members lm
     JOIN users u ON u.id = lm.user_id
     LEFT JOIN scores s ON s.user_id = u.id AND s.race_id = $1 AND s.league_id = $2
     WHERE lm.league_id = $2
     ORDER BY points DESC, u.name ASC`,
    [raceId, leagueId]
  );

  return res.json({ leagueId, rows: board.rows });
});

export default router;
