import express from "express";
import crypto from "crypto";
// MongoDB-only: removed SQL fallback and imports
import { authRequired, adminRequired } from "../middleware/auth.js";
import { buildRateLimiter } from "../middleware/rateLimit.js";
import { calculateRaceScores } from "../services/scoring.js";
import { syncCompletedRaceResultsFromJolpica, syncLatestRaceResultsFromJolpica, syncSeasonFromJolpica, syncSprintQualifyingResultsForRace } from "../services/jolpicaSync.js";
import { deriveDeadlineAtFromCategories } from "../services/raceDeadline.js";
import { config } from "../config.js";
import { getJolpicaAutoSyncRuntimeStatus } from "../jobs/jolpicaAutoSync.js";
import {
  deleteMediaOverride,
  getJolpicaSyncStatus,
  getMediaOverrides,
  getPickLockMinutesBeforeDeadline,
  normalizePickLockMinutes,
  setJolpicaSyncStatus,
  upsertMediaOverride,
  setPickLockMinutesBeforeDeadline
} from "../services/settings.js";

const router = express.Router();

const bootstrapAdminRateLimit = buildRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many bootstrap admin attempts. Try again later."
});

const PREDICTION_PRESETS = {
  raceQualificationPositions: {
    name: "Race Qualification Position",
    isPositionBased: true,
    exactPoints: 5,
    partialPoints: 1,
    supportsSlots: true
  },
  sprintQualificationPositions: {
    name: "Sprint Qualification Position",
    isPositionBased: true,
    exactPoints: 5,
    partialPoints: 1,
    sprintOnly: true,
    supportsSlots: true
  },
  sprintResult: {
    name: "Sprint Result Winner",
    isPositionBased: true,
    exactPoints: 10,
    partialPoints: 5,
    sprintOnly: true
  },
  driverOfWeekend: {
    name: "Driver of the Weekend",
    isPositionBased: false,
    exactPoints: 10,
    partialPoints: 0
  },
  fastestLapDriver: {
    name: "Fastest Lap Driver",
    isPositionBased: false,
    exactPoints: 8,
    partialPoints: 0
  },
  teamOfWeekend: {
    name: "Team of the Weekend",
    isPositionBased: false,
    exactPoints: 10,
    partialPoints: 0
  },
  racePositions: {
    name: "Race Result Position",
    isPositionBased: true,
    exactPoints: 5,
    partialPoints: 1,
    supportsSlots: true
  },
  sprintPositions: {
    name: "Sprint Result Position",
    isPositionBased: true,
    exactPoints: 5,
    partialPoints: 1,
    sprintOnly: true,
    supportsSlots: true
  }
};

const VALID_MEDIA_OVERRIDE_TYPES = new Set(["drivers", "teams", "races", "driver", "team", "race"]);
const MEDIA_DATA_URL_PREFIX = /^data:image\/[a-zA-Z0-9.+-]+;base64,/;
const MAX_MEDIA_DATA_URL_LENGTH = 2_500_000;

function normalizePointOverride(raw, preset) {
  if (!raw || typeof raw !== "object") {
    return {
      exactPoints: preset.exactPoints,
      partialPoints: preset.partialPoints || 0
    };
  }

  const exact = Number(raw.exactPoints);
  const partial = Number(raw.partialPoints);

  const exactPoints = Number.isFinite(exact) && exact >= 0 ? Math.floor(exact) : preset.exactPoints;
  const partialPoints = Number.isFinite(partial) && partial >= 0 ? Math.floor(partial) : (preset.partialPoints || 0);

  return { exactPoints, partialPoints };
}

function generateInviteCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

function normalizeMediaOverrideType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!VALID_MEDIA_OVERRIDE_TYPES.has(normalized)) return null;
  if (normalized === "driver") return "drivers";
  if (normalized === "team") return "teams";
  if (normalized === "race") return "races";
  return normalized;
}

function isValidMediaDataUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  if (normalized.length > MAX_MEDIA_DATA_URL_LENGTH) return false;
  return MEDIA_DATA_URL_PREFIX.test(normalized);
}

function normalizePositionSlots(positionSlots) {
  if (!Array.isArray(positionSlots)) return [];

  return [...new Set(positionSlots
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 30))]
    .sort((a, b) => a - b);
}

function normalizeDriverRows(drivers) {
  if (!Array.isArray(drivers) || drivers.length === 0) return [];

  const seenNames = new Set();
  const rows = [];
  drivers.forEach((driver, index) => {
    const rawName = typeof driver === "string" ? driver : driver?.name || driver?.driverName;
    const name = String(rawName || "").trim();
    if (!name) return;

    const dedupeKey = name.toLowerCase();
    if (seenNames.has(dedupeKey)) return;
    seenNames.add(dedupeKey);

    rows.push({
      name,
      teamName: String(driver?.teamName || driver?.team || "").trim() || null,
      metadata: driver?.metadata && typeof driver.metadata === "object" ? driver.metadata : {},
      displayOrder: index + 1
    });
  });

  return rows;
}

function normalizeCategoryUpdateDocs(categories, raceId) {
  return (Array.isArray(categories) ? categories : []).map((category) => ({
    race: raceId,
    name: String(category?.name || "").trim(),
    display_order: Number(category?.displayOrder ?? category?.display_order ?? 0) || 0,
    is_position_based: Boolean(category?.isPositionBased ?? category?.is_position_based),
    metadata: category?.metadata && typeof category.metadata === "object" ? category.metadata : {},
    exact_points: Number(category?.exactPoints ?? category?.exact_points ?? 0) || 0,
    partial_points: Number(category?.partialPoints ?? category?.partial_points ?? 0) || 0
  })).filter((category) => category.name);
}

function sortObjectDeep(value) {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (!value || typeof value !== "object") return value;

  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce((acc, key) => {
      acc[key] = sortObjectDeep(value[key]);
      return acc;
    }, {});
}

function isSameMetadata(left, right) {
  return JSON.stringify(sortObjectDeep(left || {})) === JSON.stringify(sortObjectDeep(right || {}));
}

function getRiskRank(level) {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

function getHighestRiskLevel(changes) {
  return (changes || []).reduce((current, change) => (
    getRiskRank(change.riskLevel) > getRiskRank(current) ? change.riskLevel : current
  ), "low");
}

function buildPredictionBulkSummaryRow(raceDoc, existingCategories, incomingCategories) {
  const existingByName = new Map((existingCategories || []).map((category) => [String(category.name), category]));
  const incomingByName = new Map((incomingCategories || []).map((category) => [String(category.name), category]));
  const allNames = [...new Set([...existingByName.keys(), ...incomingByName.keys()])].sort((a, b) => a.localeCompare(b));

  const changes = [];
  for (const categoryName of allNames) {
    const existing = existingByName.get(categoryName) || null;
    const incoming = incomingByName.get(categoryName) || null;

    if (!existing && incoming) {
      changes.push({
        type: "category-added",
        categoryName,
        riskLevel: (existingCategories || []).length > 0 ? "high" : "medium",
        summary: `Add category '${categoryName}'`
      });
      continue;
    }

    if (existing && !incoming) {
      changes.push({
        type: "category-removed",
        categoryName,
        riskLevel: "high",
        summary: `Remove category '${categoryName}'`
      });
      continue;
    }

    if (!existing || !incoming) continue;

    if (Number(existing.exact_points || 0) !== Number(incoming.exact_points || 0)) {
      changes.push({
        type: "exact-points-updated",
        categoryName,
        riskLevel: "low",
        from: Number(existing.exact_points || 0),
        to: Number(incoming.exact_points || 0),
        summary: `Exact points '${categoryName}' ${Number(existing.exact_points || 0)} -> ${Number(incoming.exact_points || 0)}`
      });
    }

    if (Number(existing.partial_points || 0) !== Number(incoming.partial_points || 0)) {
      changes.push({
        type: "partial-points-updated",
        categoryName,
        riskLevel: "low",
        from: Number(existing.partial_points || 0),
        to: Number(incoming.partial_points || 0),
        summary: `Partial points '${categoryName}' ${Number(existing.partial_points || 0)} -> ${Number(incoming.partial_points || 0)}`
      });
    }

    if (Number(existing.display_order || 0) !== Number(incoming.display_order || 0)) {
      changes.push({
        type: "display-order-updated",
        categoryName,
        riskLevel: "low",
        from: Number(existing.display_order || 0),
        to: Number(incoming.display_order || 0),
        summary: `Display order '${categoryName}' ${Number(existing.display_order || 0)} -> ${Number(incoming.display_order || 0)}`
      });
    }

    if (Boolean(existing.is_position_based) !== Boolean(incoming.is_position_based)) {
      changes.push({
        type: "position-mode-updated",
        categoryName,
        riskLevel: "high",
        from: Boolean(existing.is_position_based),
        to: Boolean(incoming.is_position_based),
        summary: `Position mode changed for '${categoryName}'`
      });
    }

    if (!isSameMetadata(existing.metadata, incoming.metadata)) {
      changes.push({
        type: "metadata-updated",
        categoryName,
        riskLevel: "medium",
        summary: `Metadata changed for '${categoryName}'`
      });
    }
  }

  const raceAt = new Date(raceDoc?.race_date).getTime();
  const hasOccurred = Number.isFinite(raceAt) ? raceAt <= Date.now() : false;
  const riskLevel = changes.length > 0 ? getHighestRiskLevel(changes) : "low";

  return {
    raceId: String(raceDoc?._id),
    raceName: raceDoc?.name || "Unknown race",
    raceDate: raceDoc?.race_date || null,
    hasOccurred,
    willApplyByDefault: changes.length > 0 && !hasOccurred,
    riskLevel,
    existingCategoryCount: (existingCategories || []).length,
    incomingCategoryCount: (incomingCategories || []).length,
    changes,
    changeCounts: {
      low: changes.filter((change) => change.riskLevel === "low").length,
      medium: changes.filter((change) => change.riskLevel === "medium").length,
      high: changes.filter((change) => change.riskLevel === "high").length
    }
  };
}

function summarizePredictionBulkPreview(rows) {
  const changedRows = (rows || []).filter((row) => row.changes.length > 0);
  return {
    totalRaces: (rows || []).length,
    changedRaces: changedRows.length,
    futureRacesToApplyByDefault: changedRows.filter((row) => !row.hasOccurred).length,
    pastRacesWithChanges: changedRows.filter((row) => row.hasOccurred).length,
    lowRiskChanges: changedRows.reduce((total, row) => total + row.changeCounts.low, 0),
    mediumRiskChanges: changedRows.reduce((total, row) => total + row.changeCounts.medium, 0),
    highRiskChanges: changedRows.reduce((total, row) => total + row.changeCounts.high, 0)
  };
}

function parseIncludeEmptyRaces(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  return fallback;
}

async function upsertRaceCategories({ raceId, categories }) {
  const { connectMongo } = await import("../mongo.js");
  const PickCategory = (await import("../models/PickCategory.js")).default;
  const Pick = (await import("../models/Pick.js")).default;
  const Result = (await import("../models/Result.js")).default;
  const Race = (await import("../models/Race.js")).default;
  await connectMongo();

  const docs = normalizeCategoryUpdateDocs(categories, raceId);
  const existingCategories = await PickCategory.find({ race: raceId }).lean().exec();
  const existingByName = new Map(existingCategories.map((category) => [String(category.name), category]));
  const nextNames = new Set(docs.map((category) => String(category.name)));
  const categoriesToRemove = existingCategories.filter((category) => !nextNames.has(String(category.name)));

  if (categoriesToRemove.length > 0) {
    const removableIds = categoriesToRemove.map((category) => category._id);
    const removableIdStrings = categoriesToRemove.map((category) => String(category._id));
    const [linkedPick, linkedResult] = await Promise.all([
      Pick.exists({ race: raceId, category: { $in: removableIds } }).exec(),
      Result.exists({ race: raceId, category: { $in: removableIdStrings } }).exec()
    ]);

    if (linkedPick || linkedResult) {
      throw new Error("Cannot remove or rename prediction categories after players have saved picks or results exist. You can still update the points for the existing categories.");
    }
  }

  const operations = docs.map(async (category) => {
    const existing = existingByName.get(String(category.name));
    if (existing) {
      await PickCategory.updateOne(
        { _id: existing._id },
        {
          $set: {
            display_order: category.display_order,
            is_position_based: category.is_position_based,
            metadata: category.metadata,
            exact_points: category.exact_points,
            partial_points: category.partial_points
          }
        }
      ).exec();
      return existing._id;
    }

    const created = await PickCategory.create(category);
    return created._id;
  });

  await Promise.all(operations);

  if (categoriesToRemove.length > 0) {
    await PickCategory.deleteMany({ _id: { $in: categoriesToRemove.map((category) => category._id) } }).exec();
  }

  const race = await Race.findById(raceId).lean().exec();
  if (!race) throw new Error("Race not found");

  const deadlineAt = await deriveDeadlineAtFromCategories({ race, categories: docs });
  await Race.updateOne(
    { _id: raceId },
    {
      $set: {
        is_visible: docs.length > 0,
        predictions_live: docs.length > 0 ? race.predictions_live !== false : false,
        ...(deadlineAt ? { deadline_at: new Date(deadlineAt) } : {})
      }
    }
  ).exec();

  const hasResults = await Result.exists({ race: raceId }).exec();
  let rescored = false;
  if (hasResults) {
    await calculateRaceScores(raceId);
    rescored = true;
  }

  return {
    message: rescored ? "Categories updated and scores recalculated" : "Categories updated",
    rescored
  };
}

async function loadPredictionBulkRows(year, importedRaces = null) {
  const { connectMongo } = await import("../mongo.js");
  const Race = (await import("../models/Race.js")).default;
  const PickCategory = (await import("../models/PickCategory.js")).default;
  await connectMongo();

  const raceDocs = await Race.find({
    race_date: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) }
  }).sort({ race_date: 1 }).lean().exec();

  const categories = raceDocs.length > 0
    ? await PickCategory.find({ race: { $in: raceDocs.map((race) => race._id) } }).sort({ race: 1, display_order: 1 }).lean().exec()
    : [];

  const categoriesByRaceId = new Map();
  for (const category of categories) {
    const key = String(category.race);
    const list = categoriesByRaceId.get(key) || [];
    list.push(category);
    categoriesByRaceId.set(key, list);
  }

  if (!importedRaces) {
    return raceDocs.map((race) => ({
      raceId: String(race._id),
      name: race.name,
      circuitName: race.circuit_name || null,
      externalRound: race.external_round || null,
      raceDate: race.race_date,
      deadlineAt: race.deadline_at,
      status: race.status || null,
      isVisible: Boolean(race.is_visible),
      predictionsLive: race.predictions_live !== false,
      hasSprintWeekend: Boolean(race.has_sprint_weekend),
      categories: (categoriesByRaceId.get(String(race._id)) || []).map((category) => ({
        name: category.name,
        displayOrder: Number(category.display_order || 0),
        isPositionBased: Boolean(category.is_position_based),
        metadata: category.metadata && typeof category.metadata === "object" ? category.metadata : {},
        exactPoints: Number(category.exact_points || 0),
        partialPoints: Number(category.partial_points || 0)
      }))
    }));
  }

  const raceById = new Map(raceDocs.map((race) => [String(race._id), race]));
  return (Array.isArray(importedRaces) ? importedRaces : []).map((entry) => {
    const race = raceById.get(String(entry?.raceId || "")) || null;
    const incomingCategories = normalizeCategoryUpdateDocs(entry?.categories || [], race?._id || entry?.raceId || "");
    const existingCategories = race ? (categoriesByRaceId.get(String(race._id)) || []) : [];
    if (!race) {
      return {
        raceId: String(entry?.raceId || ""),
        raceName: String(entry?.name || "Unknown race"),
        raceDate: entry?.raceDate || null,
        hasOccurred: false,
        willApplyByDefault: false,
        riskLevel: "high",
        existingCategoryCount: 0,
        incomingCategoryCount: incomingCategories.length,
        changes: [{
          type: "race-missing",
          categoryName: null,
          riskLevel: "high",
          summary: `Race '${String(entry?.name || entry?.raceId || "Unknown")}' was not found in ${year}`
        }],
        changeCounts: { low: 0, medium: 0, high: 1 },
        missingRace: true,
        incomingCategories
      };
    }

    return {
      ...buildPredictionBulkSummaryRow(race, existingCategories, incomingCategories),
      incomingCategories
    };
  });
}

function buildRaceCategories(
  predictionOptions = [],
  hasSprintWeekend = false,
  positionSlots = [],
  positionSlotsByOption = {},
  pointOverrides = {},
  fixedTeamOfWeekend = ""
) {
  const uniqueOptions = [...new Set(predictionOptions)];
  const normalizedSlots = normalizePositionSlots(positionSlots);
  const raceSlots = normalizePositionSlots(positionSlotsByOption?.racePositions || []);
  const sprintSlots = normalizePositionSlots(positionSlotsByOption?.sprintPositions || []);
  const raceQualificationSlots = normalizePositionSlots(positionSlotsByOption?.raceQualificationPositions || []);
  const sprintQualificationSlots = normalizePositionSlots(positionSlotsByOption?.sprintQualificationPositions || []);
  const expanded = [];

  uniqueOptions.forEach((key) => {
    if (
      key !== "racePositions" &&
      key !== "sprintPositions" &&
      key !== "raceQualificationPositions" &&
      key !== "sprintQualificationPositions"
    ) {
      expanded.push({ key, slot: null });
      return;
    }

    let slots = [1, 2, 3];
    if (key === "racePositions") {
      slots = raceSlots.length > 0 ? raceSlots : (normalizedSlots.length > 0 ? normalizedSlots : [1, 2, 3]);
    }

    if (key === "sprintPositions") {
      slots = sprintSlots.length > 0 ? sprintSlots : (normalizedSlots.length > 0 ? normalizedSlots : [1, 2, 3]);
    }

    if (key === "raceQualificationPositions") {
      slots = raceQualificationSlots.length > 0 ? raceQualificationSlots : (normalizedSlots.length > 0 ? normalizedSlots : [1, 2, 3]);
    }

    if (key === "sprintQualificationPositions") {
      slots = sprintQualificationSlots.length > 0 ? sprintQualificationSlots : (normalizedSlots.length > 0 ? normalizedSlots : [1, 2, 3]);
    }

    slots.forEach((slot) => expanded.push({ key, slot }));
  });

  return expanded
    .map(({ key, slot }) => ({ key, slot, preset: PREDICTION_PRESETS[key] }))
    .filter(({ preset }) => {
      if (!preset) return false;
      if (preset.sprintOnly && !hasSprintWeekend) return false;
      return true;
    })
    .map(({ key, preset, slot }, idx) => {
      const points = normalizePointOverride(pointOverrides[key], preset);

      if (slot) {
        let scope = "Race Result";
        const presetName = preset.name.toLowerCase();
        if (presetName.includes("qualification") && presetName.includes("sprint")) {
          scope = "Sprint Qualification";
        } else if (presetName.includes("qualification")) {
          scope = "Race Qualification";
        } else if (presetName.includes("sprint")) {
          scope = "Sprint Result";
        }

        return {
          name: `${scope} P${slot}`,
          isPositionBased: true,
          exactPoints: points.exactPoints,
          partialPoints: points.partialPoints,
          displayOrder: idx + 1
        };
      }

      if (key === "teamOfWeekend") {
        const metadata = fixedTeamOfWeekend ? { fixedTeam: fixedTeamOfWeekend } : {};
        const categories = [
          {
            name: "Race Team Battle Winner (Driver)",
            isPositionBased: false,
            metadata,
            exactPoints: points.exactPoints,
            partialPoints: points.partialPoints,
            displayOrder: idx + 1
          },
          {
            name: "Race Team Battle Winning Margin",
            isPositionBased: false,
            metadata,
            exactPoints: points.exactPoints,
            partialPoints: points.partialPoints,
            displayOrder: idx + 2
          }
        ];

        if (hasSprintWeekend) {
          categories.push(
            {
              name: "Sprint Team Battle Winner (Driver)",
              isPositionBased: false,
              metadata,
              exactPoints: points.exactPoints,
              partialPoints: points.partialPoints,
              displayOrder: idx + 3
            },
            {
              name: "Sprint Team Battle Winning Margin",
              isPositionBased: false,
              metadata,
              exactPoints: points.exactPoints,
              partialPoints: points.partialPoints,
              displayOrder: idx + 4
            }
          );
        }

        return categories;
      }

      return {
        ...preset,
        exactPoints: points.exactPoints,
        partialPoints: points.partialPoints,
        displayOrder: idx + 1
      };
    })
    .flat()
    .map((category, idx) => ({
      ...category,
      displayOrder: idx + 1
    }));
}

function isTeamBattleMarginCategory(categoryName) {
  const normalized = categoryName.toLowerCase();
  return normalized.includes("team battle") && normalized.includes("margin");
}

function isDriverOfWeekendCategory(categoryName) {
  return String(categoryName || "").toLowerCase().includes("driver of the weekend");
}

function isTeamOfWeekendCategory(categoryName) {
  return String(categoryName || "").toLowerCase().includes("team of the weekend");
}

function isTeamBattleDriverCategory(categoryName) {
  const normalized = String(categoryName || "").toLowerCase();
  return normalized.includes("team battle") && normalized.includes("driver");
}

function isDriverSelectionCategory(category) {
  const normalized = category.name.toLowerCase();
  if (isTeamBattleMarginCategory(normalized)) return false;
  if (isDriverOfWeekendCategory(normalized)) return false;
  if (category.is_position_based) return true;
  if (/\bp\d+\b/i.test(normalized)) return true;

  return ["driver", "winner", "pole", "fastest lap", "qualification", "result"].some((token) =>
    normalized.includes(token)
  );
}

function isReferencedPositionCategory(category) {
  const normalized = String(category?.name || "").toLowerCase();
  if (!category) return false;
  if (isDriverOfWeekendCategory(normalized)) return false;
  if (isTeamOfWeekendCategory(normalized)) return false;
  if (isTeamBattleDriverCategory(normalized) || isTeamBattleMarginCategory(normalized)) return false;
  return Boolean(category.is_position_based) || /\bp\d+\b/i.test(normalized);
}

function collectReferencedDriverSelections(categories, submittedByCategoryId) {
  const selectedDrivers = new Set();

  (categories || []).forEach((category) => {
    if (!isReferencedPositionCategory(category)) return;

    const rawValue = String(submittedByCategoryId.get(String(category._id || category.id))?.valueText || "").trim();
    if (rawValue) selectedDrivers.add(rawValue.toLowerCase());
  });

  return selectedDrivers;
}

function getConfiguredTeamForCategory(category) {
  return String(category?.metadata?.fixedTeam || "").trim().toLowerCase();
}

function isSprintQualificationCategory(category) {
  return /^sprint qualification p\d+$/i.test(String(category?.name || "").trim());
}

async function saveRaceResultsSet({
  raceId,
  results,
  tieBreakerValue = null,
  replaceAll = false,
  markCompleted = false,
  categoryFilter = () => true,
  emptyCategoryError = "No matching categories found for this race"
}) {
  const { connectMongo } = await import("../mongo.js");
  const RaceDriver = (await import("../models/RaceDriver.js")).default;
  const PickCategory = (await import("../models/PickCategory.js")).default;
  const Result = (await import("../models/Result.js")).default;
  const Race = (await import("../models/Race.js")).default;
  await connectMongo();

  const [driversResRows, categoriesForRaceRows] = await Promise.all([
    RaceDriver.find({ race: raceId }).lean().exec(),
    PickCategory.find({ race: raceId }).lean().exec()
  ]);

  const filteredCategories = categoriesForRaceRows.filter((category) => categoryFilter(category));
  if (filteredCategories.length === 0) {
    throw new Error(emptyCategoryError);
  }

  const validDrivers = new Set(driversResRows.map((row) => row.driver_name.toLowerCase()));
  const validTeams = new Set(
    driversResRows
      .map((row) => String(row.team_name || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const allowedMarginBands = new Set(["1-2", "3-4", "5+"]);
  const categoriesById = new Map(categoriesForRaceRows.map((row) => [String(row._id || row.id), row]));
  const filteredCategoryIds = filteredCategories.map((category) => String(category._id || category.id));
  const filteredCategoryIdSet = new Set(filteredCategoryIds);
  const filteredResults = (Array.isArray(results) ? results : []).filter((item) => filteredCategoryIdSet.has(String(item.categoryId)));

  const submittedByCategoryId = new Map(filteredResults.map((item) => [String(item.categoryId), item]));
  const missingCategory = filteredCategories.find((category) => !submittedByCategoryId.has(String(category._id || category.id)));
  if (missingCategory) {
    throw new Error(`Result for '${missingCategory.name}' is required`);
  }

  const teamCategoryResult = filteredResults.find((item) => {
    const category = categoriesById.get(String(item.categoryId));
    return category ? isTeamOfWeekendCategory(category.name) : false;
  });
  const selectedTeamOfWeekend = String(teamCategoryResult?.valueText || "").trim().toLowerCase();

  if (replaceAll) {
    await Result.deleteMany({ race: raceId }).exec();
  } else {
    await Result.deleteMany({ race: raceId, category: { $in: filteredCategoryIds } }).exec();
  }

  for (const result of filteredResults) {
    const category = categoriesById.get(String(result.categoryId));
    if (!category) throw new Error(`Invalid category for race: ${result.categoryId}`);

    if (isDriverOfWeekendCategory(category.name)) {
      const selectedPosition = Number(result.valueNumber);
      if (!Number.isInteger(selectedPosition) || selectedPosition < 1 || selectedPosition > 20) {
        throw new Error(`Result for '${category.name}' must be a position from 1 to 20`);
      }
    }

    if (isDriverSelectionCategory(category)) {
      const selectedDriver = String(result.valueText || "").trim().toLowerCase();
      if (!selectedDriver || !validDrivers.has(selectedDriver)) {
        throw new Error(`Result for '${category.name}' must be selected from the race driver list`);
      }
    }

    if (isTeamBattleMarginCategory(category.name)) {
      const selectedBand = String(result.valueText || "").trim();
      if (!allowedMarginBands.has(selectedBand)) {
        throw new Error("Team Battle Winning Margin must be one of: 1-2, 3-4, 5+");
      }
    }

    if (isTeamOfWeekendCategory(category.name)) {
      const team = String(result.valueText || "").trim().toLowerCase();
      if (!team || !validTeams.has(team)) {
        throw new Error("Team of the Weekend must match one of the race teams");
      }
    }

    const configuredTeam = getConfiguredTeamForCategory(category);
    const effectiveTeam = configuredTeam || selectedTeamOfWeekend;
    if (isTeamBattleDriverCategory(category.name) && effectiveTeam) {
      const selectedDriver = String(result.valueText || "").trim().toLowerCase();
      const allowedTeamDrivers = new Set(
        driversResRows
          .filter((row) => String(row.team_name || "").trim().toLowerCase() === effectiveTeam)
          .map((row) => (row.driver_name || row.name).toLowerCase())
      );
      if (!allowedTeamDrivers.has(selectedDriver)) {
        throw new Error("Team Battle Winner (Driver) must belong to Team of the Weekend");
      }
    }

    await Result.create({
      race: raceId,
      category: result.categoryId,
      value_text: result.valueText || null,
      value_number: result.valueNumber ?? null
    });
  }

  const raceUpdate = {};
  if (markCompleted) raceUpdate.status = "completed";
  if (markCompleted || tieBreakerValue !== null) raceUpdate.tie_breaker_value = tieBreakerValue || null;
  if (Object.keys(raceUpdate).length > 0) {
    await Race.updateOne({ _id: raceId }, { $set: raceUpdate }).exec();
  }

  const scored = await calculateRaceScores(raceId);
  return {
    scored,
    savedCount: filteredResults.length,
    savedResults: filteredResults
  };
}

async function createRaceWeekend(payload) {
  const {
    name,
    circuitName,
    raceDate,
    deadlineAt,
    leagueId,
    leagueIds,
    applyToAllLeagues,
    predictionOptions,
    positionSlots,
    positionSlotsByOption,
    hasSprintWeekend,
    externalRound,
    drivers,
    pointOverrides,
    fixedTeamOfWeekend
  } = payload;

  const roundValue = externalRound ? Number(externalRound) : null;
  if (externalRound && (!Number.isInteger(roundValue) || roundValue < 1 || roundValue > 30)) {
    throw new Error("externalRound must be an integer from 1 to 30");
  }

  // Attempt MongoDB path first
  try {
    const { connectMongo } = await import("../mongo.js");
    const League = (await import("../models/League.js")).default;
    const Race = (await import("../models/Race.js")).default;
    const PickCategory = (await import("../models/PickCategory.js")).default;
    const RaceDriver = (await import("../models/RaceDriver.js")).default;
    await connectMongo();

    const allLeagues = await League.find().sort({ created_at: 1 }).select('_id').lean().exec();
    const allLeagueIds = allLeagues.map((l) => String(l._id));
    if (allLeagueIds.length === 0) throw new Error('Create at least one league before creating a race');

    let assignedLeagueIds = [];
    if (Array.isArray(leagueIds) && leagueIds.length > 0) {
      const unique = [...new Set(leagueIds.map((id) => String(id).trim()).filter(Boolean))];
      assignedLeagueIds = unique.filter((id) => allLeagueIds.includes(id));
    } else if (applyToAllLeagues !== false) {
      assignedLeagueIds = allLeagueIds;
    } else if (leagueId) {
      assignedLeagueIds = allLeagueIds.includes(String(leagueId)) ? [String(leagueId)] : [];
    }

    if (assignedLeagueIds.length === 0) throw new Error('Select at least one valid league for this race');
    const primaryLeagueId = assignedLeagueIds[0];

    const categories = buildRaceCategories(
      predictionOptions,
      Boolean(hasSprintWeekend),
      positionSlots,
      positionSlotsByOption && typeof positionSlotsByOption === "object" ? positionSlotsByOption : {},
      pointOverrides && typeof pointOverrides === "object" ? pointOverrides : {},
      String(fixedTeamOfWeekend || "").trim()
    );

    const resolvedDeadlineAt = await deriveDeadlineAtFromCategories({
      race: {
        external_round: roundValue,
        race_date: new Date(raceDate),
        manual_deadline_at: new Date(deadlineAt),
        deadline_at: new Date(deadlineAt)
      },
      categories
    });

    const createdRace = await Race.create({
      league: primaryLeagueId,
      leagues: assignedLeagueIds,
      name,
      circuit_name: circuitName,
      external_round: roundValue,
      race_date: new Date(raceDate),
      manual_deadline_at: new Date(deadlineAt),
      deadline_at: new Date(resolvedDeadlineAt || deadlineAt),
      is_visible: categories.length > 0,
      predictions_live: false
    });

    const raceDrivers = normalizeDriverRows(drivers);

    if (categories && categories.length) {
      const docs = categories.map((category) => ({
        race: createdRace._id,
        name: category.name,
        display_order: category.displayOrder,
        is_position_based: Boolean(category.isPositionBased),
        metadata: category.metadata && typeof category.metadata === "object" ? category.metadata : {},
        exact_points: category.exactPoints || 0,
        partial_points: category.partialPoints || 0
      }));
      await PickCategory.insertMany(docs);
    }

    if (assignedLeagueIds && assignedLeagueIds.length) {
      await Race.updateOne({ _id: createdRace._id }, { $addToSet: { leagues: { $each: assignedLeagueIds } } }).exec();
    }

    if (raceDrivers && raceDrivers.length) {
      const driverDocs = raceDrivers.map((d, idx) => ({ race: createdRace._id, driver_name: d.name, team_name: d.teamName || null, metadata: d.metadata || {}, display_order: idx + 1 }));
      await RaceDriver.insertMany(driverDocs);
    }
      return { id: String(createdRace._id), name: createdRace.name, assignedLeagueIds, categoriesCreated: categories.length, driversCreated: raceDrivers.length };
    } catch (err) {
      throw err;
    }
  }

router.post("/bootstrap/promote-admin", bootstrapAdminRateLimit, async (req, res) => {
  const { email, bootstrapKey } = req.body;

  if (!config.bootstrapAdminKey) {
    return res.status(503).json({ error: "Bootstrap key is not configured" });
  }

  if (!email || bootstrapKey !== config.bootstrapAdminKey) {
    return res.status(401).json({ error: "Invalid bootstrap credentials" });
  }

  // promote using MongoDB if available
  try {
    const { connectMongo } = await import("../mongo.js");
    const User = (await import("../models/User.js")).default;
    await connectMongo();
    const updated = await User.findOneAndUpdate({ email }, { role: 'admin' }, { new: true }).lean().exec();
    if (!updated) return res.status(404).json({ error: 'User not found. Register first.' });
    return res.json({ message: 'User promoted to admin', user: { id: String(updated._id), name: updated.name, email: updated.email, role: updated.role } });
  } catch (err) {
    console.error('Promote admin failed', err);
    return res.status(500).json({ error: 'Failed to promote user to admin' });
  }
});

router.use(authRequired, adminRequired);

router.get("/settings/pick-lock-minutes", async (_req, res) => {
  const value = await getPickLockMinutesBeforeDeadline();
  return res.json({ key: "PICK_LOCK_MINUTES_BEFORE_DEADLINE", value });
});

router.put("/settings/pick-lock-minutes", async (req, res) => {
  const normalized = normalizePickLockMinutes(req.body?.value);
  if (normalized === null) {
    return res.status(400).json({ error: "Value must be an integer between 0 and 180" });
  }

  const updated = await setPickLockMinutesBeforeDeadline(normalized);
  return res.json({
    message: "Pick deadline offset updated",
    setting: {
      key: "PICK_LOCK_MINUTES_BEFORE_DEADLINE",
      value: updated.value,
      updatedAt: updated.updatedAt
    }
  });
});

router.get("/settings/media-overrides", async (_req, res) => {
  const overrides = await getMediaOverrides();
  return res.json(overrides);
});

router.put("/settings/media-overrides", async (req, res) => {
  const entityType = normalizeMediaOverrideType(req.body?.entityType);
  const entityId = String(req.body?.entityId || "").trim();
  const imageDataUrl = String(req.body?.imageDataUrl || "").trim();
  const alt = String(req.body?.alt || "").trim();
  const label = String(req.body?.label || "").trim();
  const fileName = String(req.body?.fileName || "").trim();
  const mimeType = String(req.body?.mimeType || "").trim();

  if (!entityType) {
    return res.status(400).json({ error: "Select a valid media type" });
  }
  if (!entityId) {
    return res.status(400).json({ error: "Select an entity to override" });
  }
  if (!isValidMediaDataUrl(imageDataUrl)) {
    return res.status(400).json({ error: "Upload a valid image under 2.5 MB" });
  }

  const overrides = await upsertMediaOverride({
    entityType,
    entityId,
    imageUrl: imageDataUrl,
    alt,
    label,
    fileName,
    mimeType
  });

  return res.json({
    message: "Media override saved",
    overrides
  });
});

router.delete("/settings/media-overrides/:entityType/:entityId", async (req, res) => {
  const entityType = normalizeMediaOverrideType(req.params.entityType);
  const entityId = String(req.params.entityId || "").trim();

  if (!entityType || !entityId) {
    return res.status(400).json({ error: "Valid media override target is required" });
  }

  const overrides = await deleteMediaOverride(entityType, entityId);
  return res.json({
    message: "Media override deleted",
    overrides
  });
});

router.post("/leagues", async (req, res) => {
  const { name, inviteCode } = req.body;
  if (!name) return res.status(400).json({ error: "League name is required" });

  const finalInviteCode = String(inviteCode || generateInviteCode()).trim().toUpperCase();
  if (!finalInviteCode) return res.status(400).json({ error: "Invite code is required" });

  try {
    const { connectMongo } = await import("../mongo.js");
    const League = (await import("../models/League.js")).default;
    const LeagueMember = (await import("../models/LeagueMember.js")).default;
    const mongoose = (await import("mongoose")).default;
    await connectMongo();

    // ensure invite_code uniqueness
    const exists = await League.findOne({ invite_code: finalInviteCode }).lean().exec();
    if (exists) return res.status(409).json({ error: 'Invite code already in use' });

    const created = await League.create({ name, invite_code: finalInviteCode });

    // link current user as member if possible
    let userRef = req.user && req.user.id ? req.user.id : null;
    try {
      if (userRef && String(userRef).match(/^[0-9a-fA-F]{24}$/)) userRef = mongoose.Types.ObjectId(String(userRef));
    } catch (e) {
      // leave as-is if not an ObjectId
    }

    if (userRef) {
      try {
        await LeagueMember.create({ league: created._id, user: userRef });
      } catch (e) {
        // ignore unique constraint errors
      }
    }

    return res.status(201).json({ id: String(created._id), name: created.name, invite_code: created.invite_code, created_at: created.created_at });
  } catch (err) {
    console.error('Create league failed', err);
    return res.status(500).json({ error: 'Failed to create league' });
  }
});

router.get("/leagues", async (_req, res) => {
  try {
    const { connectMongo } = await import("../mongo.js");
    const League = (await import("../models/League.js")).default;
    const LeagueMember = (await import("../models/LeagueMember.js")).default;
    await connectMongo();

    const leagues = await League.find({}).sort({ created_at: -1 }).lean().exec();
    const results = await Promise.all(
      leagues.map(async (l) => {
        const count = await LeagueMember.countDocuments({ league: l._id });
        return { id: String(l._id), name: l.name, invite_code: l.invite_code, created_at: l.created_at, member_count: count };
      })
    );
    return res.json(results);
  } catch (err) {
    console.error('List leagues failed', err);
    return res.status(500).json({ error: 'Failed to list leagues' });
  }
});

router.patch("/leagues/:leagueId", async (req, res) => {
  const { leagueId } = req.params;
  const { name, inviteCode } = req.body || {};

  if (!name && !inviteCode) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  const normalizedName = String(name || "").trim();
  const normalizedInviteCode = String(inviteCode || "").trim().toUpperCase();

  if (name && !normalizedName) {
    return res.status(400).json({ error: "League name is required" });
  }

  if (inviteCode && !normalizedInviteCode) {
    return res.status(400).json({ error: "Invite code is required" });
  }

  try {
    const { connectMongo } = await import("../mongo.js");
    const League = (await import("../models/League.js")).default;
    const LeagueMember = (await import("../models/LeagueMember.js")).default;
    await connectMongo();

    if (normalizedInviteCode) {
      const existing = await League.findOne({ invite_code: normalizedInviteCode, _id: { $ne: leagueId } }).lean().exec();
      if (existing) return res.status(409).json({ error: "Invite code already in use" });
    }

    const updates = {};
    if (normalizedName) updates.name = normalizedName;
    if (normalizedInviteCode) updates.invite_code = normalizedInviteCode;

    const updated = await League.findByIdAndUpdate(leagueId, updates, { new: true }).lean().exec();
    if (!updated) return res.status(404).json({ error: "League not found" });

    const memberCount = await LeagueMember.countDocuments({ league: updated._id });
    return res.json({
      id: String(updated._id),
      name: updated.name,
      invite_code: updated.invite_code,
      created_at: updated.created_at,
      member_count: memberCount
    });
  } catch (err) {
    console.error('Update league failed', err);
    return res.status(500).json({ error: 'Failed to update league' });
  }
});

router.delete("/leagues/:leagueId", async (req, res) => {
  const { leagueId } = req.params;

  try {
    const { connectMongo } = await import("../mongo.js");
    const League = (await import("../models/League.js")).default;
    const LeagueMember = (await import("../models/LeagueMember.js")).default;
    const Race = (await import("../models/Race.js")).default;
    const Pick = (await import("../models/Pick.js")).default;
    const Score = (await import("../models/Score.js")).default;
    const PickCategory = (await import("../models/PickCategory.js")).default;
    const RaceDriver = (await import("../models/RaceDriver.js")).default;
    const Result = (await import("../models/Result.js")).default;
    const Notification = (await import("../models/Notification.js")).default;
    await connectMongo();

    const league = await League.findById(leagueId).lean().exec();
    if (!league) return res.status(404).json({ error: "League not found" });

    const linkedRaces = await Race.find({ leagues: leagueId }).lean().exec();
    const raceIdsToDelete = [];
    const raceUpdates = [];

    linkedRaces.forEach((race) => {
      const remainingLeagueIds = (race.leagues || []).map((id) => String(id)).filter((id) => id !== String(leagueId));
      if (remainingLeagueIds.length === 0) {
        raceIdsToDelete.push(race._id);
        return;
      }

      raceUpdates.push({
        updateOne: {
          filter: { _id: race._id },
          update: {
            $set: {
              league: remainingLeagueIds[0],
              leagues: remainingLeagueIds
            }
          }
        }
      });
    });

    if (raceUpdates.length > 0) {
      await Race.bulkWrite(raceUpdates);
    }

    const removedMembers = await LeagueMember.deleteMany({ league: leagueId }).exec();
    await Pick.deleteMany({ league: leagueId }).exec();
    await Score.deleteMany({ league: leagueId }).exec();

    if (raceIdsToDelete.length > 0) {
      await Promise.all([
        Pick.deleteMany({ race: { $in: raceIdsToDelete } }).exec(),
        Score.deleteMany({ race: { $in: raceIdsToDelete } }).exec(),
        PickCategory.deleteMany({ race: { $in: raceIdsToDelete } }).exec(),
        RaceDriver.deleteMany({ race: { $in: raceIdsToDelete } }).exec(),
        Result.deleteMany({ race: { $in: raceIdsToDelete } }).exec(),
        Notification.deleteMany({ race: { $in: raceIdsToDelete } }).exec(),
        Race.deleteMany({ _id: { $in: raceIdsToDelete } }).exec()
      ]);
    }

    await League.deleteOne({ _id: leagueId }).exec();

    return res.json({
      message: "League deleted",
      league: { id: String(league._id), name: league.name },
      removedMemberCount: removedMembers.deletedCount || 0,
      deletedRaceCount: raceIdsToDelete.length,
      updatedRaceCount: raceUpdates.length
    });
  } catch (err) {
    console.error('Delete league failed', err);
    return res.status(500).json({ error: 'Failed to delete league' });
  }
});

router.get("/leagues/:leagueId/members", async (req, res) => {
  const { leagueId } = req.params;
  try {
    const { connectMongo } = await import("../mongo.js");
    const League = (await import("../models/League.js")).default;
    const LeagueMember = (await import("../models/LeagueMember.js")).default;
    const User = (await import("../models/User.js")).default;
    await connectMongo();

    const league = await League.findById(leagueId).lean().exec();
    if (!league) return res.status(404).json({ error: 'League not found' });

    const members = await LeagueMember.find({ league: league._id }).sort({ joined_at: 1 }).populate({ path: 'user', select: 'name email role' }).lean().exec();
    const mapped = members
      .filter((member) => member.user && member.user.role !== 'admin')
      .map((m) => ({ id: m.user ? String(m.user._id) : null, name: m.user ? m.user.name : null, email: m.user ? m.user.email : null, role: m.user ? m.user.role : null, joined_at: m.joined_at }));

    return res.json({ league: { id: String(league._id), name: league.name, invite_code: league.invite_code }, members: mapped });
  } catch (err) {
    console.error('Get league members failed', err);
    return res.status(500).json({ error: 'Failed to fetch league members' });
  }
});

router.post("/sync/jolpica", async (req, res) => {
  const startedAt = new Date().toISOString();
  try {
    const { leagueId, season } = req.body;

    const chosenSeason = Number(season || new Date().getUTCFullYear());
    if (!Number.isInteger(chosenSeason) || chosenSeason < 1950 || chosenSeason > 2100) {
      return res.status(400).json({ error: "Invalid season" });
    }

    if (leagueId) {
      const { connectMongo } = await import("../mongo.js");
      const League = (await import("../models/League.js")).default;
      await connectMongo();
      const league = await League.findById(leagueId).lean().exec();
      if (!league) return res.status(404).json({ error: 'League not found' });
    }

    await setJolpicaSyncStatus({
      isRunning: true,
      lastMode: "manual-race-sync",
      lastRunStartedAt: startedAt,
      lastErrorMessage: ""
    });

    const summary = await syncSeasonFromJolpica({ leagueId, season: chosenSeason });
    await setJolpicaSyncStatus({
      isRunning: false,
      lastMode: "manual-race-sync",
      lastRunStartedAt: startedAt,
      lastRunFinishedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      summary: { season: chosenSeason, type: "race-sync", ...summary }
    });
    return res.json({ message: "Jolpica sync completed", ...summary });
  } catch (error) {
    console.error("Jolpica sync failed", error);
    await setJolpicaSyncStatus({
      isRunning: false,
      lastMode: "manual-race-sync",
      lastRunStartedAt: startedAt,
      lastRunFinishedAt: new Date().toISOString(),
      lastErrorAt: new Date().toISOString(),
      lastErrorMessage: error.message,
      summary: null
    });
    return res.status(502).json({ error: "Failed to sync with Jolpica API" });
  }
});

router.post("/sync/jolpica/latest-results", async (req, res) => {
  const startedAt = new Date().toISOString();
  try {
    const { leagueId, season } = req.body;
    if (!leagueId) {
      return res.status(400).json({ error: "leagueId is required" });
    }

    const { connectMongo } = await import("../mongo.js");
    const League = (await import("../models/League.js")).default;
    await connectMongo();
    const league = await League.findById(leagueId).lean().exec();
    if (!league) return res.status(404).json({ error: 'League not found' });

    await setJolpicaSyncStatus({
      isRunning: true,
      lastMode: "manual-latest-results",
      lastRunStartedAt: startedAt,
      lastErrorMessage: ""
    });

    const summary = await syncLatestRaceResultsFromJolpica({ leagueId, season });
    await setJolpicaSyncStatus({
      isRunning: false,
      lastMode: "manual-latest-results",
      lastRunStartedAt: startedAt,
      lastRunFinishedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      summary: { season: Number(season || new Date().getUTCFullYear()), type: "latest-results", ...summary }
    });
    return res.json({ message: "Latest race result sync completed", ...summary });
  } catch (error) {
    console.error("Latest result sync failed", error);
    await setJolpicaSyncStatus({
      isRunning: false,
      lastMode: "manual-latest-results",
      lastRunStartedAt: startedAt,
      lastRunFinishedAt: new Date().toISOString(),
      lastErrorAt: new Date().toISOString(),
      lastErrorMessage: error.message,
      summary: null
    });
    return res.status(502).json({ error: "Failed to sync latest results from Jolpica API" });
  }
});

router.post("/sync/jolpica/completed-results", async (req, res) => {
  const startedAt = new Date().toISOString();
  try {
    const chosenSeason = Number(req.body?.season || new Date().getUTCFullYear());
    if (!Number.isInteger(chosenSeason) || chosenSeason < 1950 || chosenSeason > 2100) {
      return res.status(400).json({ error: "Invalid season" });
    }

    await setJolpicaSyncStatus({
      isRunning: true,
      lastMode: "manual-weekend-results",
      lastRunStartedAt: startedAt,
      lastErrorMessage: ""
    });

    const summary = await syncCompletedRaceResultsFromJolpica({ season: chosenSeason });
    await setJolpicaSyncStatus({
      isRunning: false,
      lastMode: "manual-weekend-results",
      lastRunStartedAt: startedAt,
      lastRunFinishedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      summary: { season: chosenSeason, type: "weekend-results", ...summary }
    });
    return res.json({ message: "Race weekend result sync finished", ...summary });
  } catch (error) {
    console.error("Weekend result sync failed", error);
    await setJolpicaSyncStatus({
      isRunning: false,
      lastMode: "manual-weekend-results",
      lastRunStartedAt: startedAt,
      lastRunFinishedAt: new Date().toISOString(),
      lastErrorAt: new Date().toISOString(),
      lastErrorMessage: error.message,
      summary: null
    });
    return res.status(502).json({ error: "Failed to sync race weekend results from Jolpica API" });
  }
});

router.get("/sync/jolpica/status", async (_req, res) => {
  const persisted = await getJolpicaSyncStatus();
  const runtime = getJolpicaAutoSyncRuntimeStatus();
  return res.json({
    runtime,
    persisted
  });
});

router.post("/races", async (req, res) => {
  try {
    const created = await createRaceWeekend(req.body || {});
    return res.status(201).json(created);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Failed to create race" });
  }
});

router.patch("/races/:raceId", async (req, res) => {
  const { raceId } = req.params;
  const {
    name,
    circuitName,
    raceDate,
    deadlineAt,
    leagueId,
    leagueIds,
    applyToAllLeagues,
    externalRound
  } = req.body || {};

  if (!name || !circuitName || !raceDate || !deadlineAt) {
    return res.status(400).json({ error: "name, circuitName, raceDate and deadlineAt are required" });
  }

  const roundValue = externalRound ? Number(externalRound) : null;
  if (externalRound && (!Number.isInteger(roundValue) || roundValue < 1 || roundValue > 30)) {
    return res.status(400).json({ error: "externalRound must be an integer from 1 to 30" });
  }

  try {
    const { connectMongo } = await import("../mongo.js");
    const League = (await import("../models/League.js")).default;
    const Race = (await import("../models/Race.js")).default;
    const PickCategory = (await import("../models/PickCategory.js")).default;
    await connectMongo();

    const allLeagues = await League.find().sort({ created_at: 1 }).select("_id").lean().exec();
    const allLeagueIds = allLeagues.map((league) => String(league._id));
    if (allLeagueIds.length === 0) {
      return res.status(400).json({ error: "Create at least one league before updating a race" });
    }

    let assignedLeagueIds = [];
    if (Array.isArray(leagueIds) && leagueIds.length > 0) {
      const unique = [...new Set(leagueIds.map((id) => String(id).trim()).filter(Boolean))];
      assignedLeagueIds = unique.filter((id) => allLeagueIds.includes(id));
    } else if (applyToAllLeagues !== false) {
      assignedLeagueIds = allLeagueIds;
    } else if (leagueId) {
      assignedLeagueIds = allLeagueIds.includes(String(leagueId)) ? [String(leagueId)] : [];
    }

    if (assignedLeagueIds.length === 0) {
      return res.status(400).json({ error: "Select at least one valid league for this race" });
    }

    const existingCategories = await PickCategory.find({ race: raceId }).lean().exec();
    const resolvedDeadlineAt = await deriveDeadlineAtFromCategories({
      race: {
        external_round: roundValue,
        race_date: new Date(raceDate),
        manual_deadline_at: new Date(deadlineAt),
        deadline_at: new Date(deadlineAt)
      },
      categories: existingCategories
    });

    const updated = await Race.findByIdAndUpdate(
      raceId,
      {
        league: assignedLeagueIds[0],
        leagues: assignedLeagueIds,
        name: String(name).trim(),
        circuit_name: String(circuitName).trim(),
        external_round: roundValue,
        race_date: new Date(raceDate),
        manual_deadline_at: new Date(deadlineAt),
        deadline_at: new Date(resolvedDeadlineAt || deadlineAt)
      },
      { new: true }
    ).lean().exec();

    if (!updated) return res.status(404).json({ error: "Race not found" });

    return res.json({
      id: String(updated._id),
      league_id: updated.league || null,
      leagues: (updated.leagues || []).map((id) => String(id)),
      name: updated.name,
      circuit_name: updated.circuit_name,
      external_round: updated.external_round || null,
      race_date: updated.race_date,
      deadline_at: updated.deadline_at,
      status: updated.status || null,
      is_visible: Boolean(updated.is_visible),
      predictions_live: updated.predictions_live !== false
    });
  } catch (err) {
    console.error("Update race failed", err);
    return res.status(500).json({ error: "Failed to update race" });
  }
});

router.put("/races/:raceId/drivers", async (req, res) => {
  const { raceId } = req.params;
  const { drivers } = req.body;

  if (!Array.isArray(drivers) || drivers.length === 0) {
    return res.status(400).json({ error: "Drivers must be a non-empty array" });
  }

  const cleanDrivers = normalizeDriverRows(drivers);
  if (cleanDrivers.length === 0) {
    return res.status(400).json({ error: "No valid drivers found in payload" });
  }

  try {
    const { connectMongo } = await import("../mongo.js");
    const RaceDriver = (await import("../models/RaceDriver.js")).default;
    await connectMongo();

    await RaceDriver.deleteMany({ race: raceId }).exec();
    const docs = cleanDrivers.map((d, idx) => ({ race: raceId, driver_name: d.name, team_name: d.teamName || null, metadata: d.metadata || {}, display_order: idx + 1 }));
    if (docs.length) await RaceDriver.insertMany(docs);
    return res.json({ message: "Race drivers updated", count: cleanDrivers.length });
  } catch (err) {
    console.error('Update race drivers failed', err);
    return res.status(500).json({ error: 'Failed to update race drivers' });
  }
});

router.post("/bulk/races", async (req, res) => {
  const { races } = req.body;
  if (!Array.isArray(races) || races.length === 0) {
    return res.status(400).json({ error: "races must be a non-empty array" });
  }

  let created = 0;
  const failures = [];
  for (const race of races) {
    try {
      await createRaceWeekend({
        ...race,
        predictionOptions: Array.isArray(race.predictionOptions) ? race.predictionOptions : [],
        positionSlots: Array.isArray(race.positionSlots) ? race.positionSlots : [],
        hasSprintWeekend: Boolean(race.hasSprintWeekend),
        drivers: Array.isArray(race.drivers) ? race.drivers : []
      });
      created += 1;
    } catch (error) {
      failures.push({
        name: race?.name || "Unnamed race",
        error: error.message
      });
    }
  }

  return res.json({ created, failed: failures.length, failures });
});

router.get("/bulk/predictions/export", async (req, res) => {
  const year = Number(req.query.year || new Date().getUTCFullYear());
  const includeEmptyRaces = parseIncludeEmptyRaces(req.query.includeEmptyRaces, true);
  if (!Number.isInteger(year) || year < 1950 || year > 2100) {
    return res.status(400).json({ error: "year must be a valid season year" });
  }

  try {
    const races = (await loadPredictionBulkRows(year)).filter((race) => {
      if (includeEmptyRaces) return true;
      return Array.isArray(race.categories) && race.categories.length > 0;
    });
    return res.json({
      version: 1,
      type: "race-prediction-config",
      year,
      exportedAt: new Date().toISOString(),
      includeEmptyRaces,
      races
    });
  } catch (err) {
    console.error("Export prediction bulk config failed", err);
    return res.status(500).json({ error: "Failed to export prediction config" });
  }
});

router.post("/bulk/predictions/preview", async (req, res) => {
  const payload = req.body || {};
  const year = Number(payload.year || payload?.seasonYear || new Date().getUTCFullYear());
  if (!Number.isInteger(year) || year < 1950 || year > 2100) {
    return res.status(400).json({ error: "year must be a valid season year" });
  }

  if (!Array.isArray(payload.races)) {
    return res.status(400).json({ error: "races must be an array" });
  }

  try {
    const rows = await loadPredictionBulkRows(year, payload.races);
    return res.json({
      version: 1,
      year,
      applyModeDefault: "future-only",
      summary: summarizePredictionBulkPreview(rows),
      races: rows
    });
  } catch (err) {
    console.error("Preview prediction bulk config failed", err);
    return res.status(500).json({ error: "Failed to preview prediction config changes" });
  }
});

router.post("/bulk/predictions/apply", async (req, res) => {
  const payload = req.body || {};
  const year = Number(payload.year || payload?.seasonYear || new Date().getUTCFullYear());
  const includePastRaces = Boolean(payload.includePastRaces);
  if (!Number.isInteger(year) || year < 1950 || year > 2100) {
    return res.status(400).json({ error: "year must be a valid season year" });
  }

  if (!Array.isArray(payload.races)) {
    return res.status(400).json({ error: "races must be an array" });
  }

  try {
    const previewRows = await loadPredictionBulkRows(year, payload.races);
    const targets = previewRows.filter((row) => {
      if (row.missingRace) return false;
      if (!row.changes.length) return false;
      if (!includePastRaces && row.hasOccurred) return false;
      return true;
    });

    const failures = [];
    let updated = 0;
    let rescored = 0;

    for (const row of targets) {
      try {
        const result = await upsertRaceCategories({ raceId: row.raceId, categories: row.incomingCategories });
        updated += 1;
        if (result.rescored) rescored += 1;
      } catch (error) {
        failures.push({ raceId: row.raceId, raceName: row.raceName, error: error.message });
      }
    }

    return res.json({
      message: "Prediction bulk import applied",
      year,
      applyMode: includePastRaces ? "all" : "future-only",
      updated,
      rescored,
      skippedPastRaces: previewRows.filter((row) => row.hasOccurred && row.changes.length > 0 && !includePastRaces).length,
      failed: failures.length,
      failures,
      summary: summarizePredictionBulkPreview(previewRows)
    });
  } catch (err) {
    console.error("Apply prediction bulk config failed", err);
    return res.status(500).json({ error: "Failed to apply prediction config changes" });
  }
});

router.post("/bulk/race-drivers", async (req, res) => {
  const { uploads } = req.body;
  if (!Array.isArray(uploads) || uploads.length === 0) {
    return res.status(400).json({ error: "uploads must be a non-empty array" });
  }

  let updated = 0;
  const failures = [];
  for (const item of uploads) {
    try {
      if (!item?.raceId) throw new Error("raceId is required");
      const cleanDrivers = normalizeDriverRows(item.drivers);
      if (cleanDrivers.length === 0) throw new Error("drivers must include at least one valid driver");

      try {
        const { connectMongo } = await import("../mongo.js");
        const RaceDriver = (await import("../models/RaceDriver.js")).default;
        await connectMongo();
        await RaceDriver.deleteMany({ race: item.raceId }).exec();
        const docs = cleanDrivers.map((d, idx) => ({ race: item.raceId, driver_name: d.name, team_name: d.teamName || null, metadata: d.metadata || {}, display_order: idx + 1 }));
        if (docs.length) await RaceDriver.insertMany(docs);
      } catch (err) {
        throw err;
      }

      updated += 1;
    } catch (error) {
      failures.push({ raceId: item?.raceId || null, error: error.message });
    }
  }

  return res.json({ updated, failed: failures.length, failures });
});

router.post("/bulk/results", async (req, res) => {
  const { uploads } = req.body;
  if (!Array.isArray(uploads) || uploads.length === 0) {
    return res.status(400).json({ error: "uploads must be a non-empty array" });
  }

  let updated = 0;
  const failures = [];
  for (const item of uploads) {
    try {
      if (!item?.raceId) throw new Error("raceId is required");
      if (!Array.isArray(item.results) || item.results.length === 0) {
        throw new Error("results must be a non-empty array");
      }

      try {
        const { connectMongo } = await import("../mongo.js");
        const PickCategory = (await import("../models/PickCategory.js")).default;
        const Result = (await import("../models/Result.js")).default;
        const Race = (await import("../models/Race.js")).default;
        await connectMongo();

        const categories = await PickCategory.find({ race: item.raceId }).lean().exec();
        const categoryIdByName = new Map(categories.map((row) => [row.name.toLowerCase(), String(row._id)]));

        await Result.deleteMany({ race: item.raceId }).exec();

        for (const result of item.results) {
          const categoryName = String(result.categoryName || "").trim().toLowerCase();
          const categoryId = categoryIdByName.get(categoryName);
          if (!categoryId) throw new Error(`Unknown categoryName '${result.categoryName}' for race ${item.raceId}`);

          await Result.create({ race: item.raceId, category: categoryId, value_text: result.valueText || null, value_number: result.valueNumber ?? null });
        }

        await Race.updateOne({ _id: item.raceId }, { $set: { status: 'completed', tie_breaker_value: item.tieBreakerValue || null } }).exec();
        await calculateRaceScores(item.raceId);
      } catch (err) {
        throw err;
      }
      updated += 1;
    } catch (error) {
      failures.push({ raceId: item?.raceId || null, error: error.message });
    }
  }

  return res.json({ updated, failed: failures.length, failures });
});

router.patch("/races/:raceId/visibility", async (req, res) => {
  const { raceId } = req.params;
  const { isVisible } = req.body;

  if (typeof isVisible !== "boolean") {
    return res.status(400).json({ error: "isVisible must be a boolean" });
  }

  try {
    const { connectMongo } = await import("../mongo.js");
    const Race = (await import("../models/Race.js")).default;
    await connectMongo();
    const updated = await Race.findByIdAndUpdate(raceId, { is_visible: isVisible }, { new: true }).lean().exec();
    if (!updated) return res.status(404).json({ error: 'Race not found' });
    return res.json({ message: 'Race visibility updated', race: { id: String(updated._id), name: updated.name, is_visible: updated.is_visible } });
  } catch (err) {
    console.error('Update race visibility failed', err);
    return res.status(500).json({ error: 'Failed to update race visibility' });
  }
});

router.patch("/races/:raceId/predictions-live", async (req, res) => {
  const { raceId } = req.params;
  const { predictionsLive } = req.body;

  if (typeof predictionsLive !== "boolean") {
    return res.status(400).json({ error: "predictionsLive must be a boolean" });
  }

  try {
    const { connectMongo } = await import("../mongo.js");
    const Race = (await import("../models/Race.js")).default;
    await connectMongo();
    const updated = await Race.findByIdAndUpdate(
      raceId,
      { predictions_live: predictionsLive },
      { new: true }
    ).lean().exec();
    if (!updated) return res.status(404).json({ error: 'Race not found' });
    return res.json({
      message: 'Race prediction availability updated',
      race: {
        id: String(updated._id),
        name: updated.name,
        predictions_live: updated.predictions_live !== false
      }
    });
  } catch (err) {
    console.error('Update race prediction availability failed', err);
    return res.status(500).json({ error: 'Failed to update race prediction availability' });
  }
});

router.post("/races/:raceId/categories", async (req, res) => {
  const { raceId } = req.params;
  const { categories } = req.body;

  try {
    const result = await upsertRaceCategories({ raceId, categories });
    return res.json(result);
  } catch (err) {
    console.error("Update categories failed", err);
    return res.status(400).json({ error: err.message || "Failed to update categories" });
  }
});

router.post("/races/:raceId/results", async (req, res) => {
  const { raceId } = req.params;
  const { results, tieBreakerValue } = req.body;
  try {
    const saved = await saveRaceResultsSet({
      raceId,
      results,
      tieBreakerValue,
      replaceAll: true,
      markCompleted: true
    });
    return res.json({ message: "Results saved and scores calculated", scored: saved.scored, savedCount: saved.savedCount });
  } catch (err) {
    console.error('Save race results failed', err);
    return res.status(400).json({ error: err.message || 'Failed to save race results' });
  }
});

router.post("/races/:raceId/results/sprint-qualifying", async (req, res) => {
  const { raceId } = req.params;
  const { results } = req.body || {};

  try {
    const saved = await saveRaceResultsSet({
      raceId,
      results,
      replaceAll: false,
      markCompleted: false,
      categoryFilter: isSprintQualificationCategory,
      emptyCategoryError: "No Sprint Qualification categories are configured for this race"
    });

    return res.json({
      message: "Sprint qualifying results saved and scores recalculated",
      scored: saved.scored,
      savedCount: saved.savedCount
    });
  } catch (err) {
    console.error("Save sprint qualifying results failed", err);
    return res.status(400).json({ error: err.message || "Failed to save sprint qualifying results" });
  }
});

router.post("/races/:raceId/results/sprint-qualifying/import", async (req, res) => {
  const { raceId } = req.params;

  try {
    const summary = await syncSprintQualifyingResultsForRace({ raceId });
    if (!summary.updated) {
      return res.status(409).json({
        error: summary.reason || "No sprint qualifying data could be imported",
        sources: summary.sources || null
      });
    }

    return res.json({
      message: "Sprint qualifying results imported and scores recalculated",
      summary
    });
  } catch (err) {
    console.error("Import sprint qualifying results failed", err);
    return res.status(500).json({ error: "Failed to import sprint qualifying results" });
  }
});

router.get("/users", async (_req, res) => {
  try {
    const { connectMongo } = await import("../mongo.js");
    const User = (await import("../models/User.js")).default;
    await connectMongo();
    const users = await User.find({}, { password_hash: 0 }).sort({ created_at: -1 }).lean().exec();
    return res.json(users.map((u) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, created_at: u.created_at })));
  } catch (err) {
    console.error('List users failed', err);
    return res.status(500).json({ error: 'Failed to list users' });
  }
});

router.patch("/users/:userId", async (req, res) => {
  const { userId } = req.params;
  const { name, email } = req.body || {};

  if (!name && !email) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  if (email && !String(email).includes("@")) {
    return res.status(400).json({ error: "Invalid email" });
  }

  try {
    const { connectMongo } = await import("../mongo.js");
    const User = (await import("../models/User.js")).default;
    await connectMongo();

    if (email) {
      const existing = await User.findOne({ email, _id: { $ne: userId } }).lean().exec();
      if (existing) return res.status(409).json({ error: 'Email already in use' });
    }

    const updates = {};
    if (name) updates.name = name;
    if (email) updates.email = email;

    const updated = await User.findByIdAndUpdate(userId, updates, { new: true }).lean().exec();
    if (!updated) return res.status(404).json({ error: 'User not found' });
    return res.json({ id: String(updated._id), name: updated.name, email: updated.email, role: updated.role, created_at: updated.created_at });
  } catch (err) {
    console.error('Update user failed', err);
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

router.patch("/users/:userId/role", async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body;
  if (!["player", "admin"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }
  try {
    const { connectMongo } = await import("../mongo.js");
    const User = (await import("../models/User.js")).default;
    await connectMongo();
    const updated = await User.findByIdAndUpdate(userId, { role }, { new: true }).lean().exec();
    if (!updated) return res.status(404).json({ error: 'User not found' });
    return res.json({ id: String(updated._id), name: updated.name, email: updated.email, role: updated.role });
  } catch (err) {
    console.error('Update user role failed', err);
    return res.status(500).json({ error: 'Failed to update user role' });
  }
});

router.post("/races/:raceId/score", async (req, res) => {
  const scored = await calculateRaceScores(req.params.raceId);
  return res.json({ message: "Scores recalculated", scored });
});

export default router;
