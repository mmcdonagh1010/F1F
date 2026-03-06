import express from "express";
import crypto from "crypto";
import { query } from "../db.js";
import { authRequired, adminRequired } from "../middleware/auth.js";
import { calculateRaceScores } from "../services/scoring.js";
import { syncLatestRaceResultsFromJolpica, syncSeasonFromJolpica } from "../services/jolpicaSync.js";
import { config } from "../config.js";
import {
  getPickLockMinutesBeforeDeadline,
  normalizePickLockMinutes,
  setPickLockMinutesBeforeDeadline
} from "../services/settings.js";

const router = express.Router();

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

function buildRaceCategories(
  predictionOptions = [],
  hasSprintWeekend = false,
  positionSlots = [],
  positionSlotsByOption = {},
  pointOverrides = {}
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

      return {
        ...preset,
        exactPoints: points.exactPoints,
        partialPoints: points.partialPoints,
        displayOrder: idx + 1
      };
    });
}

function isTeamBattleMarginCategory(categoryName) {
  const normalized = categoryName.toLowerCase();
  return normalized.includes("team battle") && normalized.includes("margin");
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
  if (category.is_position_based) return true;
  if (/\bp\d+\b/i.test(normalized)) return true;

  return ["driver", "winner", "pole", "fastest lap", "qualification", "result"].some((token) =>
    normalized.includes(token)
  );
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
    pointOverrides
  } = payload;

  const roundValue = externalRound ? Number(externalRound) : null;
  if (externalRound && (!Number.isInteger(roundValue) || roundValue < 1 || roundValue > 30)) {
    throw new Error("externalRound must be an integer from 1 to 30");
  }

  const allLeagues = await query("SELECT id FROM leagues ORDER BY created_at ASC");
  const allLeagueIds = allLeagues.rows.map((row) => row.id);
  if (allLeagueIds.length === 0) {
    throw new Error("Create at least one league before creating a race");
  }

  let assignedLeagueIds = [];
  if (Array.isArray(leagueIds) && leagueIds.length > 0) {
    const unique = [...new Set(leagueIds.map((id) => String(id).trim()).filter(Boolean))];
    assignedLeagueIds = unique.filter((id) => allLeagueIds.includes(id));
  } else if (applyToAllLeagues !== false) {
    assignedLeagueIds = allLeagueIds;
  } else if (leagueId) {
    assignedLeagueIds = allLeagueIds.includes(leagueId) ? [leagueId] : [];
  }

  if (assignedLeagueIds.length === 0) {
    throw new Error("Select at least one valid league for this race");
  }

  const primaryLeagueId = assignedLeagueIds[0];

  const created = await query(
    `INSERT INTO races (league_id, name, circuit_name, external_round, race_date, deadline_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [primaryLeagueId, name, circuitName, roundValue, raceDate, deadlineAt]
  );

  const race = created.rows[0];
  const categories = buildRaceCategories(
    predictionOptions,
    Boolean(hasSprintWeekend),
    positionSlots,
    positionSlotsByOption && typeof positionSlotsByOption === "object" ? positionSlotsByOption : {},
    pointOverrides && typeof pointOverrides === "object" ? pointOverrides : {}
  );
  const raceDrivers = normalizeDriverRows(drivers);

  for (const category of categories) {
    await query(
      `INSERT INTO pick_categories
       (race_id, name, display_order, is_position_based, exact_points, partial_points)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        race.id,
        category.name,
        category.displayOrder,
        Boolean(category.isPositionBased),
        category.exactPoints,
        category.partialPoints || 0
      ]
    );
  }

  for (const assignedLeagueId of assignedLeagueIds) {
    await query(
      `INSERT INTO race_leagues (race_id, league_id)
       VALUES ($1, $2)
       ON CONFLICT (race_id, league_id) DO NOTHING`,
      [race.id, assignedLeagueId]
    );
  }

  for (let i = 0; i < raceDrivers.length; i += 1) {
    await query(
      `INSERT INTO race_drivers (race_id, driver_name, team_name, metadata, display_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (race_id, driver_name) DO NOTHING`,
      [race.id, raceDrivers[i].name, raceDrivers[i].teamName, raceDrivers[i].metadata, i + 1]
    );
  }

  return {
    ...race,
    assignedLeagueIds,
    categoriesCreated: categories.length,
    driversCreated: raceDrivers.length
  };
}

router.post("/bootstrap/promote-admin", async (req, res) => {
  const { email, bootstrapKey } = req.body;

  if (!config.bootstrapAdminKey) {
    return res.status(503).json({ error: "Bootstrap key is not configured" });
  }

  if (!email || bootstrapKey !== config.bootstrapAdminKey) {
    return res.status(401).json({ error: "Invalid bootstrap credentials" });
  }

  const updated = await query(
    `UPDATE users
     SET role = 'admin'
     WHERE email = $1
     RETURNING id, name, email, role`,
    [email]
  );

  if (updated.rowCount === 0) {
    return res.status(404).json({ error: "User not found. Register first." });
  }

  return res.json({ message: "User promoted to admin", user: updated.rows[0] });
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
    message: "Pick lock window updated",
    setting: {
      key: "PICK_LOCK_MINUTES_BEFORE_DEADLINE",
      value: updated.value,
      updatedAt: updated.updatedAt
    }
  });
});

router.post("/leagues", async (req, res) => {
  const { name, inviteCode } = req.body;
  if (!name) {
    return res.status(400).json({ error: "League name is required" });
  }

  const finalInviteCode = String(inviteCode || generateInviteCode()).trim().toUpperCase();
  if (!finalInviteCode) {
    return res.status(400).json({ error: "Invite code is required" });
  }

  const created = await query(
    `INSERT INTO leagues (name, invite_code)
     VALUES ($1, $2)
     RETURNING *`,
    [name, finalInviteCode]
  );

  await query(
    `INSERT INTO league_members (league_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [created.rows[0].id, req.user.id]
  );

  return res.status(201).json(created.rows[0]);
});

router.get("/leagues", async (_req, res) => {
  const leagues = await query(
    `SELECT l.id, l.name, l.invite_code, l.created_at,
            COUNT(lm.user_id)::int AS member_count
     FROM leagues l
     LEFT JOIN league_members lm ON lm.league_id = l.id
     GROUP BY l.id
     ORDER BY l.created_at DESC`
  );
  return res.json(leagues.rows);
});

router.get("/leagues/:leagueId/members", async (req, res) => {
  const { leagueId } = req.params;
  const league = await query("SELECT id, name, invite_code FROM leagues WHERE id = $1", [leagueId]);
  if (league.rowCount === 0) {
    return res.status(404).json({ error: "League not found" });
  }

  const members = await query(
    `SELECT u.id, u.name, u.email, u.role, lm.joined_at
     FROM league_members lm
     JOIN users u ON u.id = lm.user_id
     WHERE lm.league_id = $1
     ORDER BY lm.joined_at ASC`,
    [leagueId]
  );

  return res.json({
    league: league.rows[0],
    members: members.rows
  });
});

router.post("/sync/jolpica", async (req, res) => {
  try {
    const { leagueId, season } = req.body;

    const chosenSeason = Number(season || new Date().getUTCFullYear());
    if (!Number.isInteger(chosenSeason) || chosenSeason < 1950 || chosenSeason > 2100) {
      return res.status(400).json({ error: "Invalid season" });
    }

    if (leagueId) {
      const league = await query("SELECT id FROM leagues WHERE id = $1", [leagueId]);
      if (league.rowCount === 0) {
        return res.status(404).json({ error: "League not found" });
      }
    }

    const summary = await syncSeasonFromJolpica({ leagueId, season: chosenSeason });
    return res.json({ message: "Jolpica sync completed", ...summary });
  } catch (error) {
    console.error("Jolpica sync failed", error);
    return res.status(502).json({ error: "Failed to sync with Jolpica API" });
  }
});

router.post("/sync/jolpica/latest-results", async (req, res) => {
  try {
    const { leagueId, season } = req.body;
    if (!leagueId) {
      return res.status(400).json({ error: "leagueId is required" });
    }

    const league = await query("SELECT id FROM leagues WHERE id = $1", [leagueId]);
    if (league.rowCount === 0) {
      return res.status(404).json({ error: "League not found" });
    }

    const summary = await syncLatestRaceResultsFromJolpica({ leagueId, season });
    return res.json({ message: "Latest race result sync completed", ...summary });
  } catch (error) {
    console.error("Latest result sync failed", error);
    return res.status(502).json({ error: "Failed to sync latest results from Jolpica API" });
  }
});

router.post("/races", async (req, res) => {
  try {
    const created = await createRaceWeekend(req.body || {});
    return res.status(201).json(created);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Failed to create race" });
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

  await query("DELETE FROM race_drivers WHERE race_id = $1", [raceId]);

  for (let i = 0; i < cleanDrivers.length; i += 1) {
    await query(
      `INSERT INTO race_drivers (race_id, driver_name, team_name, metadata, display_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [raceId, cleanDrivers[i].name, cleanDrivers[i].teamName, cleanDrivers[i].metadata, i + 1]
    );
  }

  return res.json({ message: "Race drivers updated", count: cleanDrivers.length });
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

      await query("DELETE FROM race_drivers WHERE race_id = $1", [item.raceId]);
      for (let i = 0; i < cleanDrivers.length; i += 1) {
        await query(
          `INSERT INTO race_drivers (race_id, driver_name, team_name, metadata, display_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [item.raceId, cleanDrivers[i].name, cleanDrivers[i].teamName, cleanDrivers[i].metadata, i + 1]
        );
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

      const categoryRes = await query(
        `SELECT id, name
         FROM pick_categories
         WHERE race_id = $1`,
        [item.raceId]
      );
      const categoryIdByName = new Map(categoryRes.rows.map((row) => [row.name.toLowerCase(), row.id]));

      await query("DELETE FROM results WHERE race_id = $1", [item.raceId]);

      for (const result of item.results) {
        const categoryName = String(result.categoryName || "").trim().toLowerCase();
        const categoryId = categoryIdByName.get(categoryName);
        if (!categoryId) {
          throw new Error(`Unknown categoryName '${result.categoryName}' for race ${item.raceId}`);
        }

        await query(
          `INSERT INTO results (race_id, category_id, value_text, value_number)
           VALUES ($1, $2, $3, $4)`,
          [item.raceId, categoryId, result.valueText || null, result.valueNumber ?? null]
        );
      }

      await query(
        `UPDATE races
         SET status = 'completed', tie_breaker_value = $2
         WHERE id = $1`,
        [item.raceId, item.tieBreakerValue || null]
      );

      await calculateRaceScores(item.raceId);
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

  const updated = await query(
    `UPDATE races
     SET is_visible = $2
     WHERE id = $1
     RETURNING id, name, is_visible`,
    [raceId, isVisible]
  );

  if (updated.rowCount === 0) {
    return res.status(404).json({ error: "Race not found" });
  }

  return res.json({ message: "Race visibility updated", race: updated.rows[0] });
});

router.post("/races/:raceId/categories", async (req, res) => {
  const { raceId } = req.params;
  const { categories } = req.body;

  await query("DELETE FROM pick_categories WHERE race_id = $1", [raceId]);

  for (const category of categories) {
    await query(
      `INSERT INTO pick_categories
       (race_id, name, display_order, is_position_based, exact_points, partial_points)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        raceId,
        category.name,
        category.displayOrder,
        Boolean(category.isPositionBased),
        category.exactPoints,
        category.partialPoints || 0
      ]
    );
  }

  return res.json({ message: "Categories updated" });
});

router.post("/races/:raceId/results", async (req, res) => {
  const { raceId } = req.params;
  const { results, tieBreakerValue } = req.body;

  const driversRes = await query(
    `SELECT driver_name, team_name
     FROM race_drivers
     WHERE race_id = $1`,
    [raceId]
  );
  const validDrivers = new Set(driversRes.rows.map((row) => row.driver_name.toLowerCase()));
  const validTeams = new Set(
    driversRes.rows
      .map((row) => String(row.team_name || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const allowedMarginBands = new Set(["1-2", "3-4", "5+"]);

  const categoriesForRaceRes = await query(
    `SELECT id, name
     FROM pick_categories
     WHERE race_id = $1`,
    [raceId]
  );
  const categoriesById = new Map(categoriesForRaceRes.rows.map((row) => [row.id, row]));
  const teamCategoryResult = (Array.isArray(results) ? results : []).find((item) => {
    const cat = categoriesById.get(item.categoryId);
    return cat ? isTeamOfWeekendCategory(cat.name) : false;
  });
  const selectedTeamOfWeekend = String(teamCategoryResult?.valueText || "").trim().toLowerCase();

  await query("DELETE FROM results WHERE race_id = $1", [raceId]);

  for (const result of results) {
    const category = categoriesById.get(result.categoryId);
    if (!category) {
      return res.status(400).json({ error: `Invalid category for race: ${result.categoryId}` });
    }

    if (isDriverSelectionCategory(category)) {
      const selectedDriver = String(result.valueText || "").trim().toLowerCase();
      if (!selectedDriver || !validDrivers.has(selectedDriver)) {
        return res.status(400).json({
          error: `Result for '${category.name}' must be selected from the race driver list`
        });
      }
    }

    if (isTeamBattleMarginCategory(category.name)) {
      const selectedBand = String(result.valueText || "").trim();
      if (!allowedMarginBands.has(selectedBand)) {
        return res.status(400).json({
          error: "Team Battle Winning Margin must be one of: 1-2, 3-4, 5+"
        });
      }
    }

    if (isTeamOfWeekendCategory(category.name)) {
      const team = String(result.valueText || "").trim().toLowerCase();
      if (!team || !validTeams.has(team)) {
        return res.status(400).json({
          error: "Team of the Weekend must match one of the race teams"
        });
      }
    }

    if (isTeamBattleDriverCategory(category.name) && selectedTeamOfWeekend) {
      const selectedDriver = String(result.valueText || "").trim().toLowerCase();
      const allowedTeamDrivers = new Set(
        driversRes.rows
          .filter((row) => String(row.team_name || "").trim().toLowerCase() === selectedTeamOfWeekend)
          .map((row) => row.driver_name.toLowerCase())
      );

      if (!allowedTeamDrivers.has(selectedDriver)) {
        return res.status(400).json({
          error: "Team Battle Winner (Driver) must belong to Team of the Weekend"
        });
      }
    }

    await query(
      `INSERT INTO results (race_id, category_id, value_text, value_number)
       VALUES ($1, $2, $3, $4)`,
      [raceId, result.categoryId, result.valueText || null, result.valueNumber ?? null]
    );
  }

  await query(
    `UPDATE races
     SET status = 'completed', tie_breaker_value = $2
     WHERE id = $1`,
    [raceId, tieBreakerValue || null]
  );

  const scored = await calculateRaceScores(raceId);
  return res.json({ message: "Results saved and scores calculated", scored });
});

router.get("/users", async (_req, res) => {
  const users = await query("SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC");
  return res.json(users.rows);
});

router.patch("/users/:userId/role", async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body;
  if (!["player", "admin"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  const updated = await query(
    "UPDATE users SET role = $2 WHERE id = $1 RETURNING id, name, email, role",
    [userId, role]
  );

  if (updated.rowCount === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.json(updated.rows[0]);
});

router.post("/races/:raceId/score", async (req, res) => {
  const scored = await calculateRaceScores(req.params.raceId);
  return res.json({ message: "Scores recalculated", scored });
});

export default router;
