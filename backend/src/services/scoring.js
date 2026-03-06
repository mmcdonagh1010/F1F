import { query } from "../db.js";

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

export async function calculateRaceScores(raceId, targetLeagueId = null) {
  const categoriesRes = await query(
    `SELECT id, name, is_position_based, exact_points, partial_points
     FROM pick_categories
     WHERE race_id = $1
     ORDER BY display_order ASC`,
    [raceId]
  );

  const resultsRes = await query(
    `SELECT category_id, value_text, value_number
     FROM results
     WHERE race_id = $1`,
    [raceId]
  );

  const picksRes = await query(
    `SELECT p.league_id, p.user_id, p.category_id, p.value_text, p.value_number
     FROM picks p
     WHERE p.race_id = $1
       AND ($2::uuid IS NULL OR p.league_id = $2)`,
    [raceId, targetLeagueId]
  );

  const categories = categoriesRes.rows;
  const resultsByCategory = new Map(resultsRes.rows.map((r) => [r.category_id, r]));

  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const actualPositionByScopeAndDriver = new Map();

  for (const category of categories) {
    const meta = parsePositionCategoryMeta(category.name);
    if (!meta) continue;

    const official = resultsByCategory.get(category.id);
    const driverName = String(official?.value_text || "").trim().toLowerCase();
    if (!driverName) continue;

    actualPositionByScopeAndDriver.set(`${meta.scope}:${driverName}`, meta.position);
  }

  const leagueUserScoreMap = new Map();

  for (const pick of picksRes.rows) {
    const category = categoriesById.get(pick.category_id);
    const official = resultsByCategory.get(pick.category_id);
    if (!category || !official) continue;

    const exactText = pick.value_text && official.value_text && pick.value_text === official.value_text;
    const exactNumber = pick.value_number !== null && official.value_number !== null && pick.value_number === official.value_number;

    let earned = 0;

    if (exactText || exactNumber) {
      earned = category.exact_points;
    } else {
      const meta = parsePositionCategoryMeta(category.name);
      if (meta && pick.value_text) {
        const pickedDriver = String(pick.value_text).trim().toLowerCase();
        const actualPosition = actualPositionByScopeAndDriver.get(`${meta.scope}:${pickedDriver}`);

        if (Number.isInteger(actualPosition)) {
          const step = Math.max(1, Number(category.partial_points) || 1);
          const distance = Math.abs(actualPosition - meta.position);
          earned = Math.max(0, Number(category.exact_points) - distance * step);
        }
      }
    }

    const key = `${pick.league_id}:${pick.user_id}`;
    leagueUserScoreMap.set(key, (leagueUserScoreMap.get(key) || 0) + earned);
  }

  if (targetLeagueId) {
    await query("DELETE FROM scores WHERE race_id = $1 AND league_id = $2", [raceId, targetLeagueId]);
  } else {
    await query("DELETE FROM scores WHERE race_id = $1", [raceId]);
  }

  for (const [key, points] of leagueUserScoreMap.entries()) {
    const [leagueId, userId] = key.split(":");
    await query(
      `INSERT INTO scores (league_id, user_id, race_id, points)
       VALUES ($1, $2, $3, $4)`,
      [leagueId, userId, raceId, points]
    );
  }

  return Array.from(leagueUserScoreMap.entries()).map(([key, points]) => {
    const [leagueId, userId] = key.split(":");
    return { leagueId, userId, points };
  });
}
