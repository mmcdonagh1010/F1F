import PickCategory from "../models/PickCategory.js";
import Result from "../models/Result.js";
import Pick from "../models/Pick.js";
import Score from "../models/Score.js";

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

function getDriverOfWeekendScope(category) {
  return String(category?.metadata?.driverOfWeekendScope || "").trim();
}

function isDriverOfWeekendCategory(category) {
  return String(category?.name || "").toLowerCase().includes("driver of the weekend");
}

export async function calculateRaceScores(raceId, targetLeagueId = null) {
  const categories = await PickCategory.find({ race: raceId }).sort({ display_order: 1 }).lean().exec();
  const results = await Result.find({ race: raceId }).lean().exec();
  const picksQuery = { race: raceId, status: "submitted" };
  if (targetLeagueId) picksQuery.league = targetLeagueId;
  const picks = await Pick.find(picksQuery).lean().exec();

  const resultsByCategory = new Map(results.map((r) => [String(r.category), r]));
  const categoriesById = new Map(categories.map((c) => [String(c._id), c]));
  const actualPositionByScopeAndDriver = new Map();

  for (const category of categories) {
    const meta = parsePositionCategoryMeta(category.name);
    if (!meta) continue;

    const official = resultsByCategory.get(String(category._id));
    const driverName = String(official?.value_text || "").trim().toLowerCase();
    if (!driverName) continue;

    actualPositionByScopeAndDriver.set(`${meta.scope}:${driverName}`, meta.position);
  }

  const leagueUserScoreMap = new Map();

  for (const pick of picks) {
    const category = categoriesById.get(String(pick.category));
    const official = resultsByCategory.get(String(pick.category));
    if (!category || !official) continue;

    const exactText = pick.value_text && official.value_text && pick.value_text === official.value_text;
    const exactNumber = pick.value_number !== null && official.value_number !== null && pick.value_number === official.value_number;

    let earned = 0;

    if (exactText || exactNumber) {
      earned = Number(category.exact_points || 0);
    } else {
      const meta = parsePositionCategoryMeta(category.name);
      if (meta && pick.value_text) {
        const pickedDriver = String(pick.value_text).trim().toLowerCase();
        const actualPosition = actualPositionByScopeAndDriver.get(`${meta.scope}:${pickedDriver}`);

        if (Number.isInteger(actualPosition)) {
          const step = Math.max(1, Number(category.partial_points) || 1);
          const distance = Math.abs(actualPosition - meta.position);
          earned = Math.max(0, Number(category.exact_points || 0) - distance * step);
        }
      } else if (isDriverOfWeekendCategory(category) && pick.value_number !== null && official.value_number !== null) {
        const step = Math.max(1, Number(category.partial_points) || 1);
        const distance = Math.abs(Number(official.value_number) - Number(pick.value_number));
        earned = Math.max(0, Number(category.exact_points || 0) - distance * step);
      }
    }

    const leagueId = String(pick.league || '');
    const userId = String(pick.user);
    const key = `${leagueId}:${userId}`;
    leagueUserScoreMap.set(key, (leagueUserScoreMap.get(key) || 0) + earned);
  }

  // remove old scores
  if (targetLeagueId) {
    await Score.deleteMany({ race: raceId, league: targetLeagueId }).exec();
  } else {
    await Score.deleteMany({ race: raceId }).exec();
  }

  // insert new scores
  for (const [key, points] of leagueUserScoreMap.entries()) {
    const [leagueId, userId] = key.split(":");
    await Score.create({ league: leagueId || null, user: userId, race: raceId, points });
  }

  return Array.from(leagueUserScoreMap.entries()).map(([key, points]) => {
    const [leagueId, userId] = key.split(":");
    return { leagueId, userId, points };
  });
}
