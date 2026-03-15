import PickCategory from "../models/PickCategory.js";
import Race from "../models/Race.js";
import RaceDriver from "../models/RaceDriver.js";
import Result from "../models/Result.js";
import Pick from "../models/Pick.js";
import Score from "../models/Score.js";

const TEAM_MARGIN_BANDS = ["1-2", "3-4", "5+"];

export function parsePositionCategoryMeta(categoryName) {
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

export function isDriverOfWeekendCategory(category) {
  return String(category?.name || "").toLowerCase().includes("driver of the weekend");
}

export function isTeamBattleMarginCategory(category) {
  const normalized = String(category?.name || category || "").toLowerCase();
  return normalized.includes("team battle") && normalized.includes("margin");
}

export function formatEntryValue(entry) {
  if (!entry) return null;
  if (entry.value_text !== null && entry.value_text !== undefined && entry.value_text !== "") return entry.value_text;
  if (entry.value_number !== null && entry.value_number !== undefined) return String(entry.value_number);
  return null;
}

function getTeamMarginBandIndex(value) {
  return TEAM_MARGIN_BANDS.indexOf(String(value || "").trim());
}

function calculateTeamMarginPoints(category, pick, result) {
  const pickedBandIndex = getTeamMarginBandIndex(pick?.value_text);
  const officialBandIndex = getTeamMarginBandIndex(result?.value_text);
  if (pickedBandIndex < 0 || officialBandIndex < 0) return 0;

  const bandDistance = Math.abs(pickedBandIndex - officialBandIndex);
  const step = Math.max(1, Number(category.partial_points) || 1);
  return Math.max(0, Number(category.exact_points || 0) - bandDistance * step);
}

export function buildActualPositionByScopeAndDriver(categories, resultsByCategory) {
  const actualPositionByScopeAndDriver = new Map();

  for (const category of categories || []) {
    const meta = parsePositionCategoryMeta(category.name);
    if (!meta) continue;

    const official = resultsByCategory.get(String(category._id || category.id));
    const driverName = String(official?.value_text || "").trim().toLowerCase();
    if (!driverName) continue;

    actualPositionByScopeAndDriver.set(`${meta.scope}:${driverName}`, meta.position);
  }

  return actualPositionByScopeAndDriver;
}

export async function resolveActualPositionByScopeAndDriver({
  race,
  raceId,
  categories,
  resultsByCategory,
  yearOverride = null
}) {
  let actualPositionByScopeAndDriver = buildActualPositionByScopeAndDriver(categories, resultsByCategory);

  const resolvedRace = race || (raceId ? await Race.findById(raceId).select("_id external_round race_date").lean().exec() : null);
  const round = Number(resolvedRace?.external_round || 0);
  const season = Number(new Date(resolvedRace?.race_date).getUTCFullYear()) || Number(yearOverride) || 0;

  if (!resolvedRace?._id || !Number.isInteger(round) || round < 1 || !season) {
    return actualPositionByScopeAndDriver;
  }

  const includeSprint = (categories || []).some((category) => String(category?.name || "").toLowerCase().includes("sprint"));
  const raceDrivers = await RaceDriver.find({ race: resolvedRace._id }).select("driver_name").lean().exec();

  try {
    const { buildRaceActualPositionMap } = await import("./jolpicaSync.js");
    const syncedActualPositions = await buildRaceActualPositionMap({
      season,
      round,
      raceDrivers: raceDrivers.map((row) => row.driver_name),
      includeSprint
    });

    if (syncedActualPositions.size > 0) {
      actualPositionByScopeAndDriver = syncedActualPositions;
    }
  } catch {
    // Fall back to the local result map if external weekend data is unavailable.
  }

  return actualPositionByScopeAndDriver;
}

export function buildPickScoreDetail(category, pick, result, actualPositionByScopeAndDriver) {
  const points = calculatePickPoints(category, pick, result, actualPositionByScopeAndDriver);
  const detail = {
    points,
    pickValue: formatEntryValue(pick),
    officialValue: formatEntryValue(result),
    isPositionPrediction: false,
    positionsAway: null,
    targetPosition: null,
    actualPickedPosition: null
  };

  const meta = parsePositionCategoryMeta(category?.name);
  if (!meta || pick?.value_text === null || pick?.value_text === undefined) {
    return detail;
  }

  const pickedDriver = String(pick.value_text || "").trim().toLowerCase();
  const actualPosition = actualPositionByScopeAndDriver.get(`${meta.scope}:${pickedDriver}`);
  detail.isPositionPrediction = true;
  detail.targetPosition = meta.position;

  if (Number.isInteger(actualPosition)) {
    detail.actualPickedPosition = actualPosition;
    detail.positionsAway = Math.abs(actualPosition - meta.position);
  }

  return detail;
}

export function calculatePickPoints(category, pick, result, actualPositionByScopeAndDriver = new Map()) {
  if (!pick || !result || !category) return 0;

  const exactText =
    pick.value_text !== null &&
    result.value_text !== null &&
    pick.value_text === result.value_text;

  const exactNumber =
    pick.value_number !== null &&
    result.value_number !== null &&
    Number(pick.value_number) === Number(result.value_number);

  if (exactText || exactNumber) {
    return Number(category.exact_points || 0);
  }

  if (isTeamBattleMarginCategory(category)) {
    return calculateTeamMarginPoints(category, pick, result);
  }

  const meta = parsePositionCategoryMeta(category.name);
  if (meta && pick.value_text !== null) {
    const pickedDriver = String(pick.value_text || "").trim().toLowerCase();
    const actualPosition = actualPositionByScopeAndDriver.get(`${meta.scope}:${pickedDriver}`);

    if (Number.isInteger(actualPosition)) {
      const step = Math.max(1, Number(category.partial_points) || 1);
      const distance = Math.abs(actualPosition - meta.position);
      return Math.max(0, Number(category.exact_points || 0) - distance * step);
    }
  }

  if (isDriverOfWeekendCategory(category) && pick.value_number !== null && result.value_number !== null) {
    const step = Math.max(1, Number(category.partial_points) || 1);
    const distance = Math.abs(Number(result.value_number) - Number(pick.value_number));
    return Math.max(0, Number(category.exact_points || 0) - distance * step);
  }

  return 0;
}

export async function calculateRaceScores(raceId, targetLeagueId = null) {
  const categories = await PickCategory.find({ race: raceId }).sort({ display_order: 1 }).lean().exec();
  const results = await Result.find({ race: raceId }).lean().exec();
  const picksQuery = { race: raceId, status: "submitted" };
  if (targetLeagueId) picksQuery.league = targetLeagueId;
  const picks = await Pick.find(picksQuery).lean().exec();

  const raceDoc = await Race.findById(raceId).select("_id external_round race_date").lean().exec();
  const resultsByCategory = new Map(results.map((row) => [String(row.category), row]));
  const categoriesById = new Map(categories.map((row) => [String(row._id), row]));
  const actualPositionByScopeAndDriver = await resolveActualPositionByScopeAndDriver({
    race: raceDoc,
    categories,
    resultsByCategory
  });

  const leagueUserScoreMap = new Map();

  for (const pick of picks) {
    const category = categoriesById.get(String(pick.category));
    const official = resultsByCategory.get(String(pick.category));
    if (!category || !official) continue;

    const earned = calculatePickPoints(category, pick, official, actualPositionByScopeAndDriver);

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
