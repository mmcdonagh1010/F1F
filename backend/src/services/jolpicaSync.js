import { query } from "../db.js";

const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";

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

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Jolpica request failed (${res.status}) for ${url}`);
  }
  return res.json();
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

function extractLatestRaceResults(payload) {
  const race = payload?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;

  const results = race.Results || [];
  const winner = results.find((result) => String(result.position) === "1") || results[0] || null;
  const fastestLap =
    results
      .filter((result) => Number(result?.FastestLap?.rank) > 0)
      .sort((a, b) => Number(a.FastestLap.rank) - Number(b.FastestLap.rank))[0] || null;

  const winnerName = winner ? `${winner.Driver?.givenName || ""} ${winner.Driver?.familyName || ""}`.trim() : null;
  const fastestLapName = fastestLap
    ? `${fastestLap.Driver?.givenName || ""} ${fastestLap.Driver?.familyName || ""}`.trim()
    : null;

  return {
    raceName: race.raceName,
    season: Number(race.season),
    round: Number(race.round),
    raceDateIso: parseRaceDateTime(race),
    winnerName,
    fastestLapName
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
  const payload = await fetchJson(`${JOLPICA_BASE}/${season}/driverStandings`);
  return extractDriverTeams(payload);
}

async function findTargetRaceForLatestResults({ leagueId, latestRace }) {
  const byRound = await query(
    `SELECT id, name, race_date, external_round
     FROM races
     WHERE league_id = $1
       AND race_date::date = $2::date
       AND external_round = $3
     LIMIT 1`,
    [leagueId, latestRace.raceDateIso, latestRace.round]
  );

  if (byRound.rowCount > 0) {
    return byRound.rows[0];
  }

  const byName = await query(
    `SELECT id, name, race_date, external_round
     FROM races
     WHERE league_id = $1
       AND LOWER(name) = LOWER($2)
     ORDER BY race_date DESC
     LIMIT 1`,
    [leagueId, latestRace.raceName]
  );

  return byName.rowCount > 0 ? byName.rows[0] : null;
}

async function replaceRaceDrivers(raceId, drivers) {
  await query("DELETE FROM race_drivers WHERE race_id = $1", [raceId]);

  for (let i = 0; i < drivers.length; i += 1) {
    await query(
      `INSERT INTO race_drivers (race_id, driver_name, team_name, display_order)
       VALUES ($1, $2, $3, $4)`,
      [raceId, drivers[i].name, drivers[i].teamName || null, i + 1]
    );
  }
}

async function canRefreshRaceDrivers(raceId) {
  const usage = await query(
    `SELECT
        EXISTS(SELECT 1 FROM picks WHERE race_id = $1) AS has_picks,
        EXISTS(SELECT 1 FROM results WHERE race_id = $1) AS has_results,
        EXISTS(SELECT 1 FROM scores WHERE race_id = $1) AS has_scores`,
    [raceId]
  );

  const row = usage.rows[0] || {};
  return !(row.has_picks || row.has_results || row.has_scores);
}

async function ensureRaceLeagueMappings(raceId, leagueIds) {
  for (const leagueId of leagueIds) {
    await query(
      `INSERT INTO race_leagues (race_id, league_id)
       VALUES ($1, $2)
       ON CONFLICT (race_id, league_id) DO NOTHING`,
      [raceId, leagueId]
    );
  }
}

async function upsertRace({ primaryLeagueId, race, assignedLeagueIds }) {
  const raceDateIso = parseRaceDateTime(race);
  if (!raceDateIso) return { action: "skipped", raceId: null };

  const deadlineAt = parseDeadlineAt(raceDateIso, race);
  const raceName = race.raceName;
  const circuitName = race?.Circuit?.circuitName || "Unknown Circuit";
  const externalRound = Number(race?.round || 0) || null;

  const existing = await query(
    `SELECT id
     FROM races
     WHERE name = $1
       AND race_date::date = $2::date
     LIMIT 1`,
    [raceName, raceDateIso]
  );

  if (existing.rowCount > 0) {
    const raceId = existing.rows[0].id;
    await query(
      `UPDATE races
       SET circuit_name = $2,
           external_round = COALESCE($5, external_round),
           race_date = $3,
           deadline_at = CASE WHEN status = 'upcoming' THEN $4 ELSE deadline_at END
       WHERE id = $1`,
      [raceId, circuitName, raceDateIso, deadlineAt, externalRound]
    );

    await ensureRaceLeagueMappings(raceId, assignedLeagueIds);

    return { action: "updated", raceId };
  }

  const created = await query(
    `INSERT INTO races (league_id, name, circuit_name, external_round, race_date, deadline_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [primaryLeagueId, raceName, circuitName, externalRound, raceDateIso, deadlineAt]
  );

  await ensureRaceLeagueMappings(created.rows[0].id, assignedLeagueIds);

  return { action: "created", raceId: created.rows[0].id };
}

export async function syncLatestRaceResultsFromJolpica({ leagueId, season }) {
  const chosenSeason = Number(season || new Date().getUTCFullYear());
  const payload = await fetchJson(`${JOLPICA_BASE}/${chosenSeason}/last/results`);
  const latestRace = extractLatestRaceResults(payload);

  if (!latestRace) {
    return { updated: false, reason: "No latest race results returned from Jolpica" };
  }

  const targetRace = await findTargetRaceForLatestResults({ leagueId, latestRace });
  if (!targetRace) {
    return {
      updated: false,
      reason: "No matching league race found for latest Jolpica race",
      latestRace
    };
  }

  const categoriesRes = await query(
    `SELECT id, name
     FROM pick_categories
     WHERE race_id = $1`,
    [targetRace.id]
  );

  const mappedResults = categoriesRes.rows
    .map((category) => ({
      categoryId: category.id,
      valueText: pickAutoResultForCategory(category.name, latestRace)
    }))
    .filter((item) => item.valueText);

  if (mappedResults.length === 0) {
    return {
      updated: false,
      reason: "No categories matched auto-result mapping for latest race",
      latestRace,
      raceId: targetRace.id
    };
  }

  for (const result of mappedResults) {
    await query(
      `INSERT INTO results (race_id, category_id, value_text, value_number)
       VALUES ($1, $2, $3, NULL)
       ON CONFLICT (race_id, category_id)
       DO UPDATE SET value_text = EXCLUDED.value_text,
                     value_number = EXCLUDED.value_number,
                     created_at = NOW()`,
      [targetRace.id, result.categoryId, result.valueText]
    );
  }

  await query(
    `UPDATE races
     SET status = CASE WHEN status = 'upcoming' THEN 'completed' ELSE status END
     WHERE id = $1`,
    [targetRace.id]
  );

  return {
    updated: true,
    raceId: targetRace.id,
    raceName: targetRace.name,
    mappedCount: mappedResults.length,
    latestRace
  };
}

export async function syncSeasonFromJolpica({ leagueId, season }) {
  const allLeaguesRes = await query("SELECT id FROM leagues ORDER BY created_at ASC");
  const allLeagueIds = allLeaguesRes.rows.map((row) => row.id);
  const assignedLeagueIds = leagueId ? [leagueId] : allLeagueIds;
  const primaryLeagueId = assignedLeagueIds[0] || null;
  if (!primaryLeagueId) {
    throw new Error("No leagues found for race sync");
  }

  const racesPayload = await fetchJson(`${JOLPICA_BASE}/${season}/races`);
  const driversPayload = await fetchJson(`${JOLPICA_BASE}/${season}/drivers`);
  const teamsByDriver = await fetchSeasonDriverTeams(season).catch(() => new Map());

  const races = extractRaces(racesPayload);
  const driverNames = extractDrivers(driversPayload);
  const drivers = driverNames.map((name) => ({
    name,
    teamName: teamsByDriver.get(name) || null
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
    skippedDriverRefresh
  };
}
