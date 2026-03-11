import ExternalSnapshot from "../models/ExternalSnapshot.js";
import { connectMongo } from "../mongo.js";

const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";
const CACHE_TTL_MS = 5 * 60 * 1000;

const liveCache = new Map();

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Jolpica request failed (${res.status}) for ${url}`);
  }
  return res.json();
}

function getCacheEntry(key) {
  const cached = liveCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  return null;
}

function setCacheEntry(key, value) {
  liveCache.set(key, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value
  });
}

async function getCachedOrLoad(key, loader) {
  const cached = getCacheEntry(key);
  if (cached) return cached;
  const value = await loader();
  setCacheEntry(key, value);
  return value;
}

async function savePersistentSnapshot({ snapshotKey, snapshotType, season, entityId = null, payload }) {
  try {
    await connectMongo();
    await ExternalSnapshot.findOneAndUpdate(
      { snapshot_key: snapshotKey },
      {
        snapshot_type: snapshotType,
        season,
        entity_id: entityId,
        payload,
        fetched_at: new Date(),
        updated_at: new Date()
      },
      { upsert: true, new: true }
    ).lean().exec();
  } catch (_error) {
    // Live API should still respond even if persistence fails.
  }
}

async function loadPersistentSnapshot(snapshotKey) {
  try {
    await connectMongo();
    const doc = await ExternalSnapshot.findOne({ snapshot_key: snapshotKey }).lean().exec();
    return doc?.payload || null;
  } catch (_error) {
    return null;
  }
}

function buildRaceDateTime(race) {
  const date = race?.date;
  const time = race?.time || "00:00:00Z";
  if (!date) return null;
  const value = new Date(`${date}T${time}`);
  return Number.isNaN(value.getTime()) ? null : value;
}

function toIsoIfValid(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function normalizeRace(race) {
  const raceDate = buildRaceDateTime(race);
  const qualifyingDate = race?.Qualifying?.date
    ? new Date(`${race.Qualifying.date}T${race?.Qualifying?.time || "00:00:00Z"}`)
    : null;
  const sprintDate = race?.Sprint?.date
    ? new Date(`${race.Sprint.date}T${race?.Sprint?.time || "00:00:00Z"}`)
    : null;
  const sprintQualifyingDate = race?.SprintQualifying?.date
    ? new Date(`${race.SprintQualifying.date}T${race?.SprintQualifying?.time || "00:00:00Z"}`)
    : null;

  return {
    season: Number(race?.season) || null,
    round: Number(race?.round) || null,
    name: race?.raceName || null,
    raceDate: toIsoIfValid(raceDate),
    circuitName: race?.Circuit?.circuitName || null,
    circuitId: race?.Circuit?.circuitId || null,
    locality: race?.Circuit?.Location?.locality || null,
    country: race?.Circuit?.Location?.country || null,
    qualifyingDate: toIsoIfValid(qualifyingDate),
    sprintDate: toIsoIfValid(sprintDate),
    sprintQualifyingDate: toIsoIfValid(sprintQualifyingDate),
    hasSprint: Boolean(race?.Sprint)
  };
}

function normalizeDriverDirectory(driver) {
  return {
    id: driver?.driverId || null,
    code: driver?.code || null,
    permanentNumber: driver?.permanentNumber || null,
    givenName: driver?.givenName || null,
    familyName: driver?.familyName || null,
    fullName: `${driver?.givenName || ""} ${driver?.familyName || ""}`.trim(),
    dateOfBirth: driver?.dateOfBirth || null,
    nationality: driver?.nationality || null,
    url: driver?.url || null
  };
}

function normalizeConstructor(constructor) {
  return {
    id: constructor?.constructorId || null,
    name: constructor?.name || null,
    nationality: constructor?.nationality || null,
    url: constructor?.url || null
  };
}

function normalizeRaceResultEntry(result) {
  return {
    position: Number(result?.position) || null,
    points: Number(result?.points) || 0,
    grid: Number(result?.grid) || null,
    laps: Number(result?.laps) || null,
    status: result?.status || null,
    time: result?.Time?.time || null,
    fastestLapRank: Number(result?.FastestLap?.rank) || null,
    fastestLapTime: result?.FastestLap?.Time?.time || null,
    driver: normalizeDriverDirectory(result?.Driver || {}),
    team: normalizeConstructor(result?.Constructor || {})
  };
}

function normalizeDriverStanding(entry) {
  return {
    position: Number(entry?.position) || null,
    points: Number(entry?.points) || 0,
    wins: Number(entry?.wins) || 0,
    driver: normalizeDriverDirectory(entry?.Driver || {}),
    team: entry?.Constructors?.[0] ? normalizeConstructor(entry.Constructors[0]) : null
  };
}

function normalizeConstructorStanding(entry) {
  return {
    position: Number(entry?.position) || null,
    points: Number(entry?.points) || 0,
    wins: Number(entry?.wins) || 0,
    team: normalizeConstructor(entry?.Constructor || {})
  };
}

function normalizeLatestResult(race) {
  if (!race) return null;

  const results = Array.isArray(race.Results) ? race.Results : [];
  const podium = results.slice(0, 3).map(normalizeRaceResultEntry);
  const fastestLap = results
    .filter((result) => Number(result?.FastestLap?.rank) > 0)
    .sort((a, b) => Number(a.FastestLap.rank) - Number(b.FastestLap.rank))[0] || null;

  return {
    ...normalizeRace(race),
    podium,
    fastestLap: fastestLap
      ? {
          rank: Number(fastestLap?.FastestLap?.rank) || null,
          time: fastestLap?.FastestLap?.Time?.time || null,
          averageSpeed: fastestLap?.FastestLap?.AverageSpeed?.speed || null,
          units: fastestLap?.FastestLap?.AverageSpeed?.units || null,
          driver: normalizeDriverDirectory(fastestLap?.Driver || {}),
          team: normalizeConstructor(fastestLap?.Constructor || {})
        }
      : null
  };
}

function getSeasonCacheKey(season) {
  return `snapshot:${season}`;
}

function getBundleCacheKey(season) {
  return `bundle:${season}`;
}

async function loadSeasonBundle(season) {
  const [schedulePayload, latestResultsPayload, driversPayload, driverStandingsPayload, constructorStandingsPayload] = await Promise.all([
    fetchJson(`${JOLPICA_BASE}/${season}.json`),
    fetchJson(`${JOLPICA_BASE}/${season}/last/results.json`).catch(() => null),
    fetchJson(`${JOLPICA_BASE}/${season}/drivers.json`).catch(() => null),
    fetchJson(`${JOLPICA_BASE}/${season}/driverStandings.json`).catch(() => null),
    fetchJson(`${JOLPICA_BASE}/${season}/constructorStandings.json`).catch(() => null)
  ]);

  return {
    season,
    schedulePayload,
    latestResultsPayload,
    driversPayload,
    driverStandingsPayload,
    constructorStandingsPayload
  };
}

function hasSchedule(bundle) {
  return Boolean(bundle?.schedulePayload?.MRData?.RaceTable?.Races?.length);
}

function hasLatestRace(bundle) {
  return Boolean(bundle?.latestResultsPayload?.MRData?.RaceTable?.Races?.length);
}

function hasStandings(bundle) {
  const driverRows = bundle?.driverStandingsPayload?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
  const constructorRows = bundle?.constructorStandingsPayload?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];
  return driverRows.length > 0 || constructorRows.length > 0;
}

async function resolveSeasonBundle(requestedSeason) {
  const preferredSeason = Number(requestedSeason) || new Date().getUTCFullYear();
  const candidateSeasons = [...new Set([preferredSeason, preferredSeason - 1, preferredSeason - 2].filter((value) => value >= 1950))];

  for (const season of candidateSeasons) {
    const bundle = await getCachedOrLoad(getBundleCacheKey(season), () => loadSeasonBundle(season));
    if (hasSchedule(bundle)) {
      return bundle;
    }
  }

  return getCachedOrLoad(getBundleCacheKey(preferredSeason), () => loadSeasonBundle(preferredSeason));
}

async function resolveSupplementalBundle(requestedSeason, matcher) {
  const preferredSeason = Number(requestedSeason) || new Date().getUTCFullYear();
  const candidateSeasons = [...new Set([preferredSeason, preferredSeason - 1, preferredSeason - 2].filter((value) => value >= 1950))];

  for (const season of candidateSeasons) {
    const bundle = await getCachedOrLoad(getBundleCacheKey(season), () => loadSeasonBundle(season));
    if (matcher(bundle)) {
      return bundle;
    }
  }

  return null;
}

function buildDriverStats(results) {
  const positions = results.map((result) => result.position).filter((value) => Number.isInteger(value));
  return {
    raceCount: results.length,
    wins: positions.filter((value) => value === 1).length,
    podiums: positions.filter((value) => value >= 1 && value <= 3).length,
    bestFinish: positions.length > 0 ? Math.min(...positions) : null,
    totalPoints: results.reduce((sum, result) => sum + Number(result.points || 0), 0)
  };
}

function buildTeamStats(results) {
  const positions = results.map((result) => result.topFinish).filter((value) => Number.isInteger(value));
  return {
    raceCount: results.length,
    wins: positions.filter((value) => value === 1).length,
    podiums: positions.filter((value) => value >= 1 && value <= 3).length,
    bestFinish: positions.length > 0 ? Math.min(...positions) : null,
    totalPoints: results.reduce((sum, result) => sum + Number(result.teamPoints || 0), 0)
  };
}

export async function getLiveF1Snapshot(seasonInput) {
  const requestedSeason = Number(seasonInput) || new Date().getUTCFullYear();
  const cacheKey = getSeasonCacheKey(requestedSeason);
  const persistentKey = `live:${requestedSeason}`;

  try {
    const value = await getCachedOrLoad(cacheKey, async () => {
      const {
        season,
        schedulePayload,
        latestResultsPayload,
        driversPayload,
        driverStandingsPayload,
        constructorStandingsPayload
      } = await resolveSeasonBundle(requestedSeason);

      const latestResultBundle = hasLatestRace({ latestResultsPayload })
        ? { season, latestResultsPayload }
        : await resolveSupplementalBundle(requestedSeason, hasLatestRace);
      const standingsBundle = hasStandings({ driverStandingsPayload, constructorStandingsPayload })
        ? { season, driverStandingsPayload, constructorStandingsPayload }
        : await resolveSupplementalBundle(requestedSeason, hasStandings);

      const calendar = (schedulePayload?.MRData?.RaceTable?.Races || []).map(normalizeRace);
      const now = Date.now();
      const upcomingRaces = calendar.filter((race) => race.raceDate && new Date(race.raceDate).getTime() >= now);
      const completedRaces = calendar.filter((race) => race.raceDate && new Date(race.raceDate).getTime() < now);

      const latestRace = normalizeLatestResult(latestResultBundle?.latestResultsPayload?.MRData?.RaceTable?.Races?.[0] || null);
      const drivers = (driversPayload?.MRData?.DriverTable?.Drivers || []).map(normalizeDriverDirectory);
      const driverStandings = (standingsBundle?.driverStandingsPayload?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || []).map(normalizeDriverStanding);
      const constructors = (standingsBundle?.constructorStandingsPayload?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || []).map(normalizeConstructorStanding);

      const teams = constructors.map((entry) => entry.team).filter((team) => team?.name);
      const driverTeamMap = new Map(driverStandings.map((entry) => [entry.driver.id, entry.team]).filter(([id, team]) => id && team?.id));

      return {
        source: "Jolpica / Ergast",
        requestedSeason,
        season,
        latestResultSeason: latestResultBundle?.season || null,
        standingsSeason: standingsBundle?.season || null,
        fetchedAt: new Date().toISOString(),
        snapshotMode: "live",
        latestRace,
        nextRace: upcomingRaces[0] || null,
        upcomingRaces: upcomingRaces.slice(0, 5),
        completedRaceCount: completedRaces.length,
        totalRaceCount: calendar.length,
        calendar,
        drivers: drivers.map((driver) => ({
          ...driver,
          team: driverTeamMap.get(driver.id) || null
        })),
        driverStandings,
        constructors,
        teams
      };
    });

    await savePersistentSnapshot({
      snapshotKey: persistentKey,
      snapshotType: "live",
      season: requestedSeason,
      payload: value
    });

    return value;
  } catch (error) {
    const persisted = await loadPersistentSnapshot(persistentKey);
    if (persisted) {
      return {
        ...persisted,
        snapshotMode: "persisted",
        snapshotError: error.message
      };
    }
    throw error;
  }
}

export async function getLiveDriverDetail(driverId, seasonInput) {
  const requestedSeason = Number(seasonInput) || new Date().getUTCFullYear();
  const cacheKey = `driver:${requestedSeason}:${driverId}`;
  const persistentKey = `driver:${requestedSeason}:${driverId}`;

  try {
    const value = await getCachedOrLoad(cacheKey, async () => {
      const snapshot = await getLiveF1Snapshot(requestedSeason);
      const standing = snapshot.driverStandings.find((entry) => entry.driver.id === driverId) || null;
      const directoryDriver = snapshot.drivers.find((entry) => entry.id === driverId) || standing?.driver || null;
      const resultSeason = snapshot.latestResultSeason || snapshot.standingsSeason || snapshot.season;

      if (!directoryDriver) {
        throw new Error("Driver not found");
      }

      const resultsPayload = await fetchJson(`${JOLPICA_BASE}/${resultSeason}/drivers/${driverId}/results.json`).catch(() => null);
      const raceResults = (resultsPayload?.MRData?.RaceTable?.Races || []).map((race) => {
        const result = race?.Results?.[0] || null;
        return {
          race: normalizeRace(race),
          position: Number(result?.position) || null,
          points: Number(result?.points) || 0,
          status: result?.status || null,
          grid: Number(result?.grid) || null,
          team: normalizeConstructor(result?.Constructor || {}),
          fastestLapRank: Number(result?.FastestLap?.rank) || null,
          fastestLapTime: result?.FastestLap?.Time?.time || null
        };
      });

      return {
        season: snapshot.season,
        requestedSeason,
        standingsSeason: snapshot.standingsSeason,
        resultSeason,
        snapshotMode: snapshot.snapshotMode || "live",
        driver: directoryDriver,
        standing,
        stats: buildDriverStats(raceResults),
        results: raceResults,
        latestRace: raceResults[raceResults.length - 1] || null
      };
    });

    await savePersistentSnapshot({
      snapshotKey: persistentKey,
      snapshotType: "driver-detail",
      season: requestedSeason,
      entityId: driverId,
      payload: value
    });

    return value;
  } catch (error) {
    const persisted = await loadPersistentSnapshot(persistentKey);
    if (persisted) {
      return {
        ...persisted,
        snapshotMode: "persisted",
        snapshotError: error.message
      };
    }
    throw error;
  }
}

export async function getLiveTeamDetail(teamId, seasonInput) {
  const requestedSeason = Number(seasonInput) || new Date().getUTCFullYear();
  const cacheKey = `team:${requestedSeason}:${teamId}`;
  const persistentKey = `team:${requestedSeason}:${teamId}`;

  try {
    const value = await getCachedOrLoad(cacheKey, async () => {
      const snapshot = await getLiveF1Snapshot(requestedSeason);
      const standing = snapshot.constructors.find((entry) => entry.team.id === teamId) || null;
      const team = snapshot.teams.find((entry) => entry.id === teamId) || standing?.team || null;
      const resultSeason = snapshot.latestResultSeason || snapshot.standingsSeason || snapshot.season;

      if (!team) {
        throw new Error("Team not found");
      }

      const resultsPayload = await fetchJson(`${JOLPICA_BASE}/${resultSeason}/constructors/${teamId}/results.json`).catch(() => null);
      const raceResults = (resultsPayload?.MRData?.RaceTable?.Races || []).map((race) => {
        const entries = (race?.Results || []).map(normalizeRaceResultEntry);
        const drivers = entries.map((entry) => entry.driver).filter((driver) => driver?.id);
        const positions = entries.map((entry) => entry.position).filter((value) => Number.isInteger(value));

        return {
          race: normalizeRace(race),
          drivers,
          topFinish: positions.length > 0 ? Math.min(...positions) : null,
          teamPoints: entries.reduce((sum, entry) => sum + Number(entry.points || 0), 0),
          entries
        };
      });

      const driverMap = new Map();
      raceResults.forEach((race) => {
        race.drivers.forEach((driver) => {
          driverMap.set(driver.id, driver);
        });
      });

      return {
        season: snapshot.season,
        requestedSeason,
        standingsSeason: snapshot.standingsSeason,
        resultSeason,
        snapshotMode: snapshot.snapshotMode || "live",
        team,
        standing,
        stats: buildTeamStats(raceResults),
        drivers: Array.from(driverMap.values()),
        results: raceResults,
        latestRace: raceResults[raceResults.length - 1] || null
      };
    });

    await savePersistentSnapshot({
      snapshotKey: persistentKey,
      snapshotType: "team-detail",
      season: requestedSeason,
      entityId: teamId,
      payload: value
    });

    return value;
  } catch (error) {
    const persisted = await loadPersistentSnapshot(persistentKey);
    if (persisted) {
      return {
        ...persisted,
        snapshotMode: "persisted",
        snapshotError: error.message
      };
    }
    throw error;
  }
}