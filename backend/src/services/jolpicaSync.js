import Race from "../models/Race.js";
import RaceDriver from "../models/RaceDriver.js";
import PickCategory from "../models/PickCategory.js";
import Result from "../models/Result.js";
import League from "../models/League.js";
import Pick from "../models/Pick.js";
import Score from "../models/Score.js";
import { calculateRaceScores } from "./scoring.js";

const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Jolpica request failed (${res.status}) for ${url}`);
  }
  return res.json();
}

function parseRaceDateTime(race) {
  const date = race?.date;
  const time = race?.time || "00:00:00Z";
  if (!date) return null;
  return new Date(`${date}T${time}`).toISOString();
}

function parseDeadlineAt(raceDateIso, race) {
  const qualifyingDate = race?.Qualifying?.date;
  const qualifyingTime = race?.Qualifying?.time || "00:00:00Z";

  if (qualifyingDate) {
    return new Date(`${qualifyingDate}T${qualifyingTime}`).toISOString();
  }

  return raceDateIso;
}

function extractRaces(payload) {
  return payload?.MRData?.RaceTable?.Races || [];
}

function extractDrivers(payload) {
  const drivers = payload?.MRData?.DriverTable?.Drivers || [];
  return drivers
    .map((driver) => `${driver.givenName || ""} ${driver.familyName || ""}`.trim())
    .filter(Boolean);
}

function extractDriverTeams(payload) {
  const standings = payload?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
  const teams = new Map();

  standings.forEach((entry) => {
    const name = `${entry?.Driver?.givenName || ""} ${entry?.Driver?.familyName || ""}`.trim();
    const teamName = entry?.Constructors?.[0]?.name || null;
    if (!name) return;
    teams.set(name, teamName);
  });

  return teams;
}

function buildDriverLookupKey(name) {
  return String(name || "").trim().toLowerCase();
}

function getFullDriverName(driver) {
  return `${driver?.givenName || ""} ${driver?.familyName || ""}`.trim();
}

function normalizeDriversFromRaceResults(results) {
  const seen = new Set();
  return (results || [])
    .map((row) => ({
      name: getFullDriverName(row?.Driver),
      teamName: row?.Constructor?.name || null
    }))
    .filter((row) => row.name)
    .filter((row) => {
      const key = row.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildPositionMap(items, accessor) {
  const map = new Map();
  (items || []).forEach((item) => {
    const position = Number(item?.position);
    const value = accessor(item);
    if (!Number.isInteger(position) || !value) return;
    map.set(position, value);
  });
  return map;
}

function findFastestLapDriver(results) {
  const ranked = (results || [])
    .filter((row) => Number(row?.FastestLap?.rank) > 0)
    .sort((a, b) => Number(a.FastestLap.rank) - Number(b.FastestLap.rank));
  return ranked[0] ? getFullDriverName(ranked[0].Driver) : null;
}

function findTopTeamByPoints(results) {
  const teamPoints = new Map();
  (results || []).forEach((row) => {
    const teamName = row?.Constructor?.name || null;
    const points = Number(row?.points || 0);
    if (!teamName) return;
    teamPoints.set(teamName, (teamPoints.get(teamName) || 0) + points);
  });

  return Array.from(teamPoints.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
}

function buildOfficialResultsByCategory({ categories, qualifyingResults, sprintResults, raceResults }) {
  const qualifyingMap = buildPositionMap(qualifyingResults, (row) => getFullDriverName(row?.Driver));
  const sprintMap = buildPositionMap(sprintResults, (row) => getFullDriverName(row?.Driver));
  const raceMap = buildPositionMap(raceResults, (row) => getFullDriverName(row?.Driver));
  const raceWinner = raceMap.get(1) || null;
  const fastestLapDriver = findFastestLapDriver(raceResults);
  const teamOfWeekend = findTopTeamByPoints(raceResults);

  return categories
    .map((category) => {
      let valueText = null;

      if (/^race qualification p\d+$/i.test(category.name)) {
        const position = Number(category.name.match(/p(\d+)/i)?.[1] || 0);
        valueText = qualifyingMap.get(position) || null;
      } else if (/^sprint result p\d+$/i.test(category.name)) {
        const position = Number(category.name.match(/p(\d+)/i)?.[1] || 0);
        valueText = sprintMap.get(position) || null;
      } else if (/^race result p\d+$/i.test(category.name)) {
        const position = Number(category.name.match(/p(\d+)/i)?.[1] || 0);
        valueText = raceMap.get(position) || null;
      } else if (category.name === "Driver of the Weekend") {
        valueText = raceWinner;
      } else if (category.name === "Fastest Lap Driver") {
        valueText = fastestLapDriver;
      } else if (category.name === "Team of the Weekend") {
        valueText = teamOfWeekend;
      }

      return {
        categoryId: String(category._id),
        categoryName: category.name,
        value_text: valueText,
        value_number: null
      };
    })
    .filter((row) => row.value_text);
}

function extractLatestRaceResults(payload) {
  const race = payload?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;

  const results = race.Results || [];
  const winner = results.find((result) => String(result.position) === "1") || results[0] || null;
  const fastestLap = results
    .filter((result) => Number(result?.FastestLap?.rank) > 0)
    .sort((a, b) => Number(a.FastestLap.rank) - Number(b.FastestLap.rank))[0] || null;

  return {
    raceName: race.raceName,
    season: Number(race.season),
    round: Number(race.round),
    raceDateIso: parseRaceDateTime(race),
    winnerName: winner ? getFullDriverName(winner.Driver) : null,
    fastestLapName: fastestLap ? getFullDriverName(fastestLap.Driver) : null
  };
}

function categoryMatches(name, candidates) {
  const normalized = String(name || "").toLowerCase();
  return candidates.some((token) => normalized.includes(token));
}

function pickAutoResultForCategory(categoryName, latestRace) {
  if (!latestRace) return null;

  if (categoryMatches(categoryName, ["race result winner", "race winner", "race result p1"])) {
    return latestRace.winnerName;
  }

  if (categoryMatches(categoryName, ["fastest lap"])) {
    return latestRace.fastestLapName;
  }

  return null;
}

async function fetchSeasonDriverTeams(season) {
  const preferredSeason = Number(season) || new Date().getUTCFullYear();
  const candidateSeasons = [...new Set([preferredSeason, preferredSeason - 1, preferredSeason - 2].filter((value) => value >= 1950))];

  for (const candidateSeason of candidateSeasons) {
    const payload = await fetchJson(`${JOLPICA_BASE}/${candidateSeason}/driverStandings.json`).catch(() => null);
    const teams = extractDriverTeams(payload);
    if (teams.size > 0) {
      return { teams, sourceSeason: candidateSeason };
    }
  }

  return { teams: new Map(), sourceSeason: null };
}

async function fetchKnownLocalDriverTeams() {
  const rows = await RaceDriver.find({ team_name: { $nin: [null, ""] } })
    .select("driver_name team_name")
    .lean()
    .exec();

  const teams = new Map();
  rows.forEach((row) => {
    const key = buildDriverLookupKey(row.driver_name);
    const teamName = String(row.team_name || "").trim();
    if (!key || !teamName || teams.has(key)) return;
    teams.set(key, teamName);
  });

  return teams;
}

async function canRefreshRaceDrivers(raceId) {
  const hasPicks = await Pick.exists({ race: raceId });
  const hasResults = await Result.exists({ race: raceId });
  const hasScores = await Score.exists({ race: raceId });
  return !(hasPicks || hasResults || hasScores);
}

async function ensureRaceLeagueMappings(raceId, leagueIds) {
  if (!leagueIds || leagueIds.length === 0) return;
  await Race.updateOne({ _id: raceId }, { $addToSet: { leagues: { $each: leagueIds } } }).exec();
}

async function replaceRaceDrivers(raceId, drivers) {
  await RaceDriver.deleteMany({ race: raceId }).exec();
  if (!drivers || drivers.length === 0) return;
  const docs = drivers.map((driver, index) => ({
    race: raceId,
    driver_name: driver.name,
    team_name: driver.teamName || null,
    display_order: index + 1
  }));
  await RaceDriver.insertMany(docs);
}

async function upsertRace({ primaryLeagueId, race, assignedLeagueIds }) {
  const raceDateIso = parseRaceDateTime(race);
  if (!raceDateIso) return { action: "skipped", raceId: null };

  const deadlineAt = parseDeadlineAt(raceDateIso, race);
  const raceName = race.raceName;
  const circuitName = race?.Circuit?.circuitName || "Unknown Circuit";
  const externalRound = Number(race?.round || 0) || null;
  const start = new Date(new Date(raceDateIso).setUTCHours(0, 0, 0, 0));
  const end = new Date(new Date(raceDateIso).setUTCHours(23, 59, 59, 999));

  const existing = await Race.findOne({ name: raceName, race_date: { $gte: start, $lte: end } }).exec();

  if (existing) {
    await Race.updateOne(
      { _id: existing._id },
      {
        $set: {
          circuit_name: circuitName,
          external_round: externalRound || existing.external_round,
          race_date: new Date(raceDateIso),
          deadline_at: existing.status === "scheduled" ? new Date(deadlineAt) : existing.deadline_at
        }
      }
    ).exec();

    await ensureRaceLeagueMappings(existing._id, assignedLeagueIds);
    return { action: "updated", raceId: existing._id };
  }

  const created = await Race.create({
    league: primaryLeagueId,
    leagues: assignedLeagueIds,
    name: raceName,
    circuit_name: circuitName,
    external_round: externalRound,
    race_date: new Date(raceDateIso),
    deadline_at: new Date(deadlineAt)
  });

  await ensureRaceLeagueMappings(created._id, assignedLeagueIds);
  return { action: "created", raceId: created._id };
}

async function getRoundWeekendData(season, round, includeSprint) {
  const [qualifyingPayload, raceResultsPayload, sprintPayload] = await Promise.all([
    fetchJson(`${JOLPICA_BASE}/${season}/${round}/qualifying.json`).catch(() => null),
    fetchJson(`${JOLPICA_BASE}/${season}/${round}/results.json`).catch(() => null),
    includeSprint ? fetchJson(`${JOLPICA_BASE}/${season}/${round}/sprint.json`).catch(() => null) : Promise.resolve(null)
  ]);

  return {
    qualifyingResults: qualifyingPayload?.MRData?.RaceTable?.Races?.[0]?.QualifyingResults || [],
    raceResults: raceResultsPayload?.MRData?.RaceTable?.Races?.[0]?.Results || [],
    sprintResults: sprintPayload?.MRData?.RaceTable?.Races?.[0]?.SprintResults || []
  };
}

async function syncLocalRaceResultsFromWeekendData(raceDoc, weekendData) {
  const categories = await PickCategory.find({ race: raceDoc._id }).lean().exec();
  if (categories.length === 0) {
    return { updated: false, reason: "No pick categories found for local race", raceId: String(raceDoc._id) };
  }

  const officialResults = buildOfficialResultsByCategory({
    categories,
    qualifyingResults: weekendData.qualifyingResults,
    sprintResults: weekendData.sprintResults,
    raceResults: weekendData.raceResults
  });

  if (officialResults.length === 0) {
    return { updated: false, reason: "No official result values matched local categories", raceId: String(raceDoc._id) };
  }

  for (const result of officialResults) {
    await Result.updateOne(
      { race: raceDoc._id, category: result.categoryId },
      {
        $set: {
          value_text: result.value_text,
          value_number: result.value_number,
          created_at: new Date()
        }
      },
      { upsert: true }
    ).exec();
  }

  await Race.updateOne({ _id: raceDoc._id }, { $set: { status: "completed" } }).exec();
  await calculateRaceScores(raceDoc._id);

  return {
    updated: true,
    raceId: String(raceDoc._id),
    raceName: raceDoc.name,
    mappedCount: officialResults.length
  };
}

export async function syncLatestRaceResultsFromJolpica({ leagueId, season }) {
  const chosenSeason = Number(season || new Date().getUTCFullYear());
  const payload = await fetchJson(`${JOLPICA_BASE}/${chosenSeason}/last/results.json`);
  const latestRace = extractLatestRaceResults(payload);

  if (!latestRace) {
    return { updated: false, reason: "No latest race results returned from Jolpica" };
  }

  const date = new Date(latestRace.raceDateIso);
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);

  const query = {
    external_round: latestRace.round,
    race_date: { $gte: start, $lte: end }
  };
  if (leagueId) {
    query.leagues = leagueId;
  }

  const targetRace = await Race.findOne(query).lean().exec();
  if (!targetRace) {
    return {
      updated: false,
      reason: "No matching local race found for latest Jolpica race",
      latestRace
    };
  }

  const categories = await PickCategory.find({ race: targetRace._id }).lean().exec();
  const mappedResults = categories
    .map((category) => ({
      categoryId: String(category._id),
      valueText: pickAutoResultForCategory(category.name, latestRace)
    }))
    .filter((item) => item.valueText);

  if (mappedResults.length === 0) {
    return {
      updated: false,
      reason: "No categories matched auto-result mapping for latest race",
      latestRace,
      raceId: String(targetRace._id)
    };
  }

  for (const result of mappedResults) {
    await Result.updateOne(
      { race: targetRace._id, category: result.categoryId },
      { $set: { value_text: result.valueText, value_number: null, created_at: new Date() } },
      { upsert: true }
    ).exec();
  }

  await Race.updateOne({ _id: targetRace._id }, { $set: { status: "completed" } }).exec();
  await calculateRaceScores(targetRace._id);

  return {
    updated: true,
    raceId: String(targetRace._id),
    raceName: targetRace.name,
    mappedCount: mappedResults.length,
    latestRace
  };
}

export async function syncSeasonFromJolpica({ leagueId, season }) {
  const allLeagues = await League.find().sort({ created_at: 1 }).select("_id").lean().exec();
  const allLeagueIds = allLeagues.map((league) => String(league._id));
  const assignedLeagueIds = leagueId ? [leagueId] : allLeagueIds;
  const primaryLeagueId = assignedLeagueIds[0] || null;
  if (!primaryLeagueId) {
    throw new Error("No leagues found for race sync");
  }

  const racesPayload = await fetchJson(`${JOLPICA_BASE}/${season}/races.json`);
  const driversPayload = await fetchJson(`${JOLPICA_BASE}/${season}/drivers.json`);
  const { teams: teamsByDriver, sourceSeason: driverTeamSeason } = await fetchSeasonDriverTeams(season).catch(() => ({ teams: new Map(), sourceSeason: null }));
  const localTeamsByDriver = await fetchKnownLocalDriverTeams().catch(() => new Map());

  const races = extractRaces(racesPayload);
  const driverNames = extractDrivers(driversPayload);
  const drivers = driverNames.map((name) => ({
    name,
    teamName: teamsByDriver.get(name) || localTeamsByDriver.get(buildDriverLookupKey(name)) || null
  }));

  let created = 0;
  let updated = 0;
  let skippedDriverRefresh = 0;

  for (const race of races) {
    const result = await upsertRace({
      primaryLeagueId,
      race,
      assignedLeagueIds
    });
    if (!result.raceId) continue;

    if (result.action === "created") created += 1;
    if (result.action === "updated") updated += 1;

    const allowDriverRefresh = await canRefreshRaceDrivers(result.raceId);
    if (allowDriverRefresh) {
      await replaceRaceDrivers(result.raceId, drivers);
    } else {
      skippedDriverRefresh += 1;
    }
  }

  return {
    season,
    totalExternalRaces: races.length,
    created,
    updated,
    driversPerRace: drivers.length,
    skippedDriverRefresh,
    driverTeamSeason
  };
}

export async function syncCompletedRaceResultsFromJolpica({ season }) {
  const chosenSeason = Number(season || new Date().getUTCFullYear());
  const localRaces = await Race.find({
    external_round: { $ne: null },
    race_date: {
      $gte: new Date(`${chosenSeason}-01-01T00:00:00.000Z`),
      $lte: new Date(`${chosenSeason}-12-31T23:59:59.999Z`)
    },
    status: { $ne: "cancelled" }
  })
    .sort({ external_round: 1 })
    .lean()
    .exec();

  const now = Date.now();
  const cache = new Map();
  let checkedRaces = 0;
  let updatedRaces = 0;
  let updatedResults = 0;
  const skipped = [];

  for (const raceDoc of localRaces) {
    if (!raceDoc.race_date || new Date(raceDoc.race_date).getTime() > now) {
      skipped.push({ raceId: String(raceDoc._id), raceName: raceDoc.name, reason: "Race weekend is not complete yet" });
      continue;
    }

    const round = Number(raceDoc.external_round);
    if (!Number.isInteger(round) || round < 1) {
      skipped.push({ raceId: String(raceDoc._id), raceName: raceDoc.name, reason: "Race has no valid external round" });
      continue;
    }

    checkedRaces += 1;
    const cacheKey = `${chosenSeason}:${round}`;
    if (!cache.has(cacheKey)) {
      const categories = await PickCategory.find({ race: raceDoc._id }).select("name").lean().exec();
      const includeSprint = categories.some((category) => String(category.name || "").toLowerCase().includes("sprint"));
      cache.set(cacheKey, await getRoundWeekendData(chosenSeason, round, includeSprint));
    }

    const weekendData = cache.get(cacheKey);
    if (!weekendData?.raceResults?.length) {
      skipped.push({ raceId: String(raceDoc._id), raceName: raceDoc.name, reason: "No completed Jolpica race results found" });
      continue;
    }

    const summary = await syncLocalRaceResultsFromWeekendData(raceDoc, weekendData);
    if (!summary.updated) {
      skipped.push({ raceId: String(raceDoc._id), raceName: raceDoc.name, reason: summary.reason });
      continue;
    }

    updatedRaces += 1;
    updatedResults += summary.mappedCount;
  }

  return {
    season: chosenSeason,
    checkedRaces,
    updatedRaces,
    updatedResults,
    skipped
  };
}