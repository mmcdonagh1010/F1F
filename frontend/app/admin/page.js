"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "../../components/Header";
import BottomNav from "../../components/BottomNav";
import { apiFetch } from "../../lib/api";
import { getStoredUser } from "../../lib/auth";
import { getRaceVisualKey } from "../../lib/f1Media";
import { invalidateF1MediaOverridesCache } from "../../lib/f1MediaOverrides";

const PREDICTION_OPTIONS = [
  { key: "raceQualificationPositions", label: "Race Qualification Positions", sprintOnly: false, defaultExactPoints: 5, defaultPartialPoints: 1 },
  { key: "sprintQualificationPositions", label: "Sprint Qualification Positions", sprintOnly: true, defaultExactPoints: 5, defaultPartialPoints: 1 },
  { key: "sprintResult", label: "Sprint Result Winner", sprintOnly: true, defaultExactPoints: 10, defaultPartialPoints: 5 },
  { key: "racePositions", label: "Race Positions (custom slots)", sprintOnly: false, defaultExactPoints: 5, defaultPartialPoints: 1 },
  { key: "sprintPositions", label: "Sprint Positions (custom slots)", sprintOnly: true, defaultExactPoints: 5, defaultPartialPoints: 1 },
  { key: "driverOfWeekend", label: "Driver of the Weekend", sprintOnly: false, defaultExactPoints: 10, defaultPartialPoints: 0 },
  { key: "teamOfWeekend", label: "Team of the Weekend", sprintOnly: false, defaultExactPoints: 10, defaultPartialPoints: 0 },
  { key: "fastestLapDriver", label: "Fastest Lap Driver", sprintOnly: false, defaultExactPoints: 8, defaultPartialPoints: 0 }
];

const ADMIN_TABS = [
  { key: "leagues", label: "Leagues" },
  { key: "predictionOptions", label: "Prediction Options" },
  { key: "createRace", label: "Create Race" },
  { key: "drivers", label: "Drivers" },
  { key: "media", label: "Media" },
  { key: "sync", label: "API Sync" },
  { key: "results", label: "Results" },
  { key: "settings", label: "Settings" },
  { key: "users", label: "Users" }
];

const EMPTY_MEDIA_OVERRIDES = {
  drivers: {},
  teams: {},
  races: {}
};

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

const OPTION_CATEGORY_NAMES = {
  sprintResult: "Sprint Result Winner",
  driverOfWeekend: "Driver of the Weekend",
  teamOfWeekend: "Team of the Weekend",
  fastestLapDriver: "Fastest Lap Driver"
};

const DEFAULT_POSITION_SLOTS_INPUT = "1,2,3";
const EMPTY_PREDICTION_PREVIEW = {
  driverOfWeekend: "",
  teamOfWeekend: ""
};
const PREDICTION_CONFIG_CSV_HEADERS = [
  "raceId",
  "raceName",
  "circuitName",
  "externalRound",
  "raceDate",
  "deadlineAt",
  "status",
  "isVisible",
  "predictionsLive",
  "hasSprintWeekend",
  "hasConfiguredCategories",
  "categoryCount",
  "categoryName",
  "displayOrder",
  "isPositionBased",
  "exactPoints",
  "partialPoints",
  "metadataJson"
];
const PREDICTION_IMPORT_REQUIRED_JSON_HINT = 'Required JSON shape: { "year": 2026, "races": [{ "raceId": "...", "name": "Australian Grand Prix", "raceDate": "2026-03-08T04:00:00.000Z", "deadlineAt": "2026-03-08T03:00:00.000Z", "categories": [{ "name": "Race Result P1", "displayOrder": 1, "isPositionBased": true, "exactPoints": 5, "partialPoints": 1, "metadata": {} }] }] }';
const PREDICTION_IMPORT_REQUIRED_CSV_HINT = `Required CSV columns: ${PREDICTION_CONFIG_CSV_HEADERS.join(", ")}. Use the exported prediction CSV template and keep one row per category, or one blank category row when a race has no configured categories.`;
const USER_IMPORT_CSV_HEADERS = ["id", "name", "email", "role", "emailVerified", "createdAt", "password"];
const USER_IMPORT_REQUIRED_JSON_HINT = 'Required JSON shape: { "users": [{ "id": "optional-existing-user-id", "name": "Driver Fan", "email": "fan@example.com", "role": "player", "emailVerified": true, "password": "optional-new-password" }] }';
const USER_IMPORT_REQUIRED_CSV_HINT = `Required CSV columns: ${USER_IMPORT_CSV_HEADERS.join(", ")}. Leave password blank to preserve an existing user's password, but provide it when importing a new user.`;
const USER_PREDICTION_CSV_HEADERS = [
  "userId",
  "userEmail",
  "userName",
  "leagueId",
  "leagueName",
  "raceId",
  "raceName",
  "raceDate",
  "deadlineAt",
  "pickStatus",
  "submittedAt",
  "categoryName",
  "pickValueText",
  "pickValueNumber"
];
const USER_PREDICTION_IMPORT_REQUIRED_JSON_HINT = 'Required JSON shape: { "userId": "...", "year": 2026, "races": [{ "raceId": "...", "leagueId": "...", "pickStatus": "submitted", "submittedAt": "2026-03-01T10:00:00.000Z", "picks": [{ "categoryName": "Race Result P1", "valueText": "Max Verstappen", "valueNumber": null }] }] }';
const USER_PREDICTION_IMPORT_REQUIRED_CSV_HINT = `Required CSV columns: ${USER_PREDICTION_CSV_HEADERS.join(", ")}. Keep one row per pick, and repeat the race and league columns for each row.`;

function buildDefaultOptionPoints() {
  return Object.fromEntries(
    PREDICTION_OPTIONS.map((option) => [
      option.key,
      {
        exactPoints: option.defaultExactPoints,
        partialPoints: option.defaultPartialPoints
      }
    ])
  );
}

function parseCsvLikeList(text) {
  return text
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  values.push(current.trim());
  return values;
}

function parseCsvObjects(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = cols[idx] ?? "";
    });
    return row;
  });
}

function parseCsvObjectsWithLineNumbers(text) {
  const rawLines = String(text || "").split(/\r?\n/);
  const nonEmptyLines = rawLines
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0);

  if (nonEmptyLines.length < 2) {
    return { headers: [], rows: [] };
  }

  const headerLine = nonEmptyLines[0];
  const headers = parseCsvLine(headerLine.line.replace(/^\uFEFF/, "").trim()).map((header) => header.trim());
  const rows = nonEmptyLines.slice(1).map(({ line, lineNumber }) => {
    const values = parseCsvLine(line.trim());
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] ?? "";
    });
    return { lineNumber, row };
  });

  return { headers, rows };
}

function buildPredictionImportError(message, hint) {
  return new Error(hint ? `${message} ${hint}` : message);
}

function buildUserImportError(message, hint = USER_IMPORT_REQUIRED_CSV_HINT) {
  return new Error(hint ? `${message} ${hint}` : message);
}

function parseStrictBoolean(value, fieldName, location, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw buildPredictionImportError(`${location}: '${fieldName}' must be true or false.`, PREDICTION_IMPORT_REQUIRED_CSV_HINT);
}

function parseStrictInteger(value, fieldName, location, { allowBlank = false, minimum = 0 } = {}) {
  if (value === undefined || value === null || value === "") {
    if (allowBlank) return null;
    throw buildPredictionImportError(`${location}: '${fieldName}' is required.`, PREDICTION_IMPORT_REQUIRED_CSV_HINT);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw buildPredictionImportError(`${location}: '${fieldName}' must be an integer${minimum > 0 ? ` >= ${minimum}` : ""}.`, PREDICTION_IMPORT_REQUIRED_CSV_HINT);
  }
  return parsed;
}

function parseStrictDate(value, fieldName, location) {
  if (!value) {
    throw buildPredictionImportError(`${location}: '${fieldName}' is required.`, PREDICTION_IMPORT_REQUIRED_CSV_HINT);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw buildPredictionImportError(`${location}: '${fieldName}' must be a valid ISO date/time value.`, PREDICTION_IMPORT_REQUIRED_CSV_HINT);
  }

  return parsed.toISOString();
}

function parsePredictionCsvPayload(text, fallbackYear) {
  const { headers, rows } = parseCsvObjectsWithLineNumbers(text);
  if (headers.length === 0 || rows.length === 0) {
    throw buildPredictionImportError("Prediction CSV import must include a header row and at least one data row.", PREDICTION_IMPORT_REQUIRED_CSV_HINT);
  }

  const missingHeaders = PREDICTION_CONFIG_CSV_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw buildPredictionImportError(`Prediction CSV import is missing required columns: ${missingHeaders.join(", ")}.`, PREDICTION_IMPORT_REQUIRED_CSV_HINT);
  }

  const races = [];
  const raceMap = new Map();
  const years = new Set();

  rows.forEach(({ lineNumber, row }) => {
    const location = `CSV row ${lineNumber}`;
    const raceId = String(row.raceId || "").trim();
    const raceName = String(row.raceName || "").trim();
    if (!raceId) {
      throw buildPredictionImportError(`${location}: 'raceId' is required.`, PREDICTION_IMPORT_REQUIRED_CSV_HINT);
    }
    if (!raceName) {
      throw buildPredictionImportError(`${location}: 'raceName' is required.`, PREDICTION_IMPORT_REQUIRED_CSV_HINT);
    }

    const raceDate = parseStrictDate(row.raceDate, "raceDate", location);
    const deadlineAt = parseStrictDate(row.deadlineAt, "deadlineAt", location);
    years.add(new Date(raceDate).getUTCFullYear());

    let race = raceMap.get(raceId);
    if (!race) {
      race = {
        raceId,
        name: raceName,
        circuitName: String(row.circuitName || "").trim() || null,
        externalRound: row.externalRound === "" ? null : parseStrictInteger(row.externalRound, "externalRound", location, { allowBlank: true, minimum: 1 }),
        raceDate,
        deadlineAt,
        status: String(row.status || "").trim() || null,
        isVisible: parseStrictBoolean(row.isVisible, "isVisible", location, true),
        predictionsLive: parseStrictBoolean(row.predictionsLive, "predictionsLive", location, true),
        hasSprintWeekend: parseStrictBoolean(row.hasSprintWeekend, "hasSprintWeekend", location, false),
        categories: []
      };
      raceMap.set(raceId, race);
      races.push(race);
    } else {
      const conflictingField = [
        ["raceName", race.name, raceName],
        ["raceDate", race.raceDate, raceDate],
        ["deadlineAt", race.deadlineAt, deadlineAt]
      ].find(([, existingValue, nextValue]) => existingValue !== nextValue);

      if (conflictingField) {
        throw buildPredictionImportError(`${location}: '${conflictingField[0]}' does not match earlier rows for race '${raceId}'.`, PREDICTION_IMPORT_REQUIRED_CSV_HINT);
      }
    }

    const hasCategoryName = String(row.categoryName || "").trim().length > 0;
    const hasCategoryFields = [row.displayOrder, row.isPositionBased, row.exactPoints, row.partialPoints, row.metadataJson]
      .some((value) => value !== undefined && value !== null && String(value).trim() !== "");
    const hasConfiguredCategories = parseStrictBoolean(row.hasConfiguredCategories, "hasConfiguredCategories", location, hasCategoryName);

    if (!hasCategoryName) {
      if (hasCategoryFields) {
        throw buildPredictionImportError(`${location}: category fields are populated but 'categoryName' is blank.`, PREDICTION_IMPORT_REQUIRED_CSV_HINT);
      }
      if (hasConfiguredCategories) {
        throw buildPredictionImportError(`${location}: 'hasConfiguredCategories' is true but no category row was provided.`, PREDICTION_IMPORT_REQUIRED_CSV_HINT);
      }
      return;
    }

    let metadata = {};
    const metadataText = String(row.metadataJson || "").trim();
    if (metadataText) {
      try {
        metadata = JSON.parse(metadataText);
      } catch {
        throw buildPredictionImportError(`${location}: 'metadataJson' must contain valid JSON.`, PREDICTION_IMPORT_REQUIRED_CSV_HINT);
      }

      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw buildPredictionImportError(`${location}: 'metadataJson' must be a JSON object.`, PREDICTION_IMPORT_REQUIRED_CSV_HINT);
      }
    }

    race.categories.push({
      name: String(row.categoryName).trim(),
      displayOrder: parseStrictInteger(row.displayOrder, "displayOrder", location, { minimum: 0 }),
      isPositionBased: parseStrictBoolean(row.isPositionBased, "isPositionBased", location, false),
      exactPoints: parseStrictInteger(row.exactPoints, "exactPoints", location, { minimum: 0 }),
      partialPoints: parseStrictInteger(row.partialPoints, "partialPoints", location, { minimum: 0 }),
      metadata
    });
  });

  if (races.length === 0) {
    throw buildPredictionImportError("Prediction CSV import did not contain any valid race rows.", PREDICTION_IMPORT_REQUIRED_CSV_HINT);
  }

  if (years.size > 1) {
    throw buildPredictionImportError(`Prediction CSV import spans multiple season years (${Array.from(years).sort().join(", ")}). Export and import one season year at a time.`, PREDICTION_IMPORT_REQUIRED_CSV_HINT);
  }

  const year = years.size === 1 ? Array.from(years)[0] : Number(fallbackYear);
  if (!Number.isInteger(year)) {
    throw buildPredictionImportError("Prediction CSV import could not determine the season year.", PREDICTION_IMPORT_REQUIRED_CSV_HINT);
  }

  return { year, races };
}

function normalizePredictionJsonPayload(parsed, fallbackYear) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw buildPredictionImportError("Prediction import JSON must be an object.", PREDICTION_IMPORT_REQUIRED_JSON_HINT);
  }

  const year = Number(parsed?.year || fallbackYear);
  if (!Number.isInteger(year) || year < 1950 || year > 2100) {
    throw buildPredictionImportError("Prediction import JSON must include a valid season year.", PREDICTION_IMPORT_REQUIRED_JSON_HINT);
  }

  if (!Array.isArray(parsed.races) || parsed.races.length === 0) {
    throw buildPredictionImportError("Prediction import JSON must include a non-empty 'races' array.", PREDICTION_IMPORT_REQUIRED_JSON_HINT);
  }

  return {
    year,
    races: parsed.races.map((race, raceIndex) => {
      const location = `JSON races[${raceIndex}]`;
      const raceId = String(race?.raceId || "").trim();
      const name = String(race?.name || race?.raceName || "").trim();
      if (!raceId) {
        throw buildPredictionImportError(`${location}: 'raceId' is required.`, PREDICTION_IMPORT_REQUIRED_JSON_HINT);
      }
      if (!name) {
        throw buildPredictionImportError(`${location}: 'name' is required.`, PREDICTION_IMPORT_REQUIRED_JSON_HINT);
      }

      if (!Array.isArray(race?.categories)) {
        throw buildPredictionImportError(`${location}: 'categories' must be an array.`, PREDICTION_IMPORT_REQUIRED_JSON_HINT);
      }

      return {
        raceId,
        name,
        circuitName: race?.circuitName || null,
        externalRound: race?.externalRound ?? null,
        raceDate: race?.raceDate || null,
        deadlineAt: race?.deadlineAt || null,
        status: race?.status || null,
        isVisible: typeof race?.isVisible === "boolean" ? race.isVisible : true,
        predictionsLive: typeof race?.predictionsLive === "boolean" ? race.predictionsLive : true,
        hasSprintWeekend: Boolean(race?.hasSprintWeekend),
        categories: race.categories.map((category, categoryIndex) => {
          const categoryLocation = `${location}.categories[${categoryIndex}]`;
          const categoryName = String(category?.name || "").trim();
          if (!categoryName) {
            throw buildPredictionImportError(`${categoryLocation}: 'name' is required.`, PREDICTION_IMPORT_REQUIRED_JSON_HINT);
          }

          const displayOrder = Number(category?.displayOrder);
          const exactPoints = Number(category?.exactPoints);
          const partialPoints = Number(category?.partialPoints);
          if (!Number.isFinite(displayOrder) || displayOrder < 0) {
            throw buildPredictionImportError(`${categoryLocation}: 'displayOrder' must be a number >= 0.`, PREDICTION_IMPORT_REQUIRED_JSON_HINT);
          }
          if (typeof category?.isPositionBased !== "boolean") {
            throw buildPredictionImportError(`${categoryLocation}: 'isPositionBased' must be true or false.`, PREDICTION_IMPORT_REQUIRED_JSON_HINT);
          }
          if (!Number.isFinite(exactPoints) || exactPoints < 0) {
            throw buildPredictionImportError(`${categoryLocation}: 'exactPoints' must be a number >= 0.`, PREDICTION_IMPORT_REQUIRED_JSON_HINT);
          }
          if (!Number.isFinite(partialPoints) || partialPoints < 0) {
            throw buildPredictionImportError(`${categoryLocation}: 'partialPoints' must be a number >= 0.`, PREDICTION_IMPORT_REQUIRED_JSON_HINT);
          }
          if (category?.metadata !== undefined && (!category.metadata || typeof category.metadata !== "object" || Array.isArray(category.metadata))) {
            throw buildPredictionImportError(`${categoryLocation}: 'metadata' must be a JSON object.`, PREDICTION_IMPORT_REQUIRED_JSON_HINT);
          }

          return {
            name: categoryName,
            displayOrder,
            isPositionBased: category.isPositionBased,
            exactPoints,
            partialPoints,
            metadata: category?.metadata || {}
          };
        })
      };
    })
  };
}

function buildUsersExportCsv(payload) {
  const rows = [USER_IMPORT_CSV_HEADERS.join(",")];
  (payload?.users || []).forEach((user) => {
    rows.push([
      user.id || "",
      user.name || "",
      user.email || "",
      user.role || "player",
      user.emailVerified,
      user.created_at || user.createdAt || "",
      user.password || ""
    ].map(escapeCsvValue).join(","));
  });
  return rows.join("\n");
}

function buildUserPredictionImportError(message, hint = USER_PREDICTION_IMPORT_REQUIRED_CSV_HINT) {
  return new Error(hint ? `${message} ${hint}` : message);
}

function buildUserPredictionsExportCsv(payload) {
  const rows = [USER_PREDICTION_CSV_HEADERS.join(",")];
  (payload?.races || []).forEach((entry) => {
    const pickRows = Array.isArray(entry.picks) && entry.picks.length > 0 ? entry.picks : [null];
    pickRows.forEach((pick) => {
      rows.push([
        payload?.user?.id || "",
        payload?.user?.email || "",
        payload?.user?.name || "",
        entry.leagueId || "",
        entry.leagueName || "",
        entry.raceId || "",
        entry.raceName || "",
        entry.raceDate || "",
        entry.deadlineAt || "",
        entry.pickStatus || "submitted",
        entry.submittedAt || "",
        pick?.categoryName || "",
        pick?.valueText || "",
        pick?.valueNumber ?? ""
      ].map(escapeCsvValue).join(","));
    });
  });
  return rows.join("\n");
}

function normalizeUserPredictionJsonPayload(parsed, fallbackUserId, fallbackYear) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw buildUserPredictionImportError("User prediction import JSON must be an object.", USER_PREDICTION_IMPORT_REQUIRED_JSON_HINT);
  }

  const userId = String(parsed.userId || parsed?.user?.id || fallbackUserId || "").trim();
  const year = Number(parsed.year || fallbackYear);
  if (!userId) {
    throw buildUserPredictionImportError("User prediction import JSON must include userId.", USER_PREDICTION_IMPORT_REQUIRED_JSON_HINT);
  }
  if (!Number.isInteger(year) || year < 1950 || year > 2100) {
    throw buildUserPredictionImportError("User prediction import JSON must include a valid year.", USER_PREDICTION_IMPORT_REQUIRED_JSON_HINT);
  }
  if (!Array.isArray(parsed.races) || parsed.races.length === 0) {
    throw buildUserPredictionImportError("User prediction import JSON must include a non-empty 'races' array.", USER_PREDICTION_IMPORT_REQUIRED_JSON_HINT);
  }

  return {
    userId,
    year,
    races: parsed.races.map((entry, index) => {
      const location = `JSON races[${index}]`;
      const raceId = String(entry?.raceId || "").trim();
      const leagueId = String(entry?.leagueId || "").trim();
      const pickStatus = String(entry?.pickStatus || "submitted").trim().toLowerCase();
      if (!raceId) throw buildUserPredictionImportError(`${location}: 'raceId' is required.`, USER_PREDICTION_IMPORT_REQUIRED_JSON_HINT);
      if (!leagueId) throw buildUserPredictionImportError(`${location}: 'leagueId' is required.`, USER_PREDICTION_IMPORT_REQUIRED_JSON_HINT);
      if (!["draft", "submitted", "empty"].includes(pickStatus)) {
        throw buildUserPredictionImportError(`${location}: 'pickStatus' must be draft, submitted, or empty.`, USER_PREDICTION_IMPORT_REQUIRED_JSON_HINT);
      }
      if (!Array.isArray(entry?.picks)) {
        throw buildUserPredictionImportError(`${location}: 'picks' must be an array.`, USER_PREDICTION_IMPORT_REQUIRED_JSON_HINT);
      }
      return {
        raceId,
        raceName: String(entry?.raceName || "").trim() || undefined,
        raceDate: entry?.raceDate || null,
        deadlineAt: entry?.deadlineAt || null,
        leagueId,
        leagueName: String(entry?.leagueName || "").trim() || undefined,
        pickStatus,
        submittedAt: entry?.submittedAt || null,
        picks: entry.picks.map((pick, pickIndex) => {
          const pickLocation = `${location}.picks[${pickIndex}]`;
          const categoryName = String(pick?.categoryName || "").trim();
          if (!categoryName) {
            throw buildUserPredictionImportError(`${pickLocation}: 'categoryName' is required.`, USER_PREDICTION_IMPORT_REQUIRED_JSON_HINT);
          }
          return {
            categoryName,
            valueText: pick?.valueText ?? null,
            valueNumber: pick?.valueNumber ?? null
          };
        })
      };
    })
  };
}

function parseUserPredictionsCsvPayload(text, fallbackUserId, fallbackYear) {
  const { headers, rows } = parseCsvObjectsWithLineNumbers(text);
  if (headers.length === 0 || rows.length === 0) {
    throw buildUserPredictionImportError("User prediction CSV import must include a header row and at least one data row.");
  }

  const missingHeaders = USER_PREDICTION_CSV_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw buildUserPredictionImportError(`User prediction CSV import is missing required columns: ${missingHeaders.join(", ")}.`);
  }

  const grouped = new Map();
  const years = new Set();
  let resolvedUserId = String(fallbackUserId || "").trim();

  rows.forEach(({ lineNumber, row }) => {
    const location = `CSV row ${lineNumber}`;
    const userId = String(row.userId || resolvedUserId || "").trim();
    const raceId = String(row.raceId || "").trim();
    const leagueId = String(row.leagueId || "").trim();
    const categoryName = String(row.categoryName || "").trim();
    const pickStatus = String(row.pickStatus || "submitted").trim().toLowerCase();
    const raceDate = row.raceDate ? parseStrictDate(row.raceDate, "raceDate", location) : null;
    const deadlineAt = row.deadlineAt ? parseStrictDate(row.deadlineAt, "deadlineAt", location) : null;

    if (!userId) throw buildUserPredictionImportError(`${location}: 'userId' is required.`);
    if (!raceId) throw buildUserPredictionImportError(`${location}: 'raceId' is required.`);
    if (!leagueId) throw buildUserPredictionImportError(`${location}: 'leagueId' is required.`);
    if (!["draft", "submitted", "empty"].includes(pickStatus)) {
      throw buildUserPredictionImportError(`${location}: 'pickStatus' must be draft, submitted, or empty.`);
    }
    if (!categoryName) {
      throw buildUserPredictionImportError(`${location}: 'categoryName' is required.`);
    }

    resolvedUserId = userId;
    if (raceDate) years.add(new Date(raceDate).getUTCFullYear());
    const key = `${raceId}:${leagueId}`;
    const current = grouped.get(key) || {
      raceId,
      raceName: String(row.raceName || "").trim() || undefined,
      raceDate,
      deadlineAt,
      leagueId,
      leagueName: String(row.leagueName || "").trim() || undefined,
      pickStatus,
      submittedAt: row.submittedAt || null,
      picks: []
    };
    current.picks.push({
      categoryName,
      valueText: String(row.pickValueText || "").trim() || null,
      valueNumber: row.pickValueNumber === "" ? null : Number(row.pickValueNumber)
    });
    grouped.set(key, current);
  });

  const year = years.size === 1 ? Array.from(years)[0] : Number(fallbackYear);
  if (!resolvedUserId) {
    throw buildUserPredictionImportError("User prediction CSV import must resolve a userId.");
  }
  if (!Number.isInteger(year) || year < 1950 || year > 2100) {
    throw buildUserPredictionImportError("User prediction CSV import must resolve a valid year.");
  }

  return {
    userId: resolvedUserId,
    year,
    races: Array.from(grouped.values())
  };
}

function parseUserCsvBoolean(value, fieldName, location, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw buildUserImportError(`${location}: '${fieldName}' must be true or false.`);
}

function normalizeUsersJsonPayload(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw buildUserImportError("User import JSON must be an object.", USER_IMPORT_REQUIRED_JSON_HINT);
  }

  if (!Array.isArray(parsed.users) || parsed.users.length === 0) {
    throw buildUserImportError("User import JSON must include a non-empty 'users' array.", USER_IMPORT_REQUIRED_JSON_HINT);
  }

  return {
    users: parsed.users.map((user, index) => {
      const location = `JSON users[${index}]`;
      const name = String(user?.name || "").trim();
      const email = String(user?.email || "").trim().toLowerCase();
      const role = String(user?.role || "player").trim().toLowerCase();
      const password = String(user?.password || "");
      const id = user?.id ? String(user.id).trim() : "";

      if (name.length < 2) {
        throw buildUserImportError(`${location}: 'name' must be at least 2 characters.`, USER_IMPORT_REQUIRED_JSON_HINT);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw buildUserImportError(`${location}: 'email' must be a valid email address.`, USER_IMPORT_REQUIRED_JSON_HINT);
      }
      if (!["player", "admin"].includes(role)) {
        throw buildUserImportError(`${location}: 'role' must be player or admin.`, USER_IMPORT_REQUIRED_JSON_HINT);
      }
      if (password && password.length < 8) {
        throw buildUserImportError(`${location}: 'password' must be at least 8 characters when provided.`, USER_IMPORT_REQUIRED_JSON_HINT);
      }
      if (user?.emailVerified !== undefined && typeof user.emailVerified !== "boolean") {
        throw buildUserImportError(`${location}: 'emailVerified' must be true or false.`, USER_IMPORT_REQUIRED_JSON_HINT);
      }

      return {
        id: id || undefined,
        name,
        email,
        role,
        emailVerified: user?.emailVerified === undefined ? true : user.emailVerified,
        password
      };
    })
  };
}

function parseUsersCsvPayload(text) {
  const { headers, rows } = parseCsvObjectsWithLineNumbers(text);
  if (headers.length === 0 || rows.length === 0) {
    throw buildUserImportError("User CSV import must include a header row and at least one data row.");
  }

  const missingHeaders = USER_IMPORT_CSV_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw buildUserImportError(`User CSV import is missing required columns: ${missingHeaders.join(", ")}.`);
  }

  return {
    users: rows.map(({ lineNumber, row }) => {
      const location = `CSV row ${lineNumber}`;
      const name = String(row.name || "").trim();
      const email = String(row.email || "").trim().toLowerCase();
      const role = String(row.role || "player").trim().toLowerCase();
      const password = String(row.password || "");
      const id = String(row.id || "").trim();

      if (name.length < 2) {
        throw buildUserImportError(`${location}: 'name' must be at least 2 characters.`);
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw buildUserImportError(`${location}: 'email' must be a valid email address.`);
      }
      if (!["player", "admin"].includes(role)) {
        throw buildUserImportError(`${location}: 'role' must be player or admin.`);
      }
      if (password && password.length < 8) {
        throw buildUserImportError(`${location}: 'password' must be at least 8 characters when provided.`);
      }

      return {
        id: id || undefined,
        name,
        email,
        role,
        emailVerified: parseUserCsvBoolean(row.emailVerified, "emailVerified", location, true),
        password
      };
    })
  };
}

function parseCsvBulkPayload(type, text) {
  const rows = parseCsvObjects(text);

  if (type === "races") {
    return {
      races: rows.map((row) => ({
        leagueId: row.leagueId || undefined,
        leagueIds: parseCsvLikeList(row.leagueIds || "").map((item) => item.trim()).filter(Boolean),
        applyToAllLeagues: parseBool(row.applyToAllLeagues, true),
        name: row.name,
        circuitName: row.circuitName,
        externalRound: row.externalRound ? Number(row.externalRound) : null,
        raceDate: row.raceDate,
        deadlineAt: row.deadlineAt,
        hasSprintWeekend: parseBool(row.hasSprintWeekend),
        predictionOptions: parseCsvLikeList(row.predictionOptions || ""),
        positionSlotsByOption: {
          racePositions: parseCsvLikeList(row.racePositionSlots || row.positionSlots || "")
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item > 0),
          sprintPositions: parseCsvLikeList(row.sprintPositionSlots || row.positionSlots || "")
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item > 0),
          raceQualificationPositions: parseCsvLikeList(row.raceQualificationSlots || row.qualificationPositionSlots || "")
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item > 0),
          sprintQualificationPositions: parseCsvLikeList(row.sprintQualificationSlots || row.qualificationPositionSlots || "")
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item > 0)
        },
        drivers: parseCsvLikeList(row.drivers || "").map((entry) => {
          const [name, teamName] = entry.split("|").map((part) => part.trim());
          return { name, teamName: teamName || "" };
        })
      }))
    };
  }

  if (type === "drivers") {
    const grouped = new Map();
    rows.forEach((row) => {
      const raceId = String(row.raceId || "").trim();
      const driverName = String(row.driverName || "").trim();
      const teamName = String(row.teamName || "").trim();
      if (!raceId || !driverName) return;

      const current = grouped.get(raceId) || [];
      current.push({ name: driverName, teamName });
      grouped.set(raceId, current);
    });

    return {
      uploads: Array.from(grouped.entries()).map(([raceId, drivers]) => ({ raceId, drivers }))
    };
  }

  if (type === "results") {
    const grouped = new Map();
    rows.forEach((row) => {
      const raceId = String(row.raceId || "").trim();
      const categoryName = String(row.categoryName || "").trim();
      if (!raceId || !categoryName) return;

      const current = grouped.get(raceId) || {
        raceId,
        tieBreakerValue: row.tieBreakerValue || null,
        results: []
      };

      current.results.push({
        categoryName,
        valueText: row.valueText || null,
        valueNumber: row.valueNumber ? Number(row.valueNumber) : null
      });

      grouped.set(raceId, current);
    });

    return {
      uploads: Array.from(grouped.values())
    };
  }

  return null;
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

function downloadJsonFile(fileName, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeCsvValue(value) {
  const normalized = String(value ?? "");
  if (!/[",\n]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, '""')}"`;
}

function buildPredictionExportCsv(payload) {
  const rows = [PREDICTION_CONFIG_CSV_HEADERS.join(",")];
  (payload?.races || []).forEach((race) => {
    const categoryRows = Array.isArray(race.categories) && race.categories.length > 0
      ? race.categories
      : [null];

    categoryRows.forEach((category) => {
      rows.push([
        race.raceId,
        race.name,
        race.circuitName || "",
        race.externalRound || "",
        race.raceDate,
        race.deadlineAt,
        race.status,
        race.isVisible,
        race.predictionsLive,
        race.hasSprintWeekend,
        Array.isArray(race.categories) && race.categories.length > 0,
        Array.isArray(race.categories) ? race.categories.length : 0,
        category?.name || "",
        category?.displayOrder ?? "",
        category?.isPositionBased ?? "",
        category?.exactPoints ?? "",
        category?.partialPoints ?? "",
        category ? JSON.stringify(category.metadata || {}) : ""
      ].map(escapeCsvValue).join(","));
    });
  });

  return rows.join("\n");
}

function downloadTextFile(fileName, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function normalizeDriverRows(drivers) {
  if (!Array.isArray(drivers)) return [];
  return drivers
    .map((driver) => {
      if (typeof driver === "string") return { name: driver, teamName: "" };
      return {
        name: String(driver?.name || driver?.driverName || "").trim(),
        teamName: String(driver?.teamName || driver?.team || "").trim()
      };
    })
    .filter((driver) => driver.name);
}

function mapCategoryNameToOptionKey(categoryName) {
  const normalized = String(categoryName || "").toLowerCase();
  if (/^race result p\d+$/i.test(categoryName || "")) return "racePositions";
  if (/^sprint result p\d+$/i.test(categoryName || "")) return "sprintPositions";
  if (/^race qualification p\d+$/i.test(categoryName || "")) return "raceQualificationPositions";
  if (/^sprint qualification p\d+$/i.test(categoryName || "")) return "sprintQualificationPositions";
  if (normalized.includes("sprint result winner")) return "sprintResult";
  if (normalized.includes("driver of the weekend")) return "driverOfWeekend";
  if (normalized.includes("team of the weekend")) return "teamOfWeekend";
  if (normalized.includes("team battle") && normalized.includes("driver")) return "teamOfWeekend";
  if (normalized.includes("team battle") && normalized.includes("margin")) return "teamOfWeekend";
  if (normalized.includes("fastest lap driver")) return "fastestLapDriver";
  return null;
}

function getDriverOfWeekendScopeLabel(scope) {
  if (scope === "race-result") return "Race Result";
  if (scope === "sprint-result") return "Sprint Result";
  if (scope === "race-qualification") return "Race Qualification";
  if (scope === "sprint-qualification") return "Sprint Qualification";
  return "Weekend Position";
}

function formatDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (input) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function hasSprintCategories(categories) {
  return (categories || []).some((category) => {
    const name = String(category?.name || "").toLowerCase();
    return name.includes("sprint qualification") || name.includes("sprint result");
  });
}

function formatPredictionCategoryMetadata(category) {
  const parts = [];
  if (category?.metadata?.fixedTeam) {
    parts.push(`Fixed team: ${String(category.metadata.fixedTeam).trim()}`);
  }
  if (category?.metadata?.fixedDriver) {
    parts.push(`Fixed driver: ${String(category.metadata.fixedDriver).trim()}`);
  }
  if (category?.metadata?.driverOfWeekendScope) {
    parts.push(`Scope: ${getDriverOfWeekendScopeLabel(category.metadata.driverOfWeekendScope)}`);
  }
  return parts.join(" • ");
}

export default function AdminPage() {
  const router = useRouter();
  const currentYear = new Date().getUTCFullYear();
  const [activeTab, setActiveTab] = useState("leagues");
  const [isRoleResolved, setIsRoleResolved] = useState(false);

  const [message, setMessage] = useState("");
  const [allRaces, setAllRaces] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState("");
  const [leagueMembers, setLeagueMembers] = useState([]);

  const [createLeagueForm, setCreateLeagueForm] = useState({ name: "", inviteCode: "" });
  const [leagueMessage, setLeagueMessage] = useState("");
  const [editingLeagueId, setEditingLeagueId] = useState(null);
  const [editingLeagueForm, setEditingLeagueForm] = useState({ name: "", inviteCode: "" });
  const [editingRaceId, setEditingRaceId] = useState("");

  const [race, setRace] = useState({
    leagueId: "",
    leagueIds: [],
    applyToAllLeagues: true,
    name: "",
    circuitName: "",
    externalRound: "",
    raceDate: "",
    deadlineAt: "",
    hasSprintWeekend: false
  });
  const [selectedOptions, setSelectedOptions] = useState([]);
  const [optionPoints, setOptionPoints] = useState(() => buildDefaultOptionPoints());
  const [racePositionSlotsInput, setRacePositionSlotsInput] = useState(DEFAULT_POSITION_SLOTS_INPUT);
  const [sprintPositionSlotsInput, setSprintPositionSlotsInput] = useState(DEFAULT_POSITION_SLOTS_INPUT);
  const [raceQualificationSlotsInput, setRaceQualificationSlotsInput] = useState(DEFAULT_POSITION_SLOTS_INPUT);
  const [sprintQualificationSlotsInput, setSprintQualificationSlotsInput] = useState(DEFAULT_POSITION_SLOTS_INPUT);
  const [predictionPreview, setPredictionPreview] = useState(EMPTY_PREDICTION_PREVIEW);
  const [predictionYear, setPredictionYear] = useState(String(currentYear));
  const [predictionRaceScope, setPredictionRaceScope] = useState("upcoming");
  const [users, setUsers] = useState([]);
  const [userMessage, setUserMessage] = useState("");
  const [userBulkInputKey, setUserBulkInputKey] = useState(0);
  const [newUserForm, setNewUserForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "player",
    emailVerified: true
  });
  const [userPredictionYear, setUserPredictionYear] = useState(String(currentYear));
  const [selectedUserPredictionUserId, setSelectedUserPredictionUserId] = useState("");
  const [userPredictionDetail, setUserPredictionDetail] = useState(null);
  const [userPredictionMessage, setUserPredictionMessage] = useState("");
  const [userPredictionBulkFileName, setUserPredictionBulkFileName] = useState("");
  const [userPredictionBulkInputKey, setUserPredictionBulkInputKey] = useState(0);
  const [userPredictionBulkPayload, setUserPredictionBulkPayload] = useState(null);
  const [userPredictionBulkPreview, setUserPredictionBulkPreview] = useState(null);
  const [userPredictionConfirmState, setUserPredictionConfirmState] = useState({ isOpen: false, includePastRaces: false });
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingUserForm, setEditingUserForm] = useState({ name: "", email: "" });
  const [predictionRaceId, setPredictionRaceId] = useState("");
  const [predictionRaceDetail, setPredictionRaceDetail] = useState(null);
  const [predictionMessage, setPredictionMessage] = useState("");
  const [predictionBulkMessage, setPredictionBulkMessage] = useState("");
  const [predictionBulkPreview, setPredictionBulkPreview] = useState(null);
  const [predictionBulkPayload, setPredictionBulkPayload] = useState(null);
  const [predictionBulkFileName, setPredictionBulkFileName] = useState("");
  const [predictionBulkInputKey, setPredictionBulkInputKey] = useState(0);
  const [predictionExportIncludeEmptyRaces, setPredictionExportIncludeEmptyRaces] = useState(true);
  const [predictionBulkConfirmState, setPredictionBulkConfirmState] = useState({
    isOpen: false,
    includePastRaces: false
  });

  const [syncSeason, setSyncSeason] = useState(String(currentYear));
  const [syncMessage, setSyncMessage] = useState("");
  const [syncStatus, setSyncStatus] = useState(null);

  const [selectedDriverRaceId, setSelectedDriverRaceId] = useState("");
  const [driverYear, setDriverYear] = useState(String(currentYear));
  const [driverRows, setDriverRows] = useState([]);
  const [driverMessage, setDriverMessage] = useState("");

  const [bulkMessage, setBulkMessage] = useState("");

  const [lockMinutesInput, setLockMinutesInput] = useState("");
  const [lockMessage, setLockMessage] = useState("");
  const [mediaOverrides, setMediaOverrides] = useState(EMPTY_MEDIA_OVERRIDES);
  const [mediaMessage, setMediaMessage] = useState("");
  const [mediaType, setMediaType] = useState("races");
  const [mediaSeason, setMediaSeason] = useState(String(currentYear));
  const [mediaCatalog, setMediaCatalog] = useState(null);
  const [mediaEntityId, setMediaEntityId] = useState("");
  const [mediaAlt, setMediaAlt] = useState("");
  const [mediaFileName, setMediaFileName] = useState("");
  const [mediaMimeType, setMediaMimeType] = useState("");
  const [mediaImageDataUrl, setMediaImageDataUrl] = useState("");

  const selectedLeague = useMemo(
    () => leagues.find((league) => league.id === selectedLeagueId) || null,
    [leagues, selectedLeagueId]
  );

  const availableRaceDrivers = useMemo(() => {
    const sourceDrivers = predictionRaceDetail?.drivers || [];
    return sourceDrivers
      .map((row) => ({
        name: String(row?.driver_name || "").trim(),
        teamName: String(row?.team_name || "").trim()
      }))
      .filter((row) => row.name);
  }, [predictionRaceDetail]);

  const availableRaceTeams = useMemo(() => {
    return [...new Set(availableRaceDrivers.map((row) => row.teamName).filter(Boolean))];
  }, [availableRaceDrivers]);

  const predictionYearOptions = useMemo(() => {
    const years = new Set([currentYear]);
    allRaces.forEach((raceRow) => {
      const y = new Date(raceRow.race_date).getUTCFullYear();
      if (Number.isInteger(y)) years.add(y);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [allRaces, currentYear]);

  const selectableDriverRaces = useMemo(() => {
    return allRaces
      .filter((raceRow) => new Date(raceRow.race_date).getUTCFullYear() === Number(driverYear))
      .sort((a, b) => new Date(a.race_date).getTime() - new Date(b.race_date).getTime());
  }, [allRaces, driverYear]);

  const selectablePredictionRaces = useMemo(() => {
    const now = Date.now();
    return allRaces
      .filter((raceRow) => new Date(raceRow.race_date).getUTCFullYear() === Number(predictionYear))
      .filter((raceRow) => {
        const raceAt = new Date(raceRow.race_date).getTime();
        const isHistorical = raceRow.has_results || raceRow.status === "completed" || (Number.isFinite(raceAt) && raceAt <= now);
        if (predictionRaceScope === "previous") return isHistorical;
        if (predictionRaceScope === "all") return true;
        return !isHistorical;
      })
      .sort((a, b) => {
        const leftTime = new Date(a.race_date).getTime();
        const rightTime = new Date(b.race_date).getTime();
        if (predictionRaceScope === "previous") return rightTime - leftTime;
        return leftTime - rightTime;
      });
  }, [allRaces, predictionYear, predictionRaceScope]);

  const mediaOptions = useMemo(() => {
    if (mediaType === "drivers") {
      return (mediaCatalog?.drivers || [])
        .map((driver) => ({
          id: String(driver.id || "").trim(),
          label: String(driver.fullName || driver.name || "").trim()
        }))
        .filter((row) => row.id && row.label)
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    if (mediaType === "teams") {
      return (mediaCatalog?.constructors || [])
        .map((entry) => ({
          id: String(entry.team?.id || "").trim(),
          label: String(entry.team?.name || "").trim()
        }))
        .filter((row) => row.id && row.label)
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    return (mediaCatalog?.calendar || [])
      .map((raceRow) => ({
        id: getRaceVisualKey(raceRow),
        label: `${raceRow.name} (${raceRow.season} round ${raceRow.round || "?"})`
      }))
      .filter((row) => row.id && row.label);
  }, [mediaCatalog, mediaType]);

  const mediaOverrideEntries = useMemo(() => {
    const source = mediaOverrides?.[mediaType] || {};
    return Object.values(source).sort((a, b) => String(a.label || a.entityId).localeCompare(String(b.label || b.entityId)));
  }, [mediaOverrides, mediaType]);

  async function loadRaces() {
      async function loadUsers() {
        try {
          const data = await apiFetch("/admin/users");
          setUsers(data);
          if (!selectedUserPredictionUserId && data[0]?.id) {
            setSelectedUserPredictionUserId(data[0].id);
          }
        } catch (err) {
          setUserMessage(String(err.message || err));
          setUsers([]);
        }
      }

      async function loadUserPredictionDetail(userId = selectedUserPredictionUserId, year = userPredictionYear) {
        if (!userId) {
          setUserPredictionDetail(null);
          return;
        }

        try {
          const detail = await apiFetch(`/admin/users/${userId}/predictions?year=${encodeURIComponent(year)}`);
          setUserPredictionDetail(detail);
        } catch (err) {
          setUserPredictionDetail(null);
          setUserPredictionMessage(String(err.message || err));
        }
      }
    try {
      const data = await apiFetch("/races");
      setAllRaces(data);
    } catch {
      setAllRaces([]);
    }
  }

  async function loadLeagues() {
    try {
      const data = await apiFetch("/admin/leagues");
      setLeagues(data);
      if (!selectedLeagueId && data[0]?.id) {
        setSelectedLeagueId(data[0].id);
        setRace((prev) => ({ ...prev, leagueId: data[0].id }));
      }
    } catch {
      setLeagues([]);
    }
  }

  async function loadLockSetting() {
    try {
      const data = await apiFetch("/admin/settings/pick-lock-minutes");
      setLockMinutesInput(String(data.value));
    } catch (err) {
      setLockMessage(err.message);
    }
  }

  async function loadSyncStatus() {
    try {
      const data = await apiFetch("/admin/sync/jolpica/status");
      setSyncStatus(data);
    } catch (err) {
      setSyncMessage(err.message);
      setSyncStatus(null);
    }
  }

  async function loadMediaOverrides() {
    try {
      const data = await apiFetch("/admin/settings/media-overrides");
      setMediaOverrides(data || EMPTY_MEDIA_OVERRIDES);
    } catch (err) {
      setMediaMessage(err.message || "Failed to load media overrides.");
      setMediaOverrides(EMPTY_MEDIA_OVERRIDES);
    }
  }

  async function loadMediaCatalog(season) {
    try {
      const data = await apiFetch(`/f1/live?season=${encodeURIComponent(season)}`);
      setMediaCatalog(data);
    } catch (err) {
      setMediaCatalog(null);
      setMediaMessage(err.message || "Failed to load media targets.");
    }
  }

  async function loadLeagueMembers(leagueId) {
    if (!leagueId) return;
    try {
      const data = await apiFetch(`/admin/leagues/${leagueId}/members`);
      setLeagueMembers(data.members || []);
    } catch (err) {
      setLeagueMessage(err.message);
      setLeagueMembers([]);
    }
  }

  async function loadDriversForRace(raceId) {
    if (!raceId) return;
    try {
      const detail = await apiFetch(`/races/${raceId}`);
      const mapped = (detail.drivers || []).map((driver) => ({
        name: driver.driver_name,
        teamName: driver.team_name || ""
      }));
      setDriverRows(mapped.length > 0 ? mapped : [{ name: "", teamName: "" }]);
    } catch {
      setDriverRows([{ name: "", teamName: "" }]);
    }
  }

  async function loadPredictionRaceDetail(raceId) {
    if (!raceId) {
      setPredictionRaceDetail(null);
      setSelectedOptions([]);
      setOptionPoints(buildDefaultOptionPoints());
      setRacePositionSlotsInput(DEFAULT_POSITION_SLOTS_INPUT);
      setSprintPositionSlotsInput(DEFAULT_POSITION_SLOTS_INPUT);
      setRaceQualificationSlotsInput(DEFAULT_POSITION_SLOTS_INPUT);
      setSprintQualificationSlotsInput(DEFAULT_POSITION_SLOTS_INPUT);
      setPredictionPreview(EMPTY_PREDICTION_PREVIEW);
      return;
    }

    try {
      const detail = await apiFetch(`/races/${raceId}`);
      setPredictionRaceDetail(detail);
      setSelectedOptions([]);
      setOptionPoints(buildDefaultOptionPoints());
      setRacePositionSlotsInput(DEFAULT_POSITION_SLOTS_INPUT);
      setSprintPositionSlotsInput(DEFAULT_POSITION_SLOTS_INPUT);
      setRaceQualificationSlotsInput(DEFAULT_POSITION_SLOTS_INPUT);
      setSprintQualificationSlotsInput(DEFAULT_POSITION_SLOTS_INPUT);
      setPredictionPreview(EMPTY_PREDICTION_PREVIEW);
      const selected = new Set();
      const pointsByOption = {};
      const raceSlots = [];
      const sprintSlots = [];
      const raceQualificationSlots = [];
      const sprintQualificationSlots = [];
      let configuredTeamOfWeekend = "";
      let configuredDriverOfWeekend = "";

      (detail.categories || []).forEach((category) => {
        const optionKey = mapCategoryNameToOptionKey(category.name);
        if (!optionKey) return;
        selected.add(optionKey);

        if (!configuredTeamOfWeekend && category?.metadata?.fixedTeam) {
          configuredTeamOfWeekend = String(category.metadata.fixedTeam).trim();
        }
        if (!configuredDriverOfWeekend && category?.metadata?.fixedDriver) {
          configuredDriverOfWeekend = String(category.metadata.fixedDriver).trim();
        }

        if (!pointsByOption[optionKey]) {
          pointsByOption[optionKey] = {
            exactPoints: Number(category.exact_points || 0),
            partialPoints: Number(category.partial_points || 0)
          };
        }

        const raceMatch = String(category.name || "").match(/^Race Result P(\d+)$/i);
        if (raceMatch) raceSlots.push(Number(raceMatch[1]));
        const sprintMatch = String(category.name || "").match(/^Sprint Result P(\d+)$/i);
        if (sprintMatch) sprintSlots.push(Number(sprintMatch[1]));
        const raceQualificationMatch = String(category.name || "").match(/^Race Qualification P(\d+)$/i);
        if (raceQualificationMatch) raceQualificationSlots.push(Number(raceQualificationMatch[1]));
        const sprintQualificationMatch = String(category.name || "").match(/^Sprint Qualification P(\d+)$/i);
        if (sprintQualificationMatch) sprintQualificationSlots.push(Number(sprintQualificationMatch[1]));
      });

      setSelectedOptions(Array.from(selected));
    setOptionPoints({ ...buildDefaultOptionPoints(), ...pointsByOption });
      if (raceSlots.length > 0) setRacePositionSlotsInput(raceSlots.sort((a, b) => a - b).join(","));
      if (sprintSlots.length > 0) setSprintPositionSlotsInput(sprintSlots.sort((a, b) => a - b).join(","));
      if (raceQualificationSlots.length > 0) {
        setRaceQualificationSlotsInput(raceQualificationSlots.sort((a, b) => a - b).join(","));
      }
      if (sprintQualificationSlots.length > 0) {
        setSprintQualificationSlotsInput(sprintQualificationSlots.sort((a, b) => a - b).join(","));
      }
      setPredictionPreview((prev) => ({
        ...prev,
        teamOfWeekend: configuredTeamOfWeekend,
        driverOfWeekend: configuredDriverOfWeekend
      }));

      const hasSprint = Array.from(selected).some((key) =>
        ["sprintQualificationPositions", "sprintResult", "sprintPositions"].includes(key)
      );
      setRace((prev) => ({ ...prev, hasSprintWeekend: hasSprint }));
    } catch {
      setPredictionRaceDetail(null);
      setSelectedOptions([]);
      setOptionPoints(buildDefaultOptionPoints());
      setRacePositionSlotsInput(DEFAULT_POSITION_SLOTS_INPUT);
      setSprintPositionSlotsInput(DEFAULT_POSITION_SLOTS_INPUT);
      setRaceQualificationSlotsInput(DEFAULT_POSITION_SLOTS_INPUT);
      setSprintQualificationSlotsInput(DEFAULT_POSITION_SLOTS_INPUT);
      setPredictionPreview(EMPTY_PREDICTION_PREVIEW);
    }
  }

  useEffect(() => {
    const user = getStoredUser();
    if (!user) {
      router.replace("/login");
      return;
    }

    if (user.role !== "admin") {
      router.replace("/dashboard");
      return;
    }

    setIsRoleResolved(true);
  }, [router]);

  useEffect(() => {
    if (!isRoleResolved) return;
    loadRaces();
    loadLeagues();
    loadLockSetting();
    loadSyncStatus();
    loadMediaOverrides();
    loadMediaCatalog(currentYear);
  }, [isRoleResolved]);

  useEffect(() => {
    if (!isRoleResolved) return;
    if (activeTab !== "media") return;
    loadMediaCatalog(mediaSeason);
  }, [activeTab, isRoleResolved, mediaSeason]);

  useEffect(() => {
    if (!isRoleResolved) return;
    if (activeTab !== "sync") return;
    loadSyncStatus();
  }, [activeTab, isRoleResolved]);

  useEffect(() => {
    if (!isRoleResolved) return;
    if (activeTab !== "users") return;
    loadUsers();
  }, [activeTab, isRoleResolved]);

  useEffect(() => {
    if (!isRoleResolved) return;
    if (activeTab !== "users") return;
    if (!selectedUserPredictionUserId) return;
    loadUserPredictionDetail(selectedUserPredictionUserId, userPredictionYear);
  }, [activeTab, isRoleResolved, selectedUserPredictionUserId, userPredictionYear]);

  useEffect(() => {
    if (!isRoleResolved) return;
    if (selectedLeagueId) {
      loadLeagueMembers(selectedLeagueId);
      setRace((prev) => ({ ...prev, leagueId: selectedLeagueId }));
    }
  }, [selectedLeagueId, isRoleResolved]);

  useEffect(() => {
    if (!isRoleResolved) return;
    if (selectedDriverRaceId) {
      loadDriversForRace(selectedDriverRaceId);
    }
  }, [selectedDriverRaceId, isRoleResolved]);

  useEffect(() => {
    if (!isRoleResolved) return;
    if (selectableDriverRaces.length === 0) {
      setSelectedDriverRaceId("");
      setDriverRows([{ name: "", teamName: "" }]);
      return;
    }

    if (!selectableDriverRaces.find((raceRow) => raceRow.id === selectedDriverRaceId)) {
      setSelectedDriverRaceId(selectableDriverRaces[0].id);
    }
  }, [driverYear, isRoleResolved, selectableDriverRaces, selectedDriverRaceId]);

  useEffect(() => {
    if (!isRoleResolved) return;
    if (selectablePredictionRaces.length === 0) {
      setPredictionRaceId("");
      setPredictionRaceDetail(null);
      setSelectedOptions([]);
      setOptionPoints(buildDefaultOptionPoints());
      setRacePositionSlotsInput(DEFAULT_POSITION_SLOTS_INPUT);
      setSprintPositionSlotsInput(DEFAULT_POSITION_SLOTS_INPUT);
      setRaceQualificationSlotsInput(DEFAULT_POSITION_SLOTS_INPUT);
      setSprintQualificationSlotsInput(DEFAULT_POSITION_SLOTS_INPUT);
      setPredictionPreview(EMPTY_PREDICTION_PREVIEW);
      return;
    }

    if (!selectablePredictionRaces.find((raceRow) => raceRow.id === predictionRaceId)) {
      setPredictionRaceId(selectablePredictionRaces[0].id);
    }
  }, [predictionRaceId, selectablePredictionRaces, isRoleResolved]);

  useEffect(() => {
    if (!isRoleResolved) return;
    if (!predictionRaceId) return;
    loadPredictionRaceDetail(predictionRaceId);
  }, [predictionRaceId, isRoleResolved]);

  if (!isRoleResolved) {
    return (
      <div className="pb-24">
        <Header title="Admin" subtitle="Checking access" />
        <p className="card p-4 text-sm text-slate-300">Checking permissions...</p>
      </div>
    );
  }

  function toggleOption(key) {
    setSelectedOptions((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  }

  function updateOptionPoints(optionKey, field, value) {
    const parsed = Number(value);
    const safeValue = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;

    setOptionPoints((current) => ({
      ...current,
      [optionKey]: {
        ...(current[optionKey] || { exactPoints: 0, partialPoints: 0 }),
        [field]: safeValue
      }
    }));
  }

  async function createLeague(e) {
    e.preventDefault();
    setLeagueMessage("");
    try {
      await apiFetch("/admin/leagues", {
        method: "POST",
        body: JSON.stringify({
          name: createLeagueForm.name,
          inviteCode: createLeagueForm.inviteCode || undefined
        })
      });
      setCreateLeagueForm({ name: "", inviteCode: "" });
      setLeagueMessage("League created.");
      await loadLeagues();
    } catch (err) {
      setLeagueMessage(err.message);
    }
  }

  async function saveLeagueEdits() {
    if (!editingLeagueId) return;

    setLeagueMessage("");
    try {
      const payload = {
        name: editingLeagueForm.name,
        inviteCode: editingLeagueForm.inviteCode
      };
      const updated = await apiFetch(`/admin/leagues/${editingLeagueId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });

      setLeagues((prev) => prev.map((league) => (league.id === editingLeagueId ? updated : league)));
      if (selectedLeagueId === editingLeagueId) {
        setSelectedLeagueId(updated.id);
        await loadLeagueMembers(updated.id);
      }
      setEditingLeagueId(null);
      setEditingLeagueForm({ name: "", inviteCode: "" });
      setLeagueMessage("League updated.");
    } catch (err) {
      setLeagueMessage(err.message);
    }
  }

  async function deleteLeague() {
    if (!selectedLeague) return;

    const shouldDelete = window.confirm(
      `Delete league '${selectedLeague.name}'? This removes its members, league picks, league scores, and any races that no longer belong to another league.`
    );
    if (!shouldDelete) return;

    try {
      const deletedLeagueId = selectedLeague.id;
      const response = await apiFetch(`/admin/leagues/${deletedLeagueId}`, {
        method: "DELETE"
      });

      setEditingLeagueId(null);
      setEditingLeagueForm({ name: "", inviteCode: "" });

      const refreshedLeagues = await apiFetch("/admin/leagues");
      setLeagues(refreshedLeagues);

      const nextLeagueId = refreshedLeagues[0]?.id || "";
      setSelectedLeagueId(nextLeagueId);
      setLeagueMembers([]);
      setLeagueMessage(
        `${response.league.name} deleted.${response.deletedRaceCount ? ` Removed ${response.deletedRaceCount} orphaned race(s).` : ""}`
      );
      setRace((prev) => ({
        ...prev,
        leagueId: nextLeagueId,
        leagueIds: (prev.leagueIds || []).filter((id) => id !== deletedLeagueId)
      }));

      if (nextLeagueId) {
        await loadLeagueMembers(nextLeagueId);
      }
      await loadRaces();
    } catch (err) {
      setLeagueMessage(err.message);
    }
  }

  async function updateUserRole(userId, role) {
    try {
      const updated = await apiFetch(`/admin/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      });
      setUsers((prev) => prev.map((row) => (row.id === userId ? updated : row)));
      setUserMessage("User role updated");
    } catch (err) {
      setUserMessage(String(err.message || err));
    }
  }

  function resetNewUserForm() {
    setNewUserForm({
      name: "",
      email: "",
      password: "",
      role: "player",
      emailVerified: true
    });
  }

  async function createAdminUser(e) {
    e.preventDefault();
    setUserMessage("");

    try {
      const created = await apiFetch("/admin/users", {
        method: "POST",
        body: JSON.stringify(newUserForm)
      });
      setUsers((prev) => [created, ...prev]);
      resetNewUserForm();
      setUserMessage(`Created user ${created.email}.`);
    } catch (err) {
      setUserMessage(String(err.message || err));
    }
  }

  async function exportUsersJson() {
    setUserMessage("");
    try {
      const payload = await apiFetch("/admin/bulk/users/export");
      downloadJsonFile("users-export.json", payload);
      setUserMessage(`Exported ${payload.users?.length || 0} users to JSON.`);
    } catch (err) {
      setUserMessage(String(err.message || err));
    }
  }

  async function exportUsersCsv() {
    setUserMessage("");
    try {
      const payload = await apiFetch("/admin/bulk/users/export");
      downloadTextFile("users-export.csv", buildUsersExportCsv(payload), "text/csv;charset=utf-8");
      setUserMessage(`Exported ${payload.users?.length || 0} users to CSV.`);
    } catch (err) {
      setUserMessage(String(err.message || err));
    }
  }

  function resetUsersBulkInput(message = "") {
    setUserBulkInputKey((current) => current + 1);
    if (message) setUserMessage(message);
  }

  async function handleUsersBulkFile(file) {
    setUserMessage("");
    if (!file) return;

    try {
      const text = await readFileText(file);
      const lowerName = String(file.name || "").toLowerCase();
      let payload = null;

      if (lowerName.endsWith(".json")) {
        try {
          payload = normalizeUsersJsonPayload(JSON.parse(text));
        } catch (err) {
          if (err instanceof SyntaxError) {
            throw buildUserImportError("User import JSON is invalid and could not be parsed.", USER_IMPORT_REQUIRED_JSON_HINT);
          }
          throw err;
        }
      } else if (lowerName.endsWith(".csv")) {
        payload = parseUsersCsvPayload(text);
      } else {
        throw buildUserImportError("User import file must be a .json or .csv export.", `${USER_IMPORT_REQUIRED_JSON_HINT} ${USER_IMPORT_REQUIRED_CSV_HINT}`);
      }

      const response = await apiFetch("/admin/bulk/users", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      await loadUsers();
      resetUsersBulkInput(`Users import complete: created ${response.created}, updated ${response.updated}, failed ${response.failed}.`);
    } catch (err) {
      resetUsersBulkInput(String(err.message || err));
    }
  }

  async function exportUserPredictionsJson() {
    setUserPredictionMessage("");
    if (!selectedUserPredictionUserId) {
      setUserPredictionMessage("Select a user first.");
      return;
    }

    try {
      const payload = await apiFetch(`/admin/bulk/user-predictions/export?userId=${encodeURIComponent(selectedUserPredictionUserId)}&year=${encodeURIComponent(userPredictionYear)}`);
      const safeEmail = String(payload?.user?.email || selectedUserPredictionUserId).replace(/[^a-z0-9@._-]+/gi, "-");
      downloadJsonFile(`user-predictions-${safeEmail}-${userPredictionYear}.json`, payload);
      setUserPredictionMessage(`Exported ${payload.races?.length || 0} user prediction entries to JSON.`);
    } catch (err) {
      setUserPredictionMessage(String(err.message || err));
    }
  }

  async function exportUserPredictionsCsv() {
    setUserPredictionMessage("");
    if (!selectedUserPredictionUserId) {
      setUserPredictionMessage("Select a user first.");
      return;
    }

    try {
      const payload = await apiFetch(`/admin/bulk/user-predictions/export?userId=${encodeURIComponent(selectedUserPredictionUserId)}&year=${encodeURIComponent(userPredictionYear)}`);
      const safeEmail = String(payload?.user?.email || selectedUserPredictionUserId).replace(/[^a-z0-9@._-]+/gi, "-");
      downloadTextFile(`user-predictions-${safeEmail}-${userPredictionYear}.csv`, buildUserPredictionsExportCsv(payload), "text/csv;charset=utf-8");
      setUserPredictionMessage(`Exported ${payload.races?.length || 0} user prediction entries to CSV.`);
    } catch (err) {
      setUserPredictionMessage(String(err.message || err));
    }
  }

  function clearUserPredictionBulkImport(message = "") {
    setUserPredictionBulkPayload(null);
    setUserPredictionBulkPreview(null);
    setUserPredictionBulkFileName("");
    setUserPredictionConfirmState({ isOpen: false, includePastRaces: false });
    setUserPredictionBulkInputKey((current) => current + 1);
    setUserPredictionMessage(message);
  }

  async function previewUserPredictionBulkFile(file) {
    setUserPredictionMessage("");
    if (!file) return;

    try {
      const text = await readFileText(file);
      const lowerName = String(file.name || "").toLowerCase();
      let payload = null;

      if (lowerName.endsWith(".json")) {
        try {
          payload = normalizeUserPredictionJsonPayload(JSON.parse(text), selectedUserPredictionUserId, userPredictionYear);
        } catch (err) {
          if (err instanceof SyntaxError) {
            throw buildUserPredictionImportError("User prediction import JSON is invalid and could not be parsed.", USER_PREDICTION_IMPORT_REQUIRED_JSON_HINT);
          }
          throw err;
        }
      } else if (lowerName.endsWith(".csv")) {
        payload = parseUserPredictionsCsvPayload(text, selectedUserPredictionUserId, userPredictionYear);
      } else {
        throw buildUserPredictionImportError("User prediction import file must be a .json or .csv export.", `${USER_PREDICTION_IMPORT_REQUIRED_JSON_HINT} ${USER_PREDICTION_IMPORT_REQUIRED_CSV_HINT}`);
      }

      const preview = await apiFetch("/admin/bulk/user-predictions/preview", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setUserPredictionBulkPayload(payload);
      setUserPredictionBulkPreview(preview);
      setUserPredictionBulkFileName(file.name);
      setUserPredictionMessage(
        preview.summary.changedEntries > 0
          ? `Preview ready for ${preview.summary.changedEntries} changed user prediction entries. Future races will update by default.`
          : "No user prediction changes detected in the imported file."
      );
    } catch (err) {
      clearUserPredictionBulkImport(String(err.message || err));
    }
  }

  async function runUserPredictionBulkImport(includePastRaces = false) {
    if (!userPredictionBulkPayload || !userPredictionBulkPreview) {
      setUserPredictionMessage("Import a user prediction file first.");
      return;
    }

    try {
      const response = await apiFetch("/admin/bulk/user-predictions/apply", {
        method: "POST",
        body: JSON.stringify({ ...userPredictionBulkPayload, includePastRaces })
      });
      clearUserPredictionBulkImport(
        `User prediction import applied: updated ${response.updated}, skipped past races ${response.skippedPastRaces}, failed ${response.failed}.`
      );
      await loadUserPredictionDetail(userPredictionBulkPayload.userId, userPredictionBulkPayload.year);
    } catch (err) {
      setUserPredictionMessage(String(err.message || err));
    }
  }

  function requestUserPredictionBulkImport(includePastRaces = false) {
    if (!userPredictionBulkPayload || !userPredictionBulkPreview) {
      setUserPredictionMessage("Import a user prediction file first.");
      return;
    }

    const requiresModal = includePastRaces
      ? userPredictionBulkPreview.summary.pastEntriesWithChanges > 0 || userPredictionBulkPreview.summary.highRiskChanges > 0
      : userPredictionBulkPreview.summary.highRiskChanges > 0;

    if (!requiresModal) {
      runUserPredictionBulkImport(includePastRaces);
      return;
    }

    setUserPredictionConfirmState({ isOpen: true, includePastRaces });
  }

  async function createRace(e) {
    e.preventDefault();
    setMessage("");

    const racePositionSlots = parseCsvLikeList(racePositionSlotsInput)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);

    const sprintPositionSlots = parseCsvLikeList(sprintPositionSlotsInput)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    const raceQualificationSlots = parseCsvLikeList(raceQualificationSlotsInput)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    const sprintQualificationSlots = parseCsvLikeList(sprintQualificationSlotsInput)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    const fixedTeamOfWeekend = String(predictionPreview.teamOfWeekend || "").trim();

    if (selectedOptions.includes("teamOfWeekend") && !fixedTeamOfWeekend) {
      setMessage("Select the fixed team for Team of the Weekend.");
      return;
    }

    const payload = {
      ...race,
      externalRound: race.externalRound ? Number(race.externalRound) : null,
      predictionOptions: selectedOptions,
      fixedTeamOfWeekend,
      pointOverrides: Object.fromEntries(
        selectedOptions.map((optionKey) => [
          optionKey,
          {
            exactPoints: Number(optionPoints[optionKey]?.exactPoints || 0),
            partialPoints: Number(optionPoints[optionKey]?.partialPoints || 0)
          }
        ])
      ),
      positionSlotsByOption: {
        racePositions: racePositionSlots,
        sprintPositions: sprintPositionSlots,
        raceQualificationPositions: raceQualificationSlots,
        sprintQualificationPositions: sprintQualificationSlots
      },
      drivers: []
    };

    try {
      if (editingRaceId) {
        await apiFetch(`/admin/races/${editingRaceId}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        setMessage("Race updated");
      } else {
        await apiFetch("/admin/races", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        setMessage("Race created with selected options");
      }
      await loadRaces();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function loadRaceEditor(raceId) {
    if (!raceId) {
      setEditingRaceId("");
      setRace((prev) => ({
        ...prev,
        applyToAllLeagues: true,
        leagueId: selectedLeagueId || "",
        leagueIds: selectedLeagueId ? [selectedLeagueId] : [],
        name: "",
        circuitName: "",
        externalRound: "",
        raceDate: "",
        deadlineAt: "",
        hasSprintWeekend: false
      }));
      return;
    }

    try {
      const detail = await apiFetch(`/races/${raceId}`);
      const assignedLeagueIds = (detail.available_leagues || []).map((league) => league.id);
      setEditingRaceId(raceId);
      setRace((prev) => ({
        ...prev,
        applyToAllLeagues: leagues.length > 0 && assignedLeagueIds.length === leagues.length,
        leagueId: assignedLeagueIds[0] || "",
        leagueIds: assignedLeagueIds,
        name: detail.name || "",
        circuitName: detail.circuit_name || "",
        externalRound: detail.external_round ? String(detail.external_round) : "",
        raceDate: formatDateTimeLocal(detail.race_date),
        deadlineAt: formatDateTimeLocal(detail.deadline_at),
        hasSprintWeekend: hasSprintCategories(detail.categories)
      }));
      setMessage("");
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function setRaceVisibility(raceId, isVisible) {
    try {
      await apiFetch(`/admin/races/${raceId}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({ isVisible })
      });
      await loadRaces();
      if (predictionRaceId === raceId) {
        await loadPredictionRaceDetail(raceId);
      }
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function setRacePredictionsLive(raceId, predictionsLive) {
    try {
      await apiFetch(`/admin/races/${raceId}/predictions-live`, {
        method: "PATCH",
        body: JSON.stringify({ predictionsLive })
      });
      await loadRaces();
      if (predictionRaceId === raceId) {
        await loadPredictionRaceDetail(raceId);
      }
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function refreshFromJolpica() {
    setSyncMessage("");
    if (!race.applyToAllLeagues && !race.leagueId) {
      setSyncMessage("Select a league or enable all-league sync.");
      return;
    }

    try {
      const res = await apiFetch("/admin/sync/jolpica", {
        method: "POST",
        body: JSON.stringify({
          leagueId: race.applyToAllLeagues ? null : race.leagueId,
          season: Number(syncSeason)
        })
      });
      const skippedNote = res.skippedDriverRefresh
        ? `, preserved historical driver snapshots for ${res.skippedDriverRefresh} race(s)`
        : "";
      setSyncMessage(
        `Race sync done: created ${res.created}, updated ${res.updated}, drivers/race ${res.driversPerRace}${skippedNote}`
      );
      await loadRaces();
      await loadPredictionRaceDetail(predictionRaceId);
      await loadSyncStatus();
    } catch (err) {
      setSyncMessage(err.message);
    }
  }

  async function syncLatestResults() {
    setSyncMessage("");
    if (!race.leagueId) {
      setSyncMessage("Select a league first.");
      return;
    }

    try {
      const res = await apiFetch("/admin/sync/jolpica/latest-results", {
        method: "POST",
        body: JSON.stringify({
          leagueId: race.leagueId,
          season: Number(syncSeason)
        })
      });
      if (res.updated) {
        setSyncMessage(`Latest race synced to ${res.raceName}. Categories mapped: ${res.mappedCount}.`);
      } else {
        setSyncMessage(res.reason || "No updates were applied.");
      }
      await loadSyncStatus();
    } catch (err) {
      setSyncMessage(err.message);
    }
  }

  async function syncCompletedResults() {
    setSyncMessage("");

    try {
      const res = await apiFetch("/admin/sync/jolpica/completed-results", {
        method: "POST",
        body: JSON.stringify({ season: Number(syncSeason) })
      });
      setSyncMessage(
        `Weekend-result sync done: updated ${res.updatedRaces} race(s), applied ${res.updatedResults} result entries, skipped ${res.skipped?.length || 0}.`
      );
      await loadSyncStatus();
    } catch (err) {
      setSyncMessage(err.message);
    }
  }

  function updateDriverRow(index, field, value) {
    setDriverRows((current) => current.map((row, idx) => (idx === index ? { ...row, [field]: value } : row)));
  }

  function addDriverRow() {
    setDriverRows((current) => [...current, { name: "", teamName: "" }]);
  }

  function removeDriverRow(index) {
    setDriverRows((current) => current.filter((_, idx) => idx !== index));
  }

  async function saveRaceDrivers() {
    setDriverMessage("");
    try {
      const payload = normalizeDriverRows(driverRows);
      if (payload.length === 0) {
        setDriverMessage("Add at least one driver before saving.");
        return;
      }

      const res = await apiFetch(`/admin/races/${selectedDriverRaceId}/drivers`, {
        method: "PUT",
        body: JSON.stringify({ drivers: payload })
      });
      setDriverMessage(`${res.message}. Count: ${res.count}.`);
      await loadRaces();
      await loadDriversForRace(selectedDriverRaceId);
    } catch (err) {
      setDriverMessage(err.message);
    }
  }

  async function savePickLockMinutes(e) {
    e.preventDefault();
    setLockMessage("");

    const parsed = Number(lockMinutesInput);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 180) {
      setLockMessage("Value must be a whole number between 0 and 180.");
      return;
    }

    try {
      const data = await apiFetch("/admin/settings/pick-lock-minutes", {
        method: "PUT",
        body: JSON.stringify({ value: parsed })
      });
      setLockMinutesInput(String(data.setting.value));
      setLockMessage(`Saved: ${data.setting.value} minutes before first qualifying.`);
    } catch (err) {
      setLockMessage(err.message);
    }
  }

  async function handleMediaFileChange(file) {
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setMediaFileName(file.name || "");
      setMediaMimeType(file.type || "");
      setMediaImageDataUrl(dataUrl);
      setMediaMessage("");
    } catch (err) {
      setMediaMessage(err.message || "Failed to read image file.");
    }
  }

  async function saveMediaOverride(e) {
    e.preventDefault();
    setMediaMessage("");

    if (!mediaEntityId) {
      setMediaMessage("Select a target before uploading an image.");
      return;
    }
    if (!mediaImageDataUrl) {
      setMediaMessage("Choose an image file first.");
      return;
    }

    try {
      const response = await apiFetch("/admin/settings/media-overrides", {
        method: "PUT",
        body: JSON.stringify({
          entityType: mediaType,
          entityId: mediaEntityId,
          imageDataUrl: mediaImageDataUrl,
          alt: mediaAlt,
          label: mediaOptions.find((item) => item.id === mediaEntityId)?.label || mediaEntityId,
          fileName: mediaFileName,
          mimeType: mediaMimeType
        })
      });
      invalidateF1MediaOverridesCache();
      setMediaOverrides(response.overrides || EMPTY_MEDIA_OVERRIDES);
      setMediaMessage("Media override saved.");
    } catch (err) {
      setMediaMessage(err.message || "Failed to save media override.");
    }
  }

  async function removeMediaOverride(entityType, entityId) {
    try {
      const response = await apiFetch(`/admin/settings/media-overrides/${entityType}/${encodeURIComponent(entityId)}`, {
        method: "DELETE"
      });
      invalidateF1MediaOverridesCache();
      setMediaOverrides(response.overrides || EMPTY_MEDIA_OVERRIDES);
      setMediaMessage("Media override removed.");
    } catch (err) {
      setMediaMessage(err.message || "Failed to remove media override.");
    }
  }

  async function savePredictionOptionsForRace() {
    setPredictionMessage("");
    if (!predictionRaceId) {
      setPredictionMessage("Select a race first.");
      return;
    }

    const raceSlots = parseCsvLikeList(racePositionSlotsInput)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    const sprintSlots = parseCsvLikeList(sprintPositionSlotsInput)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    const raceQualificationSlots = parseCsvLikeList(raceQualificationSlotsInput)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    const sprintQualificationSlots = parseCsvLikeList(sprintQualificationSlotsInput)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    const fixedTeamOfWeekend = String(predictionPreview.teamOfWeekend || "").trim();
    const fixedDriverOfWeekend = String(predictionPreview.driverOfWeekend || "").trim();

    if (selectedOptions.includes("teamOfWeekend") && !fixedTeamOfWeekend) {
      setPredictionMessage("Select the fixed team for Team of the Weekend.");
      return;
    }

    if (selectedOptions.includes("driverOfWeekend") && !fixedDriverOfWeekend) {
      setPredictionMessage("Select the fixed driver for Driver of the Weekend.");
      return;
    }

    const driverOfWeekendScopes = [
      selectedOptions.includes("racePositions") ? "race-result" : null,
      selectedOptions.includes("sprintPositions") ? "sprint-result" : null,
      selectedOptions.includes("raceQualificationPositions") ? "race-qualification" : null,
      selectedOptions.includes("sprintQualificationPositions") ? "sprint-qualification" : null
    ].filter(Boolean);

    if (selectedOptions.includes("driverOfWeekend") && driverOfWeekendScopes.length === 0) {
      setPredictionMessage("Driver of the Weekend needs at least one selected position group to inherit from.");
      return;
    }

    const categories = [];
    let displayOrder = 1;
    [...new Set(selectedOptions)].forEach((optionKey) => {
      const option = PREDICTION_OPTIONS.find((item) => item.key === optionKey);
      if (!option) return;
      if (option.sprintOnly && !race.hasSprintWeekend) return;

      const exactPoints = Number(optionPoints[optionKey]?.exactPoints ?? option.defaultExactPoints);
      const partialPoints = Number(optionPoints[optionKey]?.partialPoints ?? option.defaultPartialPoints);

      if (optionKey === "racePositions") {
        const slots = raceSlots.length > 0 ? raceSlots : [1, 2, 3];
        slots.forEach((slot) => {
          categories.push({
            name: `Race Result P${slot}`,
            displayOrder: displayOrder++,
            isPositionBased: true,
            exactPoints,
            partialPoints
          });
        });
        return;
      }

      if (optionKey === "sprintPositions") {
        const slots = sprintSlots.length > 0 ? sprintSlots : [1, 2, 3];
        slots.forEach((slot) => {
          categories.push({
            name: `Sprint Result P${slot}`,
            displayOrder: displayOrder++,
            isPositionBased: true,
            exactPoints,
            partialPoints
          });
        });
        return;
      }

      if (optionKey === "raceQualificationPositions") {
        const slots = raceQualificationSlots.length > 0 ? raceQualificationSlots : [1, 2, 3];
        slots.forEach((slot) => {
          categories.push({
            name: `Race Qualification P${slot}`,
            displayOrder: displayOrder++,
            isPositionBased: true,
            exactPoints,
            partialPoints
          });
        });
        return;
      }

      if (optionKey === "sprintQualificationPositions") {
        const slots = sprintQualificationSlots.length > 0 ? sprintQualificationSlots : [1, 2, 3];
        slots.forEach((slot) => {
          categories.push({
            name: `Sprint Qualification P${slot}`,
            displayOrder: displayOrder++,
            isPositionBased: true,
            exactPoints,
            partialPoints
          });
        });
        return;
      }

      if (optionKey === "teamOfWeekend") {
        categories.push({
          name: "Race Team Battle Winner (Driver)",
          displayOrder: displayOrder++,
          isPositionBased: false,
          metadata: { fixedTeam: fixedTeamOfWeekend },
          exactPoints,
          partialPoints
        });
        categories.push({
          name: "Race Team Battle Winning Margin",
          displayOrder: displayOrder++,
          isPositionBased: false,
          metadata: { fixedTeam: fixedTeamOfWeekend },
          exactPoints,
          partialPoints
        });

        if (race.hasSprintWeekend) {
          categories.push({
            name: "Sprint Team Battle Winner (Driver)",
            displayOrder: displayOrder++,
            isPositionBased: false,
            metadata: { fixedTeam: fixedTeamOfWeekend },
            exactPoints,
            partialPoints
          });
          categories.push({
            name: "Sprint Team Battle Winning Margin",
            displayOrder: displayOrder++,
            isPositionBased: false,
            metadata: { fixedTeam: fixedTeamOfWeekend },
            exactPoints,
            partialPoints
          });
        }

        return;
      }

      if (optionKey === "driverOfWeekend") {
        driverOfWeekendScopes.forEach((scope) => {
          categories.push({
            name: `Driver of the Weekend ${getDriverOfWeekendScopeLabel(scope)} Position`,
            displayOrder: displayOrder++,
            isPositionBased: false,
            metadata: {
              fixedDriver: fixedDriverOfWeekend,
              driverOfWeekendScope: scope
            },
            exactPoints,
            partialPoints
          });
        });
        return;
      }

      const categoryName = OPTION_CATEGORY_NAMES[optionKey];
      if (!categoryName) return;
      categories.push({
        name: categoryName,
        displayOrder: displayOrder++,
        isPositionBased: ["sprintResult"].includes(optionKey),
        exactPoints,
        partialPoints
      });
    });

    try {
      const response = await apiFetch(`/admin/races/${predictionRaceId}/categories`, {
        method: "POST",
        body: JSON.stringify({ categories })
      });
      if (categories.length > 0) {
        await apiFetch(`/admin/races/${predictionRaceId}/predictions-live`, {
          method: "PATCH",
          body: JSON.stringify({ predictionsLive: true })
        });
        setPredictionMessage(
          response?.rescored
            ? "Prediction options saved, existing player picks were preserved, and leaderboard scores were recalculated."
            : "Prediction options saved and predictions are now live for this race."
        );
      } else {
        setPredictionMessage("No prediction options selected. The race has been hidden and predictions remain closed.");
      }
      await loadRaces();
      await loadPredictionRaceDetail(predictionRaceId);
    } catch (err) {
      setPredictionMessage(err.message);
    }
  }

  async function exportPredictionConfigForYear() {
    setPredictionBulkMessage("");

    try {
      const payload = await apiFetch(
        `/admin/bulk/predictions/export?year=${encodeURIComponent(predictionYear)}&includeEmptyRaces=${predictionExportIncludeEmptyRaces ? "true" : "false"}`
      );
      downloadJsonFile(`prediction-config-${predictionYear}.json`, payload);
      setPredictionBulkMessage(
        predictionExportIncludeEmptyRaces
          ? `Exported prediction config for ${predictionYear}, including races with no prediction options yet.`
          : `Exported prediction config for ${predictionYear} with configured races only.`
      );
    } catch (err) {
      setPredictionBulkMessage(err.message || "Failed to export prediction config.");
    }
  }

  async function exportPredictionConfigCsvForYear() {
    setPredictionBulkMessage("");

    try {
      const payload = await apiFetch(
        `/admin/bulk/predictions/export?year=${encodeURIComponent(predictionYear)}&includeEmptyRaces=${predictionExportIncludeEmptyRaces ? "true" : "false"}`
      );
      downloadTextFile(`prediction-config-${predictionYear}.csv`, buildPredictionExportCsv(payload), "text/csv;charset=utf-8");
      setPredictionBulkMessage(
        predictionExportIncludeEmptyRaces
          ? `Exported prediction config CSV for ${predictionYear}, including races with no prediction options yet.`
          : `Exported prediction config CSV for ${predictionYear} with configured races only.`
      );
    } catch (err) {
      setPredictionBulkMessage(err.message || "Failed to export prediction config CSV.");
    }
  }

  function clearPredictionBulkImport(message = "") {
    setPredictionBulkPayload(null);
    setPredictionBulkPreview(null);
    setPredictionBulkFileName("");
    setPredictionBulkConfirmState({ isOpen: false, includePastRaces: false });
    setPredictionBulkInputKey((current) => current + 1);
    setPredictionBulkMessage(message);
  }

  async function previewPredictionBulkFile(file) {
    setPredictionBulkMessage("");
    if (!file) return;

    try {
      const text = await readFileText(file);
      const lowerName = String(file.name || "").toLowerCase();
      let payload = null;

      if (lowerName.endsWith(".json")) {
        try {
          payload = normalizePredictionJsonPayload(JSON.parse(text), predictionYear);
        } catch (err) {
          if (err instanceof SyntaxError) {
            throw buildPredictionImportError("Prediction import JSON is invalid and could not be parsed.", PREDICTION_IMPORT_REQUIRED_JSON_HINT);
          }
          throw err;
        }
      } else if (lowerName.endsWith(".csv")) {
        payload = parsePredictionCsvPayload(text, predictionYear);
      } else {
        throw buildPredictionImportError("Prediction import file must be a .json or .csv export.", `${PREDICTION_IMPORT_REQUIRED_JSON_HINT} ${PREDICTION_IMPORT_REQUIRED_CSV_HINT}`);
      }

      const preview = await apiFetch("/admin/bulk/predictions/preview", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      setPredictionBulkPayload(payload);
      setPredictionBulkPreview(preview);
      setPredictionBulkFileName(file.name);
      setPredictionBulkMessage(
        preview.summary.changedRaces > 0
          ? `Preview ready for ${preview.summary.changedRaces} changed races. Future races will update by default.`
          : "No prediction changes detected in the imported file."
      );
    } catch (err) {
      clearPredictionBulkImport(err.message || "Failed to preview prediction import file.");
    }
  }

  async function runPredictionBulkImport(includePastRaces = false) {
    if (!predictionBulkPayload || !predictionBulkPreview) {
      setPredictionBulkMessage("Import a prediction config file first.");
      return;
    }

    try {
      const response = await apiFetch("/admin/bulk/predictions/apply", {
        method: "POST",
        body: JSON.stringify({ ...predictionBulkPayload, includePastRaces })
      });

      clearPredictionBulkImport(
        `Prediction import applied: updated ${response.updated}, rescored ${response.rescored}, skipped past races ${response.skippedPastRaces}, failed ${response.failed}.`
      );
      await loadRaces();
      if (predictionRaceId) {
        await loadPredictionRaceDetail(predictionRaceId);
      }
    } catch (err) {
      setPredictionBulkMessage(err.message || "Failed to apply prediction import.");
    }
  }

  function requestPredictionBulkImport(includePastRaces = false) {
    if (!predictionBulkPayload || !predictionBulkPreview) {
      setPredictionBulkMessage("Import a prediction config file first.");
      return;
    }

    const requiresModal = includePastRaces
      ? predictionBulkPreview.summary.pastRacesWithChanges > 0 || predictionBulkPreview.summary.highRiskChanges > 0
      : predictionBulkPreview.summary.highRiskChanges > 0;

    if (!requiresModal) {
      runPredictionBulkImport(includePastRaces);
      return;
    }

    setPredictionBulkConfirmState({ isOpen: true, includePastRaces });
  }

  async function handleBulkFile(type, file) {
    setBulkMessage("");
    if (!file) return;

    try {
      const text = await readFileText(file);
      const isCsv = file.name.toLowerCase().endsWith(".csv");
      const parsed = isCsv ? parseCsvBulkPayload(type, text) : JSON.parse(text);

      if (!parsed) {
        setBulkMessage("Unsupported bulk file format.");
        return;
      }

      if (type === "races") {
        const response = await apiFetch("/admin/bulk/races", {
          method: "POST",
          body: JSON.stringify({ races: parsed.races || parsed })
        });
        setBulkMessage(`Races bulk upload: created ${response.created}, failed ${response.failed}.`);
      }

      if (type === "drivers") {
        const response = await apiFetch("/admin/bulk/race-drivers", {
          method: "POST",
          body: JSON.stringify({ uploads: parsed.uploads || parsed })
        });
        setBulkMessage(`Drivers bulk upload: updated ${response.updated}, failed ${response.failed}.`);
      }

      if (type === "results") {
        const response = await apiFetch("/admin/bulk/results", {
          method: "POST",
          body: JSON.stringify({ uploads: parsed.uploads || parsed })
        });
        setBulkMessage(`Results bulk upload: updated ${response.updated}, failed ${response.failed}.`);
      }

      await loadRaces();
    } catch (err) {
      setBulkMessage(err.message || "Bulk upload failed.");
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <Header title="Admin Dashboard" subtitle="League, race, driver and results operations" />

      <section className="card p-2">
        <div className="flex gap-2 overflow-x-auto px-2 py-1">
          {ADMIN_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`tap whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold ${
                activeTab === tab.key
                  ? "bg-accent-cyan text-track-900"
                  : "border border-white/20 bg-white/5 text-slate-200"
              }`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "leagues" ? (
        <section className="card space-y-4 p-4 text-sm text-slate-200">
          <h2 className="font-display text-2xl text-accent-cyan">Leagues</h2>

          <form onSubmit={createLeague} className="space-y-2 rounded-xl border border-white/20 bg-white/5 p-3">
            <p className="font-semibold text-slate-100">Create League</p>
            <input
              className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
              placeholder="League name"
              value={createLeagueForm.name}
              onChange={(e) => setCreateLeagueForm((prev) => ({ ...prev, name: e.target.value }))}
              required
            />
            <input
              className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
              placeholder="Invite code (optional, auto-generated if blank)"
              value={createLeagueForm.inviteCode}
              onChange={(e) => setCreateLeagueForm((prev) => ({ ...prev, inviteCode: e.target.value }))}
            />
            <button className="tap rounded-xl bg-accent-red px-4 py-2 font-bold text-white">Create League</button>
          </form>

          <label className="block">
            <span className="mb-1 block font-semibold text-slate-100">Select League</span>
            <select
              className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
              value={selectedLeagueId}
              onChange={(e) => setSelectedLeagueId(e.target.value)}
            >
              <option value="" className="bg-track-900 text-slate-300">
                Select league
              </option>
              {leagues.map((league) => (
                <option key={league.id} value={league.id} className="bg-track-900 text-white">
                  {league.name} ({league.member_count} members)
                </option>
              ))}
            </select>
          </label>

          {selectedLeague ? (
            <div className="space-y-3 rounded-xl border border-white/20 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-100">League Details</p>
                <div className="flex gap-2">
                  {editingLeagueId === selectedLeague.id ? null : (
                    <button
                      type="button"
                      className="tap rounded-xl border border-white/30 px-3 py-2 text-xs font-semibold text-slate-100"
                      onClick={() => {
                        setEditingLeagueId(selectedLeague.id);
                        setEditingLeagueForm({ name: selectedLeague.name, inviteCode: selectedLeague.invite_code });
                      }}
                    >
                      Edit League
                    </button>
                  )}
                  <button
                    type="button"
                    className="tap rounded-xl border border-red-400/60 px-3 py-2 text-xs font-semibold text-red-200"
                    onClick={deleteLeague}
                  >
                    Delete League
                  </button>
                </div>
              </div>

              {editingLeagueId === selectedLeague.id ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <input
                    className="tap rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                    value={editingLeagueForm.name}
                    onChange={(e) => setEditingLeagueForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="League name"
                  />
                  <input
                    className="tap rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                    value={editingLeagueForm.inviteCode}
                    onChange={(e) => setEditingLeagueForm((prev) => ({ ...prev, inviteCode: e.target.value.toUpperCase() }))}
                    placeholder="Invite code"
                  />
                  <div className="flex gap-2">
                    <button type="button" className="tap rounded-xl bg-accent-cyan px-4 py-2 font-bold text-track-900" onClick={saveLeagueEdits}>
                      Save
                    </button>
                    <button
                      type="button"
                      className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-slate-100"
                      onClick={() => {
                        setEditingLeagueId(null);
                        setEditingLeagueForm({ name: "", inviteCode: "" });
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="font-semibold text-slate-100">Invite Code: {selectedLeague.invite_code}</p>
                  <p className="text-xs text-slate-400">Share this code with users so they can join the league.</p>
                </>
              )}
            </div>
          ) : null}

          <div className="space-y-2 rounded-xl border border-white/20 bg-white/5 p-3">
            <p className="font-semibold text-slate-100">League Members</p>
            {leagueMembers.length === 0 ? (
              <p className="text-slate-400">No members found.</p>
            ) : (
              leagueMembers.map((member) => (
                <div key={member.id} className="rounded-xl border border-white/20 px-3 py-2">
                  <p className="font-semibold text-slate-100">{member.name}</p>
                  <p className="text-xs text-slate-300">{member.email} | {member.role}</p>
                </div>
              ))
            )}
          </div>

          {leagueMessage ? <p className="text-accent-gold">{leagueMessage}</p> : null}
        </section>
      ) : null}

      {activeTab === "predictionOptions" ? (
        <section className="card space-y-3 p-4 text-sm text-slate-200">
          <h2 className="font-display text-2xl text-accent-cyan">Prediction Options</h2>
          <p>Choose prediction categories and points for any race in the selected year, including previous rounds that may need point-only updates or rescoring.</p>

          <div className="rounded-xl border border-white/20 bg-white/5 p-3">
            <p className="font-semibold text-slate-100">Applied To Race (Year Scoped)</p>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
              <label className="text-xs text-slate-300">
                Year
                <select
                  className="mt-1 w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  value={predictionYear}
                  onChange={(e) => setPredictionYear(e.target.value)}
                >
                  {predictionYearOptions.map((year) => (
                    <option key={year} value={year} className="bg-track-900 text-white">
                      {year}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-slate-300">
                Race View
                <select
                  className="mt-1 w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  value={predictionRaceScope}
                  onChange={(e) => setPredictionRaceScope(e.target.value)}
                >
                  <option value="upcoming" className="bg-track-900 text-white">Upcoming only</option>
                  <option value="previous" className="bg-track-900 text-white">Previous / completed only</option>
                  <option value="all" className="bg-track-900 text-white">All races</option>
                </select>
              </label>

              <label className="text-xs text-slate-300">
                Race
                <select
                  className="mt-1 w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  value={predictionRaceId}
                  onChange={(e) => setPredictionRaceId(e.target.value)}
                >
                  {selectablePredictionRaces.length === 0 ? (
                    <option value="" className="bg-track-900 text-slate-300">No races match the selected year and view</option>
                  ) : null}
                  {selectablePredictionRaces.map((raceRow) => (
                    <option key={raceRow.id} value={raceRow.id} className="bg-track-900 text-white">
                      {raceRow.name} - {new Date(raceRow.race_date).toLocaleDateString()} {raceRow.has_results || raceRow.status === "completed" ? "• Previous" : "• Upcoming"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="rounded-xl border border-white/20 bg-white/5 p-3 space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-slate-100">Bulk Prediction Config</p>
                <p className="mt-1 text-xs text-slate-400">Export the season config as JSON or CSV, choose whether to include races with no prediction options yet, then import edited JSON back with a preview before applying.</p>
              </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-slate-100"
                    onClick={exportPredictionConfigForYear}
                  >
                    Export JSON
                  </button>
                  <button
                    type="button"
                    className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-slate-100"
                    onClick={exportPredictionConfigCsvForYear}
                  >
                    Export CSV
                  </button>
                </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={predictionExportIncludeEmptyRaces}
                onChange={(e) => setPredictionExportIncludeEmptyRaces(e.target.checked)}
              />
              Include races that do not have prediction options configured yet so race IDs and season metadata stay aligned on re-import.
            </label>

            <div>
              <input
                key={predictionBulkInputKey}
                type="file"
                accept=".json,.csv,application/json,text/csv"
                onChange={(e) => previewPredictionBulkFile(e.target.files?.[0])}
              />
              <p className="mt-2 text-xs text-slate-400">Import a previously exported JSON or CSV file after editing category points or prediction category definitions. If the format is invalid, the app will highlight the row or JSON item that needs fixing and show the required structure.</p>
            </div>

            {predictionBulkFileName ? (
              <p className="text-xs text-slate-300">Previewing import file: {predictionBulkFileName}</p>
            ) : null}

            {predictionBulkPreview ? (
              <div className="space-y-3 rounded-xl border border-white/10 bg-track-900/40 p-3">
                <div className="grid gap-2 md:grid-cols-3">
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Changed Races</p>
                    <p className="mt-2 text-xl font-semibold text-white">{predictionBulkPreview.summary.changedRaces}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Future By Default</p>
                    <p className="mt-2 text-xl font-semibold text-white">{predictionBulkPreview.summary.futureRacesToApplyByDefault}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Past Race Warnings</p>
                    <p className="mt-2 text-xl font-semibold text-white">{predictionBulkPreview.summary.pastRacesWithChanges}</p>
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-3">
                  <p className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">Low risk: {predictionBulkPreview.summary.lowRiskChanges}</p>
                  <p className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">Medium risk: {predictionBulkPreview.summary.mediumRiskChanges}</p>
                  <p className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-100">High risk: {predictionBulkPreview.summary.highRiskChanges}</p>
                </div>

                <div className="space-y-2 max-h-72 overflow-y-auto rounded-lg border border-white/10 bg-white/5 p-3">
                  {predictionBulkPreview.races.filter((raceRow) => raceRow.changes.length > 0).map((raceRow) => (
                    <div key={`bulk-preview-${raceRow.raceId}`} className="rounded-lg border border-white/10 p-3">
                      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                        <p className="font-semibold text-slate-100">{raceRow.raceName}</p>
                        <p className={`text-xs font-semibold ${raceRow.riskLevel === "high" ? "text-red-300" : raceRow.riskLevel === "medium" ? "text-amber-300" : "text-emerald-300"}`}>
                          {raceRow.hasOccurred ? "Occurred race" : "Future race"} • {raceRow.riskLevel.toUpperCase()} risk
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{new Date(raceRow.raceDate).toLocaleString()} • {raceRow.willApplyByDefault ? "Will update by default" : "Needs explicit past-race approval or no changes"}</p>
                      <ul className="mt-2 space-y-1 text-xs text-slate-300">
                        {raceRow.changes.slice(0, 6).map((change, idx) => (
                          <li key={`${raceRow.raceId}-${change.type}-${idx}`}>{change.summary}</li>
                        ))}
                        {raceRow.changes.length > 6 ? <li>...and {raceRow.changes.length - 6} more changes</li> : null}
                      </ul>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="tap rounded-xl bg-accent-cyan px-4 py-2 font-bold text-track-900"
                    onClick={() => requestPredictionBulkImport(false)}
                    disabled={predictionBulkPreview.summary.futureRacesToApplyByDefault === 0}
                  >
                    Apply To Future Races
                  </button>
                  <button
                    type="button"
                    className="tap rounded-xl border border-amber-300/40 px-4 py-2 font-bold text-amber-100"
                    onClick={() => requestPredictionBulkImport(true)}
                    disabled={predictionBulkPreview.summary.changedRaces === 0}
                  >
                    Apply Including Past Races
                  </button>
                  <button
                    type="button"
                    className="tap rounded-xl border border-white/20 px-4 py-2 font-bold text-slate-200"
                    onClick={() => clearPredictionBulkImport("Prediction import cancelled.")}
                  >
                    Cancel Import
                  </button>
                </div>
              </div>
            ) : null}

            {predictionBulkMessage ? <p className="text-accent-gold">{predictionBulkMessage}</p> : null}
          </div>

          {predictionRaceDetail ? (
            <div className="space-y-3 rounded-xl border border-white/20 bg-white/5 p-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-semibold text-slate-100">Race Access</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {predictionRaceDetail.name} • Deadline {new Date(predictionRaceDetail.deadline_at).toLocaleString()}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Visible to players: {predictionRaceDetail.is_visible ? "Yes" : "No"} • Predictions live: {predictionRaceDetail.predictions_live === false ? "No" : "Yes"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`tap rounded-xl px-3 py-2 text-xs font-bold ${
                      predictionRaceDetail.predictions_live === false ? "bg-slate-600 text-white" : "bg-emerald-500 text-track-900"
                    }`}
                    onClick={() => setRacePredictionsLive(predictionRaceId, predictionRaceDetail.predictions_live === false)}
                  >
                    {predictionRaceDetail.predictions_live === false ? "Open Predictions" : "Close Predictions"}
                  </button>
                  <button
                    type="button"
                    className={`tap rounded-xl px-3 py-2 text-xs font-bold ${
                      predictionRaceDetail.is_visible ? "bg-accent-cyan text-track-900" : "bg-slate-600 text-white"
                    }`}
                    onClick={() => setRaceVisibility(predictionRaceId, !predictionRaceDetail.is_visible)}
                  >
                    {predictionRaceDetail.is_visible ? "Hide Race" : "Show Race"}
                  </button>
                </div>
              </div>

              {predictionRaceDetail.is_locked || predictionRaceDetail.has_results ? (
                <p className="rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  This race is locked or already has results. You can safely update points on existing categories and the leaderboard will rescore automatically. Removing or renaming saved categories will be blocked once picks or results exist.
                </p>
              ) : null}

              <div className="rounded-lg border border-white/10 bg-track-900/30 p-3">
                <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                  <p className="font-semibold text-slate-100">Saved Prediction Categories</p>
                  <p className="text-xs text-slate-400">{predictionRaceDetail.categories?.length || 0} configured</p>
                </div>
                {predictionRaceDetail.categories?.length ? (
                  <div className="mt-3 space-y-2 max-h-72 overflow-y-auto">
                    {predictionRaceDetail.categories.map((category) => {
                      const metadataSummary = formatPredictionCategoryMetadata(category);
                      return (
                        <div key={category.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                            <p className="font-medium text-slate-100">{category.name}</p>
                            <p className="text-xs text-slate-400">Exact {Number(category.exact_points || 0)} • Partial {Number(category.partial_points || 0)}</p>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-400">
                            Order {Number(category.display_order || 0)} • {category.is_position_based ? "Position based" : "Direct pick"}
                            {metadataSummary ? ` • ${metadataSummary}` : ""}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-400">No prediction options are saved for this race yet.</p>
                )}
              </div>
            </div>
          ) : null}

          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={race.hasSprintWeekend}
              onChange={(e) => setRace({ ...race, hasSprintWeekend: e.target.checked })}
            />
            Sprint weekend
          </label>

          <div className="rounded-xl border border-white/20 bg-white/5 p-3">
            <div className="space-y-2">
              {PREDICTION_OPTIONS.map((option) => {
                const disabled = option.sprintOnly && !race.hasSprintWeekend;
                return (
                  <div key={option.key} className={`rounded-lg border border-white/10 p-2 ${disabled ? "opacity-60" : ""}`}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <label className={`flex items-start gap-2 text-sm ${disabled ? "text-slate-500" : "text-slate-200"}`}>
                        <input
                          type="checkbox"
                          checked={selectedOptions.includes(option.key)}
                          disabled={disabled}
                          onChange={() => toggleOption(option.key)}
                        />
                        {option.label}
                      </label>

                      {selectedOptions.includes(option.key) && option.key === "driverOfWeekend" ? (
                        <div className="w-full md:w-[320px]">
                          <select
                            className="w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-xs text-white"
                            value={predictionPreview.driverOfWeekend}
                            onChange={(e) =>
                              setPredictionPreview((prev) => ({ ...prev, driverOfWeekend: e.target.value }))
                            }
                          >
                            <option value="" className="bg-track-900 text-slate-300">Select fixed driver</option>
                            {availableRaceDrivers.map((driver) => (
                              <option key={`dow-${driver.name}`} value={driver.name} className="bg-track-900 text-white">
                                {driver.teamName ? `${driver.name} (${driver.teamName})` : driver.name}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-[11px] text-slate-400">Players will predict this driver's finishing position for each enabled position group.</p>
                        </div>
                      ) : null}

                      {selectedOptions.includes(option.key) && option.key === "teamOfWeekend" ? (
                        <div className="w-full md:w-[320px]">
                          <select
                            className="w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-xs text-white"
                            value={predictionPreview.teamOfWeekend}
                            onChange={(e) =>
                              setPredictionPreview((prev) => ({ ...prev, teamOfWeekend: e.target.value }))
                            }
                          >
                            <option value="" className="bg-track-900 text-slate-300">Select fixed team</option>
                            {availableRaceTeams.map((team) => (
                              <option key={`tow-${team}`} value={team} className="bg-track-900 text-white">
                                {team}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-[11px] text-slate-400">Admin locks the team. Players will then predict the teammate winner and margin for the race, and for the sprint too on sprint weekends.</p>
                        </div>
                      ) : null}

                      {selectedOptions.includes(option.key) && option.key === "racePositions" ? (
                        <input
                          className="w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-xs text-white md:w-[320px]"
                          placeholder="Race slots (example: 6,7,8)"
                          value={racePositionSlotsInput}
                          onChange={(e) => setRacePositionSlotsInput(e.target.value)}
                        />
                      ) : null}

                      {selectedOptions.includes(option.key) && option.key === "sprintPositions" ? (
                        <input
                          className="w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-xs text-white md:w-[320px]"
                          placeholder="Sprint slots (example: 1,2,3)"
                          value={sprintPositionSlotsInput}
                          onChange={(e) => setSprintPositionSlotsInput(e.target.value)}
                        />
                      ) : null}

                      {selectedOptions.includes(option.key) && option.key === "raceQualificationPositions" ? (
                        <input
                          className="w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-xs text-white md:w-[320px]"
                          placeholder="Race qualification slots (example: 1,2,3)"
                          value={raceQualificationSlotsInput}
                          onChange={(e) => setRaceQualificationSlotsInput(e.target.value)}
                        />
                      ) : null}

                      {selectedOptions.includes(option.key) && option.key === "sprintQualificationPositions" ? (
                        <input
                          className="w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-xs text-white md:w-[320px]"
                          placeholder="Sprint qualification slots (example: 1,2,3)"
                          value={sprintQualificationSlotsInput}
                          onChange={(e) => setSprintQualificationSlotsInput(e.target.value)}
                        />
                      ) : null}
                    </div>

                    {selectedOptions.includes(option.key) ? (
                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                        <label className="text-xs text-slate-300">
                          Exact points
                          <input
                            type="number"
                            min="0"
                            step="1"
                            className="mt-1 w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-white"
                            value={optionPoints[option.key]?.exactPoints ?? option.defaultExactPoints}
                            onChange={(e) => updateOptionPoints(option.key, "exactPoints", e.target.value)}
                          />
                        </label>
                        <label className="text-xs text-slate-300">
                          {[
                            "racePositions",
                            "sprintPositions",
                            "raceQualificationPositions",
                            "sprintQualificationPositions"
                          ].includes(option.key)
                            ? "Distance step (points deducted per position away)"
                            : "Partial points"}
                          <input
                            type="number"
                            min="0"
                            step="1"
                            className="mt-1 w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-white"
                            value={optionPoints[option.key]?.partialPoints ?? option.defaultPartialPoints}
                            onChange={(e) => updateOptionPoints(option.key, "partialPoints", e.target.value)}
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="tap rounded-xl bg-accent-red px-4 py-2 font-bold text-white"
              onClick={savePredictionOptionsForRace}
              disabled={!predictionRaceId}
            >
              Save Prediction Options To Race
            </button>
            {predictionMessage ? <p className="text-accent-gold">{predictionMessage}</p> : null}
          </div>
        </section>
      ) : null}

      {activeTab === "createRace" ? (
        <form onSubmit={createRace} className="card space-y-3 p-4">
          <h2 className="font-display text-2xl text-accent-cyan">{editingRaceId ? "Edit Race Weekend" : "Create Race Weekend (Manual)"}</h2>
          <p className="text-xs text-slate-400">
            Prediction categories are configured in the <span className="font-semibold text-slate-200">Prediction Options</span> tab.
          </p>

          <label className="block text-sm text-slate-200">
            <span className="mb-1 block font-semibold text-accent-cyan">Manage Existing Race</span>
            <select
              className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
              value={editingRaceId}
              onChange={(e) => loadRaceEditor(e.target.value)}
            >
              <option value="" className="bg-track-900 text-slate-300">Create new race</option>
              {allRaces.map((raceRow) => (
                <option key={raceRow.id} value={raceRow.id} className="bg-track-900 text-white">
                  {raceRow.name} - {new Date(raceRow.race_date).toLocaleDateString()}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-xl border border-white/20 bg-white/5 p-3">
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={race.applyToAllLeagues}
                onChange={(e) => setRace((prev) => ({ ...prev, applyToAllLeagues: e.target.checked }))}
              />
              Add race to all leagues by default
            </label>

            {!race.applyToAllLeagues ? (
              <label className="mt-3 block text-sm text-slate-200">
                <span className="mb-1 block font-semibold text-accent-cyan">Choose Leagues</span>
                <select
                  multiple
                  className="tap min-h-[120px] w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  value={race.leagueIds}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions).map((option) => option.value);
                    setRace((prev) => ({ ...prev, leagueIds: selected, leagueId: selected[0] || "" }));
                  }}
                >
                  {leagues.map((league) => (
                    <option key={league.id} value={league.id} className="bg-track-900 text-white">
                      {league.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <input
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            placeholder="Race Name"
            value={race.name}
            onChange={(e) => setRace({ ...race, name: e.target.value })}
            required
          />
          <input
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            placeholder="Circuit Name"
            value={race.circuitName}
            onChange={(e) => setRace({ ...race, circuitName: e.target.value })}
            required
          />
          <input
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            placeholder="External Round (optional, 1-30)"
            value={race.externalRound}
            onChange={(e) => setRace({ ...race, externalRound: e.target.value })}
          />
          <input
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            type="datetime-local"
            value={race.raceDate}
            onChange={(e) => setRace({ ...race, raceDate: e.target.value })}
            required
          />
          <input
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            type="datetime-local"
            value={race.deadlineAt}
            onChange={(e) => setRace({ ...race, deadlineAt: e.target.value })}
            required
          />

          <p className="text-xs text-slate-400">
            Drivers are managed after race creation in the <span className="font-semibold text-slate-200">Drivers</span> tab.
          </p>

          <div className="flex gap-2">
            <button className="tap rounded-xl bg-accent-red px-4 py-2 font-bold text-white">
              {editingRaceId ? "Save Race Changes" : "Create Race"}
            </button>
            {editingRaceId ? (
              <button
                type="button"
                className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-slate-100"
                onClick={() => loadRaceEditor("")}
              >
                New Race
              </button>
            ) : null}
          </div>

          <div className="space-y-2 rounded-xl border border-white/20 bg-white/5 p-3 text-sm text-slate-200">
            <p className="font-semibold text-slate-100">Bulk Races Upload (JSON or CSV)</p>
            <input
              type="file"
              accept="application/json,.csv,text/csv"
              onChange={(e) => handleBulkFile("races", e.target.files?.[0])}
            />
            <pre className="overflow-x-auto rounded bg-track-900/70 p-2 text-xs text-slate-300">{`# races.csv
leagueId,leagueIds,applyToAllLeagues,name,circuitName,externalRound,raceDate,deadlineAt,hasSprintWeekend,predictionOptions,racePositionSlots,sprintPositionSlots,raceQualificationSlots,sprintQualificationSlots,drivers
,"",true,Australian Grand Prix,Albert Park,1,2026-03-15T04:00:00Z,2026-03-14T03:00:00Z,true,"raceQualificationPositions;racePositions;sprintPositions;fastestLapDriver","6;7;8","1;2;3","1;2;3","1;2;3","Lando Norris|McLaren;Charles Leclerc|Ferrari"`}</pre>
          </div>

          {message ? <p className="text-accent-gold">{message}</p> : null}
          {bulkMessage ? <p className="text-accent-gold">{bulkMessage}</p> : null}
        </form>
      ) : null}

      {activeTab === "drivers" ? (
        <section className="card space-y-3 p-4 text-sm text-slate-200">
          <h2 className="font-display text-2xl text-accent-cyan">Manage Drivers</h2>
          <label className="block text-sm text-slate-200">
            <span className="mb-1 block font-semibold text-accent-cyan">Year</span>
            <select
              className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
              value={driverYear}
              onChange={(e) => setDriverYear(e.target.value)}
            >
              {predictionYearOptions.map((year) => (
                <option key={`driver-year-${year}`} value={String(year)} className="bg-track-900 text-white">
                  {year}
                </option>
              ))}
            </select>
          </label>
          <select
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            value={selectedDriverRaceId}
            onChange={(e) => setSelectedDriverRaceId(e.target.value)}
          >
            {selectableDriverRaces.map((raceRow) => (
              <option key={raceRow.id} value={raceRow.id} className="bg-track-900 text-white">
                {raceRow.name} - {new Date(raceRow.race_date).toLocaleDateString()}
              </option>
            ))}
          </select>
          {selectableDriverRaces.length === 0 ? <p className="text-xs text-slate-400">No races found for the selected year.</p> : null}

          <div className="space-y-2">
            {driverRows.map((driver, index) => (
              <div key={`${index}-${driver.name}`} className="grid grid-cols-1 gap-2 rounded-xl border border-white/20 p-3 md:grid-cols-[1fr_1fr_auto]">
                <input
                  className="tap rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  placeholder="Driver name"
                  value={driver.name}
                  onChange={(e) => updateDriverRow(index, "name", e.target.value)}
                />
                <input
                  className="tap rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  placeholder="Team"
                  value={driver.teamName}
                  onChange={(e) => updateDriverRow(index, "teamName", e.target.value)}
                />
                <button
                  type="button"
                  className="tap rounded-xl border border-red-400/60 px-3 py-2 text-red-200"
                  onClick={() => removeDriverRow(index)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button type="button" className="tap rounded-xl border border-white/30 px-3 py-2" onClick={addDriverRow}>
              Add Driver
            </button>
            <button type="button" className="tap rounded-xl bg-accent-cyan px-4 py-2 font-bold text-track-900" onClick={saveRaceDrivers}>
              Save Drivers
            </button>
          </div>

          <div className="space-y-2 rounded-xl border border-white/20 bg-white/5 p-3">
            <p className="font-semibold text-slate-100">Bulk Drivers Upload (JSON or CSV)</p>
            <input
              type="file"
              accept="application/json,.csv,text/csv"
              onChange={(e) => handleBulkFile("drivers", e.target.files?.[0])}
            />
            <pre className="overflow-x-auto rounded bg-track-900/70 p-2 text-xs text-slate-300">{`# drivers.csv
raceId,driverName,teamName
<race-uuid>,Max Verstappen,Red Bull
<race-uuid>,Charles Leclerc,Ferrari`}</pre>
          </div>

          {driverMessage ? <p className="text-accent-gold">{driverMessage}</p> : null}
          {bulkMessage ? <p className="text-accent-gold">{bulkMessage}</p> : null}
        </section>
      ) : null}

      {activeTab === "media" ? (
        <section className="card space-y-4 p-4 text-sm text-slate-200">
          <h2 className="font-display text-2xl text-accent-cyan">Media Overrides</h2>
          <p>Upload custom images to replace the generated visuals shown for races, teams, and drivers across the live F1 views.</p>

          <form onSubmit={saveMediaOverride} className="space-y-3 rounded-xl border border-white/20 bg-white/5 p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block font-semibold text-slate-100">Type</span>
                <select
                  className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  value={mediaType}
                  onChange={(e) => {
                    setMediaType(e.target.value);
                    setMediaEntityId("");
                    setMediaMessage("");
                  }}
                >
                  <option value="races" className="bg-track-900 text-white">Races</option>
                  <option value="teams" className="bg-track-900 text-white">Teams</option>
                  <option value="drivers" className="bg-track-900 text-white">Drivers</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block font-semibold text-slate-100">Season Catalog</span>
                <select
                  className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  value={mediaSeason}
                  onChange={(e) => {
                    setMediaSeason(e.target.value);
                    setMediaEntityId("");
                  }}
                >
                  {[currentYear, currentYear - 1, currentYear - 2].map((year) => (
                    <option key={`media-season-${year}`} value={String(year)} className="bg-track-900 text-white">
                      {year}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block font-semibold text-slate-100">Target</span>
                <select
                  className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  value={mediaEntityId}
                  onChange={(e) => setMediaEntityId(e.target.value)}
                >
                  <option value="" className="bg-track-900 text-slate-300">Select target</option>
                  {mediaOptions.map((option) => (
                    <option key={option.id} value={option.id} className="bg-track-900 text-white">
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {mediaCatalog?.snapshotMode === "persisted" ? (
              <p className="text-xs text-accent-gold">Using the saved live snapshot for this season because Jolpica is unavailable.</p>
            ) : null}

            <label className="block">
              <span className="mb-1 block font-semibold text-slate-100">Alt Text</span>
              <input
                className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                placeholder="Optional accessible description"
                value={mediaAlt}
                onChange={(e) => setMediaAlt(e.target.value)}
              />
            </label>

            <label className="block">
              <span className="mb-1 block font-semibold text-slate-100">Image File</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(e) => handleMediaFileChange(e.target.files?.[0])}
              />
            </label>

            {mediaImageDataUrl ? (
              <img src={mediaImageDataUrl} alt={mediaAlt || "Selected media preview"} className="h-40 w-full rounded-2xl object-cover" />
            ) : null}

            <button type="submit" className="tap rounded-xl bg-accent-cyan px-4 py-2 font-bold text-track-900">
              Save Media Override
            </button>
          </form>

          <div className="rounded-xl border border-white/20 bg-white/5 p-3">
            <p className="font-semibold text-slate-100">Saved Overrides</p>
            <div className="mt-3 space-y-3">
              {mediaOverrideEntries.length === 0 ? (
                <p className="text-slate-400">No saved overrides for this type.</p>
              ) : mediaOverrideEntries.map((entry) => (
                <div key={`${mediaType}-${entry.entityId}`} className="rounded-xl border border-white/10 p-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="font-semibold text-white">{entry.label || entry.entityId}</p>
                      <p className="text-xs text-slate-400">ID: {entry.entityId}</p>
                      <p className="text-xs text-slate-500">Updated {entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : "unknown"}</p>
                    </div>
                    <button
                      type="button"
                      className="tap rounded-xl border border-red-400/60 px-3 py-2 text-xs font-semibold text-red-200"
                      onClick={() => removeMediaOverride(mediaType, entry.entityId)}
                    >
                      Delete
                    </button>
                  </div>
                  <img src={entry.imageUrl} alt={entry.alt || entry.label || entry.entityId} className="mt-3 h-32 w-full rounded-2xl object-cover" />
                </div>
              ))}
            </div>
          </div>

          {mediaMessage ? <p className="text-accent-gold">{mediaMessage}</p> : null}
        </section>
      ) : null}

      {activeTab === "sync" ? (
        <section className="card space-y-3 p-4 text-sm text-slate-200">
          <h2 className="font-display text-2xl text-accent-cyan">Sync From Jolpica API</h2>
          <p>Race calendar and drivers can be pulled automatically by season.</p>
          {syncStatus ? (
            <div className="rounded-xl border border-white/20 bg-white/5 p-3 text-xs text-slate-300">
              <p className="font-semibold text-slate-100">Scheduled Sync Status</p>
              <p className="mt-1">Enabled: {syncStatus.runtime?.enabled ? "Yes" : "No"}</p>
              <p>Running: {syncStatus.runtime?.isRunning || syncStatus.persisted?.isRunning ? "Yes" : "No"}</p>
              <p>Interval: {Math.round((syncStatus.runtime?.intervalMs || 0) / 60000)} minutes</p>
              <p>Configured season: {syncStatus.runtime?.configuredSeason || "-"}</p>
              <p className="mt-2">Last mode: {syncStatus.persisted?.lastMode || "-"}</p>
              <p>Last started: {syncStatus.persisted?.lastRunStartedAt ? new Date(syncStatus.persisted.lastRunStartedAt).toLocaleString() : "-"}</p>
              <p>Last finished: {syncStatus.persisted?.lastRunFinishedAt ? new Date(syncStatus.persisted.lastRunFinishedAt).toLocaleString() : "-"}</p>
              <p>Last success: {syncStatus.persisted?.lastSuccessAt ? new Date(syncStatus.persisted.lastSuccessAt).toLocaleString() : "-"}</p>
              <p>Last error: {syncStatus.persisted?.lastErrorAt ? new Date(syncStatus.persisted.lastErrorAt).toLocaleString() : "-"}</p>
              {syncStatus.persisted?.lastErrorMessage ? (
                <p className="mt-1 text-red-300">Error: {syncStatus.persisted.lastErrorMessage}</p>
              ) : null}
              {syncStatus.persisted?.summary ? (
                <pre className="mt-2 overflow-x-auto rounded bg-track-900/70 p-2 text-[11px] text-slate-300">{JSON.stringify(syncStatus.persisted.summary, null, 2)}</pre>
              ) : null}
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={race.applyToAllLeagues}
              onChange={(e) => setRace((prev) => ({ ...prev, applyToAllLeagues: e.target.checked }))}
            />
            Sync races to all leagues
          </label>
          <select
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            value={race.leagueId}
            disabled={race.applyToAllLeagues}
            onChange={(e) => setRace((prev) => ({ ...prev, leagueId: e.target.value }))}
          >
            <option value="" className="bg-track-900 text-slate-300">Select league</option>
            {leagues.map((league) => (
              <option key={league.id} value={league.id} className="bg-track-900 text-white">{league.name}</option>
            ))}
          </select>
          <input
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            placeholder="Season (example: 2026)"
            value={syncSeason}
            onChange={(e) => setSyncSeason(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="tap rounded-xl bg-accent-cyan px-4 py-2 font-bold text-track-900" onClick={refreshFromJolpica}>
              Sync Races + Drivers
            </button>
            <button type="button" className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-slate-100" onClick={syncLatestResults}>
              Sync Latest Results
            </button>
            <button type="button" className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-slate-100" onClick={syncCompletedResults}>
              Sync Weekend Results
            </button>
            <button type="button" className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-slate-100" onClick={loadSyncStatus}>
              Refresh Status
            </button>
          </div>
          {syncMessage ? <p className="text-accent-gold">{syncMessage}</p> : null}
        </section>
      ) : null}

      {activeTab === "results" ? (
        <section className="card space-y-3 p-4 text-sm text-slate-200">
          <h2 className="font-display text-2xl text-accent-cyan">Results</h2>
          <p className="mt-2">API can pull latest results. You can always override manually race-by-race.</p>
          <Link
            href="/admin/results"
            className="tap mt-3 inline-block rounded-xl bg-accent-cyan px-4 py-2 font-bold text-track-900"
          >
            Open Manual Results Editor
          </Link>

          <div className="space-y-2 rounded-xl border border-white/20 bg-white/5 p-3">
            <p className="font-semibold text-slate-100">Bulk Results Upload (JSON or CSV)</p>
            <input
              type="file"
              accept="application/json,.csv,text/csv"
              onChange={(e) => handleBulkFile("results", e.target.files?.[0])}
            />
            <pre className="overflow-x-auto rounded bg-track-900/70 p-2 text-xs text-slate-300">{`# results.csv
raceId,tieBreakerValue,categoryName,valueText,valueNumber
<race-uuid>,1:31:44.000,Race Result P1,Lando Norris,
<race-uuid>,1:31:44.000,Fastest Lap Driver,Charles Leclerc,`}</pre>
          </div>

          {bulkMessage ? <p className="text-accent-gold">{bulkMessage}</p> : null}
        </section>
      ) : null}

      {activeTab === "settings" ? (
        <section className="card space-y-3 p-4 text-sm text-slate-200">
          <h2 className="font-display text-2xl text-accent-cyan">Settings</h2>
          <form onSubmit={savePickLockMinutes} className="space-y-3 rounded-xl border border-white/20 bg-white/5 p-3">
            <p className="font-semibold text-slate-100">Pick Deadline Offset (minutes before first qualifying)</p>
            <input
              type="number"
              min="0"
              max="180"
              step="1"
              className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
              value={lockMinutesInput}
              onChange={(e) => setLockMinutesInput(e.target.value)}
              required
            />
            <p className="text-xs text-slate-400">Races lock at the stored deadline. This setting controls how many minutes before the first qualifying session that deadline is generated.</p>
            <button type="submit" className="tap rounded-xl bg-accent-cyan px-4 py-2 font-bold text-track-900">
              Save Deadline Offset
            </button>
            {lockMessage ? <p className="text-accent-gold">{lockMessage}</p> : null}
          </form>
        </section>
      ) : null}

      {activeTab === "users" ? (
        <section className="card space-y-4 p-4 text-sm text-slate-200">
          <h2 className="font-display text-2xl text-accent-cyan">Users</h2>
          <p className="text-slate-300">Create users directly from the admin UI, or bulk export/import them as JSON or CSV. Passwords are never exported; leave the password field blank during import to keep an existing password unchanged.</p>

          <form onSubmit={createAdminUser} className="rounded-xl border border-white/20 bg-white/5 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-slate-100">Add User</p>
                <p className="mt-1 text-xs text-slate-400">Create a player or admin account directly. New users need a password of at least 8 characters.</p>
              </div>
              <button type="submit" className="tap rounded-xl bg-accent-red px-4 py-2 font-bold text-white">Create User</button>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label className="text-xs text-slate-300">
                Name
                <input
                  className="mt-1 w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  value={newUserForm.name}
                  onChange={(e) => setNewUserForm((prev) => ({ ...prev, name: e.target.value }))}
                  required
                />
              </label>
              <label className="text-xs text-slate-300">
                Email
                <input
                  type="email"
                  className="mt-1 w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  value={newUserForm.email}
                  onChange={(e) => setNewUserForm((prev) => ({ ...prev, email: e.target.value }))}
                  required
                />
              </label>
              <label className="text-xs text-slate-300">
                Password
                <input
                  type="password"
                  className="mt-1 w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  value={newUserForm.password}
                  onChange={(e) => setNewUserForm((prev) => ({ ...prev, password: e.target.value }))}
                  minLength={8}
                  required
                />
              </label>
              <label className="text-xs text-slate-300">
                Role
                <select
                  className="mt-1 w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  value={newUserForm.role}
                  onChange={(e) => setNewUserForm((prev) => ({ ...prev, role: e.target.value }))}
                >
                  <option value="player" className="bg-track-900 text-white">player</option>
                  <option value="admin" className="bg-track-900 text-white">admin</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300 md:pt-6">
                <input
                  type="checkbox"
                  checked={newUserForm.emailVerified}
                  onChange={(e) => setNewUserForm((prev) => ({ ...prev, emailVerified: e.target.checked }))}
                />
                Mark email as verified
              </label>
            </div>
          </form>

          <div className="rounded-xl border border-white/20 bg-white/5 p-4 space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-slate-100">Bulk User Export / Import</p>
                <p className="mt-1 text-xs text-slate-400">Export the current user list as JSON or CSV, edit offline, then import it back. Existing users are matched by exported user id first, then email.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-slate-100" onClick={exportUsersJson}>Export JSON</button>
                <button type="button" className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-slate-100" onClick={exportUsersCsv}>Export CSV</button>
              </div>
            </div>

            <div>
              <input
                key={userBulkInputKey}
                type="file"
                accept=".json,.csv,application/json,text/csv"
                onChange={(e) => handleUsersBulkFile(e.target.files?.[0])}
              />
              <p className="mt-2 text-xs text-slate-400">Import the exported JSON or CSV format. New users need a password value; existing users can leave password blank to keep the current password.</p>
            </div>
          </div>

          <div className="rounded-xl border border-white/20 bg-white/5 p-4 space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-slate-100">User Predictions</p>
                <p className="mt-1 text-xs text-slate-400">View a selected user’s saved picks and bulk export or import them with a preview step before applying updates.</p>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="text-xs text-slate-300">
                  User
                  <select
                    className="mt-1 w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                    value={selectedUserPredictionUserId}
                    onChange={(e) => setSelectedUserPredictionUserId(e.target.value)}
                  >
                    <option value="" className="bg-track-900 text-slate-300">Select user</option>
                    {users.map((user) => (
                      <option key={`prediction-user-${user.id}`} value={user.id} className="bg-track-900 text-white">
                        {user.name} ({user.email})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-300">
                  Year
                  <select
                    className="mt-1 w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                    value={userPredictionYear}
                    onChange={(e) => setUserPredictionYear(e.target.value)}
                  >
                    {predictionYearOptions.map((year) => (
                      <option key={`user-prediction-year-${year}`} value={year} className="bg-track-900 text-white">
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-slate-100" onClick={exportUserPredictionsJson} disabled={!selectedUserPredictionUserId}>Export JSON</button>
              <button type="button" className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-slate-100" onClick={exportUserPredictionsCsv} disabled={!selectedUserPredictionUserId}>Export CSV</button>
            </div>

            <div>
              <input
                key={userPredictionBulkInputKey}
                type="file"
                accept=".json,.csv,application/json,text/csv"
                onChange={(e) => previewUserPredictionBulkFile(e.target.files?.[0])}
              />
              <p className="mt-2 text-xs text-slate-400">Import the exported JSON or CSV format for the selected user. You’ll get a preview of changed races, risk levels, and past-race warnings before any picks are overwritten.</p>
            </div>

            {userPredictionBulkFileName ? (
              <p className="text-xs text-slate-300">Previewing import file: {userPredictionBulkFileName}</p>
            ) : null}

            {userPredictionBulkPreview ? (
              <div className="space-y-3 rounded-xl border border-white/10 bg-track-900/40 p-3">
                <div className="grid gap-2 md:grid-cols-3">
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Changed Entries</p>
                    <p className="mt-2 text-xl font-semibold text-white">{userPredictionBulkPreview.summary.changedEntries}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Future By Default</p>
                    <p className="mt-2 text-xl font-semibold text-white">{userPredictionBulkPreview.summary.futureEntriesToApplyByDefault}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Past Warnings</p>
                    <p className="mt-2 text-xl font-semibold text-white">{userPredictionBulkPreview.summary.pastEntriesWithChanges}</p>
                  </div>
                </div>

                <div className="grid gap-2 md:grid-cols-3">
                  <p className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">Low risk: {userPredictionBulkPreview.summary.lowRiskChanges}</p>
                  <p className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">Medium risk: {userPredictionBulkPreview.summary.mediumRiskChanges}</p>
                  <p className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-100">High risk: {userPredictionBulkPreview.summary.highRiskChanges}</p>
                </div>

                <div className="space-y-2 max-h-72 overflow-y-auto rounded-lg border border-white/10 bg-white/5 p-3">
                  {userPredictionBulkPreview.races.filter((entry) => entry.changes.length > 0).map((entry) => (
                    <div key={`user-prediction-preview-${entry.raceId}-${entry.leagueId}`} className="rounded-lg border border-white/10 p-3">
                      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                        <p className="font-semibold text-slate-100">{entry.raceName} • {entry.leagueName}</p>
                        <p className={`text-xs font-semibold ${entry.riskLevel === "high" ? "text-red-300" : entry.riskLevel === "medium" ? "text-amber-300" : "text-emerald-300"}`}>
                          {entry.hasOccurred ? "Occurred race" : "Future race"} • {entry.riskLevel.toUpperCase()} risk
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{entry.raceDate ? new Date(entry.raceDate).toLocaleString() : "Unknown date"} • Status {entry.pickStatus}</p>
                      <ul className="mt-2 space-y-1 text-xs text-slate-300">
                        {entry.changes.slice(0, 6).map((change, idx) => (
                          <li key={`${entry.raceId}-${entry.leagueId}-${change.type}-${idx}`}>{change.summary}</li>
                        ))}
                        {entry.changes.length > 6 ? <li>...and {entry.changes.length - 6} more changes</li> : null}
                      </ul>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button type="button" className="tap rounded-xl bg-accent-cyan px-4 py-2 font-bold text-track-900" onClick={() => requestUserPredictionBulkImport(false)} disabled={userPredictionBulkPreview.summary.futureEntriesToApplyByDefault === 0}>Apply To Future Races</button>
                  <button type="button" className="tap rounded-xl border border-amber-300/40 px-4 py-2 font-bold text-amber-100" onClick={() => requestUserPredictionBulkImport(true)} disabled={userPredictionBulkPreview.summary.changedEntries === 0}>Apply Including Past Races</button>
                  <button type="button" className="tap rounded-xl border border-white/20 px-4 py-2 font-bold text-slate-200" onClick={() => clearUserPredictionBulkImport("User prediction import cancelled.")}>Cancel Import</button>
                </div>
              </div>
            ) : null}

            {userPredictionMessage ? <p className="text-accent-gold">{userPredictionMessage}</p> : null}

            {userPredictionDetail ? (
              <div className="rounded-xl border border-white/10 bg-track-900/30 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold text-slate-100">Current Saved Predictions</p>
                    <p className="mt-1 text-xs text-slate-400">{userPredictionDetail.user?.name} • {userPredictionDetail.races?.length || 0} race / league entries in {userPredictionYear}</p>
                  </div>
                </div>

                {userPredictionDetail.races?.length ? (
                  <div className="mt-3 space-y-3 max-h-[34rem] overflow-y-auto">
                    {userPredictionDetail.races.map((entry) => (
                      <div key={`user-prediction-entry-${entry.raceId}-${entry.leagueId}`} className="rounded-lg border border-white/10 bg-white/5 p-3">
                        <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="font-semibold text-slate-100">{entry.raceName}</p>
                            <p className="text-xs text-slate-400">{entry.leagueName} • {entry.raceDate ? new Date(entry.raceDate).toLocaleDateString() : "No race date"}</p>
                          </div>
                          <p className="text-xs font-semibold text-accent-gold">{entry.pickStatus}</p>
                        </div>
                        <div className="mt-3 overflow-x-auto">
                          <table className="min-w-[560px] text-xs text-slate-100">
                            <thead>
                              <tr className="border-b border-white/20">
                                <th className="px-2 py-2 text-left text-accent-cyan">Category</th>
                                <th className="px-2 py-2 text-left text-accent-cyan">Text Pick</th>
                                <th className="px-2 py-2 text-left text-accent-cyan">Numeric Pick</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(entry.picks || []).map((pick) => (
                                <tr key={`${entry.raceId}-${entry.leagueId}-${pick.categoryId}`} className="border-b border-white/10 last:border-0">
                                  <td className="px-2 py-2">{pick.categoryName}</td>
                                  <td className="px-2 py-2">{pick.valueText || "-"}</td>
                                  <td className="px-2 py-2">{pick.valueNumber ?? "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-400">No saved predictions found for this user in the selected year.</p>
                )}
              </div>
            ) : null}
          </div>

          {userMessage ? <p className="text-accent-gold">{userMessage}</p> : null}

          <div className="overflow-auto rounded-xl border border-white/10 bg-white/5 p-3">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Email</th>
                  <th className="pb-2">Role</th>
                  <th className="pb-2">Verified</th>
                  <th className="pb-2">Created</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="py-2">{editingUserId === u.id ? (
                      <input className="w-48 rounded border border-white/30 bg-white/10 p-1 text-white" value={editingUserForm.name} onChange={(e) => setEditingUserForm((s) => ({ ...s, name: e.target.value }))} />
                    ) : u.name}</td>
                    <td className="py-2">{editingUserId === u.id ? (
                      <input className="w-64 rounded border border-white/30 bg-white/10 p-1 text-white" value={editingUserForm.email} onChange={(e) => setEditingUserForm((s) => ({ ...s, email: e.target.value }))} />
                    ) : u.email}</td>
                    <td className="py-2">{u.role}</td>
                    <td className="py-2">{u.emailVerified ? "Yes" : "No"}</td>
                    <td className="py-2 text-xs text-slate-400">{u.created_at ? new Date(u.created_at).toLocaleDateString() : "-"}</td>
                    <td className="py-2">
                      {editingUserId === u.id ? (
                        <>
                          <button type="button" className="mr-2 tap rounded bg-accent-cyan px-2 py-1 text-sm" onClick={async () => {
                            try {
                              const payload = { name: editingUserForm.name, email: editingUserForm.email };
                              const updated = await apiFetch(`/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify(payload) });
                              setUsers((prev) => prev.map((row) => (row.id === u.id ? updated : row)));
                              setEditingUserId(null);
                              setEditingUserForm({ name: "", email: "" });
                              setUserMessage("User updated");
                            } catch (err) {
                              setUserMessage(String(err.message || err));
                            }
                          }}>Save</button>
                          <button type="button" className="tap rounded px-2 py-1 text-sm" onClick={() => { setEditingUserId(null); setEditingUserForm({ name: "", email: "" }); }}>Cancel</button>
                        </>
                      ) : (
                        <button type="button" className="tap rounded px-2 py-1 text-sm" onClick={() => { setEditingUserId(u.id); setEditingUserForm({ name: u.name, email: u.email }); }}>Edit</button>
                      )}
                      <select
                        className="ml-2 rounded border border-white/30 bg-white/10 px-2 py-1 text-sm text-white"
                        value={u.role}
                        onChange={(e) => updateUserRole(u.id, e.target.value)}
                      >
                        <option value="player" className="bg-track-900 text-white">player</option>
                        <option value="admin" className="bg-track-900 text-white">admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <BottomNav />

      {predictionBulkConfirmState.isOpen && predictionBulkPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-3xl rounded-3xl border border-white/15 bg-track-900 p-5 text-sm text-slate-200 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-2xl text-accent-cyan">Confirm Prediction Import</h3>
                <p className="mt-2 text-sm text-slate-300">
                  {predictionBulkConfirmState.includePastRaces
                    ? "This import includes races that have already happened. Review the summary before applying changes."
                    : "This import contains high-risk changes. Review the summary before applying future-race updates."}
                </p>
              </div>
              <button
                type="button"
                className="tap rounded-full border border-white/20 px-3 py-1 text-xs text-slate-300"
                onClick={() => setPredictionBulkConfirmState({ isOpen: false, includePastRaces: false })}
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Changed Races</p>
                <p className="mt-2 text-xl font-semibold text-white">{predictionBulkPreview.summary.changedRaces}</p>
              </div>
              <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/10 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">Low Risk</p>
                <p className="mt-2 text-xl font-semibold text-white">{predictionBulkPreview.summary.lowRiskChanges}</p>
              </div>
              <div className="rounded-xl border border-amber-400/15 bg-amber-500/10 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-amber-200">Medium Risk</p>
                <p className="mt-2 text-xl font-semibold text-white">{predictionBulkPreview.summary.mediumRiskChanges}</p>
              </div>
              <div className="rounded-xl border border-red-400/15 bg-red-500/10 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-red-200">High Risk</p>
                <p className="mt-2 text-xl font-semibold text-white">{predictionBulkPreview.summary.highRiskChanges}</p>
              </div>
            </div>

            <div className="mt-4 max-h-80 space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-white/5 p-3">
              {predictionBulkPreview.races.filter((raceRow) => raceRow.changes.length > 0).map((raceRow) => (
                <div key={`prediction-confirm-${raceRow.raceId}`} className="rounded-xl border border-white/10 p-3">
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <p className="font-semibold text-slate-100">{raceRow.raceName}</p>
                    <p className={`text-xs font-semibold ${raceRow.riskLevel === "high" ? "text-red-300" : raceRow.riskLevel === "medium" ? "text-amber-300" : "text-emerald-300"}`}>
                      {raceRow.hasOccurred ? "Occurred race" : "Future race"} • {raceRow.riskLevel.toUpperCase()} risk
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{new Date(raceRow.raceDate).toLocaleString()}</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-300">
                    {raceRow.changes.map((change, idx) => (
                      <li key={`${raceRow.raceId}-${change.type}-${idx}`}>{change.summary}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="tap rounded-xl border border-white/20 px-4 py-2 font-bold text-slate-200"
                onClick={() => setPredictionBulkConfirmState({ isOpen: false, includePastRaces: false })}
              >
                Back To Preview
              </button>
              <button
                type="button"
                className="tap rounded-xl border border-red-300/30 px-4 py-2 font-bold text-red-100"
                onClick={() => clearPredictionBulkImport("Prediction import cancelled.")}
              >
                Discard Import
              </button>
              <button
                type="button"
                className={`tap rounded-xl px-4 py-2 font-bold ${predictionBulkConfirmState.includePastRaces ? "bg-amber-500 text-track-900" : "bg-accent-cyan text-track-900"}`}
                onClick={() => runPredictionBulkImport(predictionBulkConfirmState.includePastRaces)}
              >
                {predictionBulkConfirmState.includePastRaces ? "Confirm Apply Including Past Races" : "Confirm Apply To Future Races"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {userPredictionConfirmState.isOpen && userPredictionBulkPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-3xl rounded-3xl border border-white/15 bg-track-900 p-5 text-sm text-slate-200 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-display text-2xl text-accent-cyan">Confirm User Prediction Import</h3>
                <p className="mt-2 text-sm text-slate-300">
                  {userPredictionConfirmState.includePastRaces
                    ? "This import includes races that have already happened. Review the summary before applying changes to this user's picks."
                    : "This import contains high-risk user pick changes. Review the summary before applying future-race updates."}
                </p>
              </div>
              <button
                type="button"
                className="tap rounded-full border border-white/20 px-3 py-1 text-xs text-slate-300"
                onClick={() => setUserPredictionConfirmState({ isOpen: false, includePastRaces: false })}
              >
                Close
              </button>
            </div>

            <div className="mt-4 grid gap-2 md:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Changed Entries</p>
                <p className="mt-2 text-xl font-semibold text-white">{userPredictionBulkPreview.summary.changedEntries}</p>
              </div>
              <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/10 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-emerald-200">Low Risk</p>
                <p className="mt-2 text-xl font-semibold text-white">{userPredictionBulkPreview.summary.lowRiskChanges}</p>
              </div>
              <div className="rounded-xl border border-amber-400/15 bg-amber-500/10 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-amber-200">Medium Risk</p>
                <p className="mt-2 text-xl font-semibold text-white">{userPredictionBulkPreview.summary.mediumRiskChanges}</p>
              </div>
              <div className="rounded-xl border border-red-400/15 bg-red-500/10 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-red-200">High Risk</p>
                <p className="mt-2 text-xl font-semibold text-white">{userPredictionBulkPreview.summary.highRiskChanges}</p>
              </div>
            </div>

            <div className="mt-4 max-h-80 space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-white/5 p-3">
              {userPredictionBulkPreview.races.filter((entry) => entry.changes.length > 0).map((entry) => (
                <div key={`user-prediction-confirm-${entry.raceId}-${entry.leagueId}`} className="rounded-xl border border-white/10 p-3">
                  <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                    <p className="font-semibold text-slate-100">{entry.raceName} • {entry.leagueName}</p>
                    <p className={`text-xs font-semibold ${entry.riskLevel === "high" ? "text-red-300" : entry.riskLevel === "medium" ? "text-amber-300" : "text-emerald-300"}`}>
                      {entry.hasOccurred ? "Occurred race" : "Future race"} • {entry.riskLevel.toUpperCase()} risk
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{entry.raceDate ? new Date(entry.raceDate).toLocaleString() : "Unknown date"} • Status {entry.pickStatus}</p>
                  <ul className="mt-2 space-y-1 text-xs text-slate-300">
                    {entry.changes.map((change, idx) => (
                      <li key={`${entry.raceId}-${entry.leagueId}-${change.type}-${idx}`}>{change.summary}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="tap rounded-xl border border-white/20 px-4 py-2 font-bold text-slate-200"
                onClick={() => setUserPredictionConfirmState({ isOpen: false, includePastRaces: false })}
              >
                Back To Preview
              </button>
              <button
                type="button"
                className="tap rounded-xl border border-red-300/30 px-4 py-2 font-bold text-red-100"
                onClick={() => clearUserPredictionBulkImport("User prediction import cancelled.")}
              >
                Discard Import
              </button>
              <button
                type="button"
                className={`tap rounded-xl px-4 py-2 font-bold ${userPredictionConfirmState.includePastRaces ? "bg-amber-500 text-track-900" : "bg-accent-cyan text-track-900"}`}
                onClick={() => runUserPredictionBulkImport(userPredictionConfirmState.includePastRaces)}
              >
                {userPredictionConfirmState.includePastRaces ? "Confirm Apply Including Past Races" : "Confirm Apply To Future Races"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
