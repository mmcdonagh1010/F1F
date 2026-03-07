import { config } from "../config.js";
import { connectMongo } from "../mongo.js";
import Race from "../models/Race.js";
import { syncCompletedRaceResultsFromJolpica, syncSeasonFromJolpica } from "../services/jolpicaSync.js";
import { setJolpicaSyncStatus } from "../services/settings.js";

let intervalId = null;
let isRunning = false;

async function getTrackedSeasons() {
  const seasons = new Set([config.jolpicaAutoSyncSeason || new Date().getUTCFullYear(), new Date().getUTCFullYear()]);
  const raceDocs = await Race.find({ external_round: { $ne: null }, race_date: { $ne: null } }).select("race_date").lean().exec();

  raceDocs.forEach((race) => {
    const raceDate = new Date(race.race_date);
    if (!Number.isNaN(raceDate.getTime())) {
      seasons.add(raceDate.getUTCFullYear());
    }
  });

  return Array.from(seasons)
    .filter((season) => Number.isInteger(season) && season >= 1950 && season <= 2100)
    .sort((a, b) => a - b);
}

async function runOnce() {
  if (isRunning) return;
  isRunning = true;
  const startedAt = new Date().toISOString();

  try {
    await setJolpicaSyncStatus({
      isRunning: true,
      lastMode: "scheduled",
      lastRunStartedAt: startedAt,
      lastErrorMessage: ""
    });

    await connectMongo();

    const seasons = await getTrackedSeasons();
    const summaries = [];

    for (const season of seasons) {
      const seasonSummary = await syncSeasonFromJolpica({ season });
      const resultsSummary = await syncCompletedRaceResultsFromJolpica({ season });
      summaries.push({ season, seasonSummary, resultsSummary });
    }

    console.log("Jolpica auto-sync completed", {
      seasons,
      summaries
    });

    await setJolpicaSyncStatus({
      isRunning: false,
      lastMode: "scheduled",
      lastRunStartedAt: startedAt,
      lastRunFinishedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      summary: {
        seasons,
        summaries
      }
    });

    return { seasons, summaries };
  } catch (error) {
    console.error("Jolpica auto-sync failed", error);
    await setJolpicaSyncStatus({
      isRunning: false,
      lastMode: "scheduled",
      lastRunStartedAt: startedAt,
      lastRunFinishedAt: new Date().toISOString(),
      lastErrorAt: new Date().toISOString(),
      lastErrorMessage: error.message,
      summary: null
    });
    throw error;
  } finally {
    isRunning = false;
  }
}

export function startJolpicaAutoSyncJob() {
  if (!config.jolpicaAutoSyncEnabled || intervalId) {
    return null;
  }

  intervalId = setInterval(() => {
    runOnce().catch(() => {});
  }, config.jolpicaAutoSyncIntervalMs);

  return intervalId;
}

export async function runJolpicaAutoSyncNow() {
  await runOnce();
}

export function getJolpicaAutoSyncRuntimeStatus() {
  return {
    enabled: config.jolpicaAutoSyncEnabled,
    isRunning,
    intervalMs: config.jolpicaAutoSyncIntervalMs,
    configuredSeason: config.jolpicaAutoSyncSeason
  };
}