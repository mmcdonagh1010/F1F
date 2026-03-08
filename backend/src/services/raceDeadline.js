const JOLPICA_BASE = "https://api.jolpi.ca/ergast/f1";

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Jolpica request failed (${res.status}) for ${url}`);
  }
  return res.json();
}

function toIso(datePart, timePart = "00:00:00Z") {
  if (!datePart) return null;
  const parsed = new Date(`${datePart}T${timePart}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parsePositionCategoryScope(categoryName) {
  const normalized = String(categoryName || "").toLowerCase();
  if (/^race qualification p\d+$/i.test(categoryName || "")) return "qualifying";
  if (/^sprint qualification p\d+$/i.test(categoryName || "")) return "sprint";
  if (/^sprint result p\d+$/i.test(categoryName || "")) return "sprint";
  if (/^race result p\d+$/i.test(categoryName || "")) return "race";
  if (normalized.includes("sprint qualification")) return "sprint";
  if (normalized.includes("sprint result winner")) return "sprint";
  if (normalized.includes("qualification")) return "qualifying";
  return null;
}

function collectEnabledSessions(categories) {
  const sessions = new Set();

  (categories || []).forEach((category) => {
    const scope = parsePositionCategoryScope(category?.name);
    if (scope) {
      sessions.add(scope);
      return;
    }

    sessions.add("race");
  });

  return sessions;
}

function buildScheduleCandidates(schedule, enabledSessions) {
  const candidates = [];

  if (enabledSessions.has("qualifying") && schedule.qualifyingDateIso) {
    candidates.push(schedule.qualifyingDateIso);
  }

  if (enabledSessions.has("sprint") && schedule.sprintDateIso) {
    candidates.push(schedule.sprintDateIso);
  }

  if (enabledSessions.has("race") && schedule.raceDateIso) {
    candidates.push(schedule.raceDateIso);
  }

  return candidates.sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
}

export function getFallbackDeadlineAt(race) {
  return race?.manual_deadline_at || race?.deadline_at || race?.race_date || null;
}

export async function fetchRaceSchedule({ season, round }) {
  const seasonValue = Number(season || 0);
  const roundValue = Number(round || 0);
  if (!Number.isInteger(seasonValue) || !Number.isInteger(roundValue) || roundValue < 1) {
    return null;
  }

  const payload = await fetchJson(`${JOLPICA_BASE}/${seasonValue}/${roundValue}.json`);
  const race = payload?.MRData?.RaceTable?.Races?.[0];
  if (!race) return null;

  return {
    raceDateIso: toIso(race?.date, race?.time || "00:00:00Z"),
    qualifyingDateIso: toIso(race?.Qualifying?.date, race?.Qualifying?.time || "00:00:00Z"),
    sprintDateIso: toIso(race?.Sprint?.date, race?.Sprint?.time || "00:00:00Z")
  };
}

export async function deriveDeadlineAtFromCategories({ race, categories }) {
  const fallbackDeadlineAt = getFallbackDeadlineAt(race);
  const enabledSessions = collectEnabledSessions(categories);
  if (enabledSessions.size === 0) {
    return fallbackDeadlineAt;
  }

  const raceDate = race?.race_date ? new Date(race.race_date) : null;
  const season = raceDate && !Number.isNaN(raceDate.getTime()) ? raceDate.getUTCFullYear() : null;
  const round = Number(race?.external_round || 0);

  if (!season || !Number.isInteger(round) || round < 1) {
    return fallbackDeadlineAt;
  }

  try {
    const schedule = await fetchRaceSchedule({ season, round });
    if (!schedule) return fallbackDeadlineAt;

    const candidates = buildScheduleCandidates(schedule, enabledSessions);
    return candidates[0] || fallbackDeadlineAt;
  } catch {
    return fallbackDeadlineAt;
  }
}