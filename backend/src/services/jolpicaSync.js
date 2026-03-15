import Race from "../models/Race.js";
import RaceDriver from "../models/RaceDriver.js";
import PickCategory from "../models/PickCategory.js";
import Result from "../models/Result.js";
import League from "../models/League.js";
import Pick from "../models/Pick.js";
import Score from "../models/Score.js";
import { calculateRaceScores } from "./scoring.js";
import { fetchRaceSchedule, getLockDeadlineAt } from "./raceDeadline.js";
import { getPickLockMinutesBeforeDeadline } from "./settings.js";

const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";
const OPENF1_BASE = "https://api.openf1.org/v1";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Jolpica request failed (${res.status}) for ${url}`);
  }
  return res.json();
}

async function fetchOpenF1Json(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`OpenF1 request failed (${res.status}) for ${url}`);
  }

  const payload = await res.json();
  return Array.isArray(payload) ? payload : [];
}

function parseRaceDateTime(race) {
  const date = race?.date;
  const time = race?.time || "00:00:00Z";
  if (!date) return null;
  return new Date(`${date}T${time}`).toISOString();
}

async function parseDeadlineAt(raceDateIso, race) {
  const round = Number(race?.round || 0);
  const raceDate = new Date(raceDateIso);
  const season = Number.isNaN(raceDate.getTime()) ? null : raceDate.getUTCFullYear();
  const lockMinutes = await getPickLockMinutesBeforeDeadline();

  if (season && Number.isInteger(round) && round > 0) {
    try {
      const schedule = await fetchRaceSchedule({ season, round });
      if (schedule?.sprintQualifyingDateIso) return getLockDeadlineAt(schedule.sprintQualifyingDateIso, lockMinutes);
      if (schedule?.qualifyingDateIso) return getLockDeadlineAt(schedule.qualifyingDateIso, lockMinutes);
    } catch {
      // Fall back to the schedule embedded in the sync payload.
    }
  }

  const sprintQualifyingDate = race?.SprintQualifying?.date;
  const sprintQualifyingTime = race?.SprintQualifying?.time || "00:00:00Z";
  if (sprintQualifyingDate) return getLockDeadlineAt(new Date(`${sprintQualifyingDate}T${sprintQualifyingTime}`).toISOString(), lockMinutes);

  const qualifyingDate = race?.Qualifying?.date;
  const qualifyingTime = race?.Qualifying?.time || "00:00:00Z";
  if (qualifyingDate) return getLockDeadlineAt(new Date(`${qualifyingDate}T${qualifyingTime}`).toISOString(), lockMinutes);

  return getLockDeadlineAt(raceDateIso, lockMinutes) || raceDateIso;
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

function extractConstructors(payload) {
  return payload?.MRData?.ConstructorTable?.Constructors || [];
}

function extractConstructorDrivers(payload) {
  return payload?.MRData?.DriverTable?.Drivers || [];
}

function buildDriverLookupKey(name) {
  return String(name || "").trim().toLowerCase();
}

function buildComparableDriverKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function getFullDriverName(driver) {
  return `${driver?.givenName || ""} ${driver?.familyName || ""}`.trim();
}

function getDriverNameFromResultRow(row) {
  if (row?.driverName) return String(row.driverName).trim();
  return getFullDriverName(row?.Driver);
}

function buildLocalDriverAliasMap(driverNames) {
  const aliases = new Map();

  (driverNames || []).forEach((driverName) => {
    const rawName = String(driverName || "").trim();
    if (!rawName) return;

    const comparableKey = buildComparableDriverKey(rawName);
    if (comparableKey && !aliases.has(comparableKey)) aliases.set(comparableKey, rawName);

    const withoutSuffix = comparableKey.replace(/\b(jr|sr)\b$/g, "").trim();
    if (withoutSuffix && !aliases.has(withoutSuffix)) aliases.set(withoutSuffix, rawName);
  });

  return aliases;
}

function resolveLocalDriverName(driverName, localDriverAliases) {
  const rawName = String(driverName || "").trim();
  if (!rawName) return null;
  if (!localDriverAliases || localDriverAliases.size === 0) return rawName;

  const comparableKey = buildComparableDriverKey(rawName);
  if (localDriverAliases.has(comparableKey)) return localDriverAliases.get(comparableKey);

  const withoutSuffix = comparableKey.replace(/\b(jr|sr)\b$/g, "").trim();
  if (localDriverAliases.has(withoutSuffix)) return localDriverAliases.get(withoutSuffix);

  const comparableParts = comparableKey.split(" ").filter(Boolean);
  const lastName = comparableParts.at(-1) || "";
  const firstName = comparableParts[0] || "";

  if (lastName) {
    const matches = Array.from(localDriverAliases.entries()).filter(([key]) => {
      const localParts = key.split(" ").filter(Boolean);
      if (localParts.at(-1) !== lastName) return false;
      if (!firstName) return true;
      return localParts[0] === firstName || localParts.includes(firstName);
    });
    if (matches.length === 1) return matches[0][1];
  }

  return rawName;
}

function normalizeDriversFromRaceResults(results) {
  const seen = new Set();
  return (results || [])
    .map((row) => ({
      name: getDriverNameFromResultRow(row),
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

function buildDriverPositionMap(items) {
  const map = new Map();
  (items || []).forEach((item) => {
    const position = Number(item?.position);
    const driverName = getDriverNameFromResultRow(item);
    if (!Number.isInteger(position) || !driverName) return;
    map.set(driverName.toLowerCase(), position);
  });
  return map;
}

function findFastestLapDriver(results) {
  const ranked = (results || [])
    .filter((row) => Number(row?.FastestLap?.rank) > 0)
    .sort((a, b) => Number(a.FastestLap.rank) - Number(b.FastestLap.rank));
  return ranked[0] ? getDriverNameFromResultRow(ranked[0]) : null;
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

function findTeamBattleOutcome(results, teamName) {
  if (!teamName) return { winningDriver: null, marginBand: null };

  const teamResults = (results || [])
    .filter((row) => String(row?.Constructor?.name || "").trim().toLowerCase() === String(teamName).trim().toLowerCase())
    .map((row) => ({
      position: Number(row?.position),
      driverName: getDriverNameFromResultRow(row)
    }))
    .filter((row) => Number.isInteger(row.position) && row.position > 0 && row.driverName)
    .sort((a, b) => a.position - b.position || a.driverName.localeCompare(b.driverName));

  if (teamResults.length === 0) {
    return { winningDriver: null, marginBand: null };
  }

  const winningDriver = teamResults[0].driverName;
  if (teamResults.length < 2) {
    return { winningDriver, marginBand: null };
  }

  const gap = Math.abs(teamResults[1].position - teamResults[0].position);
  const marginBand = gap <= 2 ? "1-2" : gap <= 4 ? "3-4" : "5+";
  return { winningDriver, marginBand };
}

function findWeekendTeamBattleOutcome({ raceResults, sprintResults, teamName }) {
  if (!teamName) return { winningDriver: null, marginBand: null };

  const aggregate = new Map();

  function addSessionResults(sessionResults, sessionWeight) {
    (sessionResults || [])
      .filter((row) => String(row?.Constructor?.name || "").trim().toLowerCase() === String(teamName).trim().toLowerCase())
      .forEach((row) => {
        const position = Number(row?.position);
        const driverName = getDriverNameFromResultRow(row);
        if (!Number.isInteger(position) || position <= 0 || !driverName) return;

        const key = driverName.toLowerCase();
        const current = aggregate.get(key) || {
          driverName,
          totalPosition: 0,
          sessionsCount: 0,
          racePosition: Number.POSITIVE_INFINITY,
          sprintPosition: Number.POSITIVE_INFINITY,
          sessionWeight: 0
        };

        current.totalPosition += position;
        current.sessionsCount += 1;
        current.sessionWeight += sessionWeight;
        if (sessionWeight === 2) current.racePosition = position;
        if (sessionWeight === 1) current.sprintPosition = position;

        aggregate.set(key, current);
      });
  }

  addSessionResults(sprintResults, 1);
  addSessionResults(raceResults, 2);

  const ranked = Array.from(aggregate.values()).sort((left, right) => {
    if (left.totalPosition !== right.totalPosition) return left.totalPosition - right.totalPosition;
    if (left.racePosition !== right.racePosition) return left.racePosition - right.racePosition;
    if (left.sprintPosition !== right.sprintPosition) return left.sprintPosition - right.sprintPosition;
    return left.driverName.localeCompare(right.driverName);
  });

  if (ranked.length === 0) {
    return { winningDriver: null, marginBand: null };
  }

  const winningDriver = ranked[0].driverName;
  if (ranked.length < 2) {
    return { winningDriver, marginBand: null };
  }

  const gap = Math.abs(ranked[1].totalPosition - ranked[0].totalPosition);
  const marginBand = gap <= 2 ? "1-2" : gap <= 4 ? "3-4" : "5+";
  return { winningDriver, marginBand };
}

function buildOfficialResultsByCategory({ categories, qualifyingResults, sprintQualifyingResults, sprintResults, raceResults }) {
  const qualifyingMap = buildPositionMap(qualifyingResults, (row) => getFullDriverName(row?.Driver));
  const sprintQualifyingMap = buildPositionMap(sprintQualifyingResults, (row) => getDriverNameFromResultRow(row));
  const sprintMap = buildPositionMap(sprintResults, (row) => getFullDriverName(row?.Driver));
  const raceMap = buildPositionMap(raceResults, (row) => getFullDriverName(row?.Driver));
  const qualifyingDriverPositions = buildDriverPositionMap(qualifyingResults);
  const sprintQualifyingDriverPositions = buildDriverPositionMap(sprintQualifyingResults);
  const sprintDriverPositions = buildDriverPositionMap(sprintResults);
  const raceDriverPositions = buildDriverPositionMap(raceResults);
  const raceWinner = raceMap.get(1) || null;
  const fastestLapDriver = findFastestLapDriver(raceResults);
  const weekendResults = [...(raceResults || []), ...(sprintResults || [])];
  const teamOfWeekend = findTopTeamByPoints(weekendResults);

  return categories
    .map((category) => {
      let valueText = null;
      let valueNumber = null;
      const fixedTeam = String(category?.metadata?.fixedTeam || "").trim();
      const teamBattleOutcome = findWeekendTeamBattleOutcome({
        raceResults,
        sprintResults,
        teamName: fixedTeam || teamOfWeekend
      });
      const fixedDriver = String(category?.metadata?.fixedDriver || "").trim().toLowerCase();
      const driverOfWeekendScope = String(category?.metadata?.driverOfWeekendScope || "").trim();

      if (/^race qualification p\d+$/i.test(category.name)) {
        const position = Number(category.name.match(/p(\d+)/i)?.[1] || 0);
        valueText = qualifyingMap.get(position) || null;
      } else if (/^sprint qualification p\d+$/i.test(category.name)) {
        const position = Number(category.name.match(/p(\d+)/i)?.[1] || 0);
        valueText = sprintQualifyingMap.get(position) || null;
      } else if (/^sprint result p\d+$/i.test(category.name)) {
        const position = Number(category.name.match(/p(\d+)/i)?.[1] || 0);
        valueText = sprintMap.get(position) || null;
      } else if (/^race result p\d+$/i.test(category.name)) {
        const position = Number(category.name.match(/p(\d+)/i)?.[1] || 0);
        valueText = raceMap.get(position) || null;
      } else if (String(category.name || "").toLowerCase().includes("driver of the weekend") && fixedDriver) {
        if (driverOfWeekendScope === "race-result") valueNumber = raceDriverPositions.get(fixedDriver) ?? null;
        else if (driverOfWeekendScope === "sprint-result") valueNumber = sprintDriverPositions.get(fixedDriver) ?? null;
        else if (driverOfWeekendScope === "race-qualification") valueNumber = qualifyingDriverPositions.get(fixedDriver) ?? null;
        else if (driverOfWeekendScope === "sprint-qualification") valueNumber = sprintQualifyingDriverPositions.get(fixedDriver) ?? null;
        else valueNumber = raceDriverPositions.get(fixedDriver) ?? null;
      } else if (category.name === "Fastest Lap Driver") {
        valueText = fastestLapDriver;
      } else if (/race team battle/i.test(category.name) && /driver/i.test(category.name)) {
        const raceTeamBattleOutcome = findTeamBattleOutcome(raceResults, fixedTeam || teamOfWeekend);
        valueText = raceTeamBattleOutcome.winningDriver;
      } else if (/race team battle/i.test(category.name) && /margin/i.test(category.name)) {
        const raceTeamBattleOutcome = findTeamBattleOutcome(raceResults, fixedTeam || teamOfWeekend);
        valueText = raceTeamBattleOutcome.marginBand;
      } else if (/sprint team battle/i.test(category.name) && /driver/i.test(category.name)) {
        const sprintTeamBattleOutcome = findTeamBattleOutcome(sprintResults, fixedTeam || teamOfWeekend);
        valueText = sprintTeamBattleOutcome.winningDriver;
      } else if (/sprint team battle/i.test(category.name) && /margin/i.test(category.name)) {
        const sprintTeamBattleOutcome = findTeamBattleOutcome(sprintResults, fixedTeam || teamOfWeekend);
        valueText = sprintTeamBattleOutcome.marginBand;
      } else if (/team battle/i.test(category.name) && /driver/i.test(category.name)) {
        valueText = teamBattleOutcome.winningDriver;
      } else if (/team battle/i.test(category.name) && /margin/i.test(category.name)) {
        valueText = teamBattleOutcome.marginBand;
      }

      return {
        categoryId: String(category._id),
        categoryName: category.name,
        value_text: valueText,
        value_number: valueNumber
      };
    })
    .filter((row) => row.value_text || Number.isInteger(row.value_number));
}

function shouldIncludeSprintWeekendData(categories) {
  return (categories || []).some((category) => {
    const normalized = String(category?.name || "").toLowerCase();
    return (
      normalized.includes("sprint") ||
      normalized.includes("team of the weekend") ||
      normalized.includes("team battle")
    );
  });
}

export async function buildRaceActualPositionMap({ season, round, raceDrivers = [], includeSprint = false }) {
  if (!Number.isInteger(Number(season)) || !Number.isInteger(Number(round)) || Number(round) < 1) {
    return new Map();
  }

  const weekendData = await getRoundWeekendData(Number(season), Number(round), includeSprint);
  if (!hasPublishedWeekendResults(weekendData)) {
    return new Map();
  }

  const localDriverAliases = buildLocalDriverAliasMap(raceDrivers);
  const normalizedWeekendData = {
    qualifyingResults: normalizeWeekendDriverNames(weekendData.qualifyingResults, localDriverAliases),
    sprintQualifyingResults: normalizeWeekendDriverNames(weekendData.sprintQualifyingResults, localDriverAliases),
    sprintResults: normalizeWeekendDriverNames(weekendData.sprintResults, localDriverAliases),
    raceResults: normalizeWeekendDriverNames(weekendData.raceResults, localDriverAliases)
  };

  const actualPositionByScopeAndDriver = new Map();

  buildDriverPositionMap(normalizedWeekendData.qualifyingResults).forEach((position, driverName) => {
    actualPositionByScopeAndDriver.set(`race-qualification:${driverName}`, position);
  });
  buildDriverPositionMap(normalizedWeekendData.sprintQualifyingResults).forEach((position, driverName) => {
    actualPositionByScopeAndDriver.set(`sprint-qualification:${driverName}`, position);
  });
  buildDriverPositionMap(normalizedWeekendData.sprintResults).forEach((position, driverName) => {
    actualPositionByScopeAndDriver.set(`sprint-result:${driverName}`, position);
  });
  buildDriverPositionMap(normalizedWeekendData.raceResults).forEach((position, driverName) => {
    actualPositionByScopeAndDriver.set(`race-result:${driverName}`, position);
  });

  return actualPositionByScopeAndDriver;
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
    const constructorPayload = await fetchJson(`${JOLPICA_BASE}/${candidateSeason}/constructors.json`).catch(() => null);
    const constructors = extractConstructors(constructorPayload);

    if (constructors.length > 0) {
      const constructorDriverPayloads = await Promise.all(
        constructors.map(async (constructor) => {
          const constructorId = constructor?.constructorId;
          const teamName = constructor?.name || null;
          if (!constructorId || !teamName) return null;

          const payload = await fetchJson(`${JOLPICA_BASE}/${candidateSeason}/constructors/${constructorId}/drivers.json`).catch(() => null);
          return { teamName, payload };
        })
      );

      const constructorTeams = new Map();
      constructorDriverPayloads.forEach((entry) => {
        if (!entry?.teamName || !entry.payload) return;

        const drivers = extractConstructorDrivers(entry.payload);
        drivers.forEach((driver) => {
          const driverName = getFullDriverName(driver);
          if (!driverName || constructorTeams.has(driverName)) return;
          constructorTeams.set(driverName, entry.teamName);
        });
      });

      if (constructorTeams.size > 0) {
        return { teams: constructorTeams, sourceSeason: candidateSeason, source: "constructor-drivers" };
      }
    }

    const payload = await fetchJson(`${JOLPICA_BASE}/${candidateSeason}/driverStandings.json`).catch(() => null);
    const teams = extractDriverTeams(payload);
    if (teams.size > 0) {
      return { teams, sourceSeason: candidateSeason, source: "driver-standings" };
    }
  }

  return { teams: new Map(), sourceSeason: null, source: null };
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

async function fetchSprintQualifyingResultsFromOpenF1({ season, round }) {
  const schedule = await fetchRaceSchedule({ season, round }).catch(() => null);
  const sprintQualifyingDateIso = schedule?.sprintQualifyingDateIso;
  if (!sprintQualifyingDateIso) {
    return { results: [], source: null, sessionKey: null };
  }

  const sprintQualifyingDate = new Date(sprintQualifyingDateIso);
  if (Number.isNaN(sprintQualifyingDate.getTime())) {
    return { results: [], source: null, sessionKey: null };
  }

  const dayStart = sprintQualifyingDate.toISOString().slice(0, 10);
  const nextDay = new Date(`${dayStart}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDayText = nextDay.toISOString().slice(0, 10);

  const sessions = await fetchOpenF1Json(
    `${OPENF1_BASE}/sessions?year=${season}&session_name=${encodeURIComponent("Sprint Qualifying")}&date_start>=${dayStart}&date_start<${nextDayText}`
  ).catch(() => []);

  if (sessions.length === 0) {
    return { results: [], source: null, sessionKey: null };
  }

  const targetSession = sessions
    .map((session) => ({
      ...session,
      delta: Math.abs(new Date(session.date_start).getTime() - sprintQualifyingDate.getTime())
    }))
    .sort((left, right) => left.delta - right.delta)[0];

  if (!targetSession?.session_key) {
    return { results: [], source: null, sessionKey: null };
  }

  const [sessionResults, drivers] = await Promise.all([
    fetchOpenF1Json(`${OPENF1_BASE}/session_result?session_key=${targetSession.session_key}`).catch(() => []),
    fetchOpenF1Json(`${OPENF1_BASE}/drivers?session_key=${targetSession.session_key}`).catch(() => [])
  ]);

  const driverNameByNumber = new Map(
    drivers.map((driver) => [
      Number(driver.driver_number),
      `${driver.first_name || ""} ${driver.last_name || ""}`.trim() || String(driver.full_name || "").trim()
    ])
  );

  return {
    results: sessionResults
      .map((row) => ({
        position: Number(row.position),
        driverName: driverNameByNumber.get(Number(row.driver_number)) || null
      }))
      .filter((row) => Number.isInteger(row.position) && row.position > 0 && row.driverName),
    source: "openf1",
    sessionKey: String(targetSession.session_key)
  };
}

function normalizeWeekendDriverNames(items, localDriverAliases) {
  return (items || []).map((item) => {
    const driverName = resolveLocalDriverName(getDriverNameFromResultRow(item), localDriverAliases);
    return driverName ? { ...item, driverName } : item;
  });
}

async function upsertRace({ primaryLeagueId, race, assignedLeagueIds }) {
  const raceDateIso = parseRaceDateTime(race);
  if (!raceDateIso) return { action: "skipped", raceId: null };

  const deadlineAt = await parseDeadlineAt(raceDateIso, race);
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
    manual_deadline_at: null,
    deadline_at: new Date(deadlineAt)
  });

  await ensureRaceLeagueMappings(created._id, assignedLeagueIds);
  return { action: "created", raceId: created._id };
}

async function getRoundWeekendData(season, round, includeSprint) {
  const [qualifyingPayload, raceResultsPayload, sprintPayload, sprintQualifyingFallback] = await Promise.all([
    fetchJson(`${JOLPICA_BASE}/${season}/${round}/qualifying.json`).catch(() => null),
    fetchJson(`${JOLPICA_BASE}/${season}/${round}/results.json`).catch(() => null),
    includeSprint ? fetchJson(`${JOLPICA_BASE}/${season}/${round}/sprint.json`).catch(() => null) : Promise.resolve(null),
    includeSprint ? fetchSprintQualifyingResultsFromOpenF1({ season, round }).catch(() => ({ results: [], source: null, sessionKey: null })) : Promise.resolve({ results: [], source: null, sessionKey: null })
  ]);

  return {
    qualifyingResults: qualifyingPayload?.MRData?.RaceTable?.Races?.[0]?.QualifyingResults || [],
    sprintQualifyingResults: sprintQualifyingFallback.results || [],
    raceResults: raceResultsPayload?.MRData?.RaceTable?.Races?.[0]?.Results || [],
    sprintResults: sprintPayload?.MRData?.RaceTable?.Races?.[0]?.SprintResults || [],
    sources: {
      sprintQualifying: sprintQualifyingFallback.source || null,
      sprintQualifyingSessionKey: sprintQualifyingFallback.sessionKey || null
    }
  };
}

function hasPublishedWeekendResults(weekendData) {
  return Boolean(
    weekendData?.qualifyingResults?.length ||
      weekendData?.sprintQualifyingResults?.length ||
      weekendData?.sprintResults?.length ||
      weekendData?.raceResults?.length
  );
}

async function syncLocalRaceResultsFromWeekendData(raceDoc, weekendData) {
  const categories = await PickCategory.find({ race: raceDoc._id }).lean().exec();
  const raceDrivers = await RaceDriver.find({ race: raceDoc._id }).select("driver_name").lean().exec();
  if (categories.length === 0) {
    return { updated: false, reason: "No pick categories found for local race", raceId: String(raceDoc._id) };
  }

  const localDriverAliases = buildLocalDriverAliasMap(raceDrivers.map((row) => row.driver_name));
  const normalizedWeekendData = {
    qualifyingResults: normalizeWeekendDriverNames(weekendData.qualifyingResults, localDriverAliases),
    sprintQualifyingResults: normalizeWeekendDriverNames(weekendData.sprintQualifyingResults, localDriverAliases),
    sprintResults: normalizeWeekendDriverNames(weekendData.sprintResults, localDriverAliases),
    raceResults: normalizeWeekendDriverNames(weekendData.raceResults, localDriverAliases)
  };

  const officialResults = buildOfficialResultsByCategory({
    categories,
    qualifyingResults: normalizedWeekendData.qualifyingResults,
    sprintQualifyingResults: normalizedWeekendData.sprintQualifyingResults,
    sprintResults: normalizedWeekendData.sprintResults,
    raceResults: normalizedWeekendData.raceResults
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

  if (weekendData?.raceResults?.length) {
    await Race.updateOne({ _id: raceDoc._id }, { $set: { status: "completed" } }).exec();
  }

  await calculateRaceScores(raceDoc._id);

  return {
    updated: true,
    raceId: String(raceDoc._id),
    raceName: raceDoc.name,
    mappedCount: officialResults.length,
    hasRaceResults: Boolean(weekendData?.raceResults?.length),
    sources: weekendData?.sources || null
  };
}

export async function syncSprintQualifyingResultsForRace({ raceId }) {
  const raceDoc = await Race.findById(raceId).lean().exec();
  if (!raceDoc) {
    return { updated: false, reason: "Race not found", raceId: String(raceId || "") };
  }

  const round = Number(raceDoc.external_round || 0);
  const raceDate = new Date(raceDoc.race_date);
  const season = Number.isNaN(raceDate.getTime()) ? null : raceDate.getUTCFullYear();
  if (!season || !Number.isInteger(round) || round < 1) {
    return { updated: false, reason: "Race has no valid season/round mapping", raceId: String(raceDoc._id) };
  }

  const weekendData = await getRoundWeekendData(season, round, true);
  if (!weekendData?.sprintQualifyingResults?.length) {
    return {
      updated: false,
      reason: "No sprint qualifying results available from configured data sources",
      raceId: String(raceDoc._id),
      sources: weekendData?.sources || null
    };
  }

  return syncLocalRaceResultsFromWeekendData(raceDoc, weekendData);
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

  const categories = await PickCategory.find({ race: targetRace._id }).select("name").lean().exec();
  const includeSprint = shouldIncludeSprintWeekendData(categories);
  const weekendData = await getRoundWeekendData(chosenSeason, latestRace.round, includeSprint);

  if (!hasPublishedWeekendResults(weekendData)) {
    return {
      updated: false,
      reason: "No published weekend results available for latest race",
      latestRace,
      raceId: String(targetRace._id)
    };
  }

  const summary = await syncLocalRaceResultsFromWeekendData(targetRace, weekendData);
  if (!summary.updated) {
    return {
      updated: false,
      reason: summary.reason,
      latestRace,
      raceId: String(targetRace._id)
    };
  }

  return {
    updated: true,
    raceId: String(targetRace._id),
    raceName: targetRace.name,
    mappedCount: summary.mappedCount,
    latestRace,
    hasRaceResults: summary.hasRaceResults,
    sources: summary.sources || null
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
  const { teams: teamsByDriver, sourceSeason: driverTeamSeason, source: driverTeamSource } = await fetchSeasonDriverTeams(season).catch(() => ({ teams: new Map(), sourceSeason: null, source: null }));
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
    driverTeamSeason,
    driverTeamSource
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

  const cache = new Map();
  let checkedRaces = 0;
  let updatedRaces = 0;
  let updatedResults = 0;
  const skipped = [];

  for (const raceDoc of localRaces) {
    const round = Number(raceDoc.external_round);
    if (!Number.isInteger(round) || round < 1) {
      skipped.push({ raceId: String(raceDoc._id), raceName: raceDoc.name, reason: "Race has no valid external round" });
      continue;
    }

    checkedRaces += 1;
    const cacheKey = `${chosenSeason}:${round}`;
    if (!cache.has(cacheKey)) {
      const categories = await PickCategory.find({ race: raceDoc._id }).select("name").lean().exec();
      const includeSprint = shouldIncludeSprintWeekendData(categories);
      cache.set(cacheKey, await getRoundWeekendData(chosenSeason, round, includeSprint));
    }

    const weekendData = cache.get(cacheKey);
    if (!hasPublishedWeekendResults(weekendData)) {
      skipped.push({ raceId: String(raceDoc._id), raceName: raceDoc.name, reason: "No published Jolpica weekend results found" });
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