import { config } from "../config.js";

import AppSetting from "../models/AppSetting.js";
import { connectMongo } from "../mongo.js";

const PICK_LOCK_KEY = "pick_lock_minutes_before_deadline";
const JOLPICA_SYNC_STATUS_KEY = "jolpica_sync_status";
const MEDIA_OVERRIDES_KEY = "f1_media_overrides";
const MEDIA_OVERRIDE_TYPES = ["drivers", "teams", "races"];

async function getSettingDoc(settingKey) {
  await connectMongo();
  return AppSetting.findOne({ setting_key: settingKey }).lean().exec();
}

async function setSettingDoc(settingKey, value) {
  await connectMongo();
  return AppSetting.findOneAndUpdate(
    { setting_key: settingKey },
    { setting_value: value, updated_at: new Date() },
    { upsert: true, new: true }
  ).lean().exec();
}

export async function getJsonSetting(settingKey, fallback = null) {
  try {
    const doc = await getSettingDoc(settingKey);
    if (!doc?.setting_value) return fallback;
    return JSON.parse(doc.setting_value);
  } catch (err) {
    return fallback;
  }
}

export async function setJsonSetting(settingKey, value) {
  const updated = await setSettingDoc(settingKey, JSON.stringify(value));
  return { key: updated.setting_key, value, updatedAt: updated.updated_at };
}

export async function getJolpicaSyncStatus() {
  return getJsonSetting(JOLPICA_SYNC_STATUS_KEY, {
    lastRunStartedAt: null,
    lastRunFinishedAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: "",
    lastMode: null,
    isRunning: false,
    summary: null,
    updatedAt: null
  });
}

export async function setJolpicaSyncStatus(patch) {
  const current = await getJolpicaSyncStatus();
  const nextValue = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  await setJsonSetting(JOLPICA_SYNC_STATUS_KEY, nextValue);
  return nextValue;
}

export function normalizePickLockMinutes(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 0 || parsed > 180) return null;
  return parsed;
}

export async function getPickLockMinutesBeforeDeadline() {
  try {
    const doc = await getSettingDoc(PICK_LOCK_KEY);
    if (!doc) return config.pickLockMinutesBeforeDeadline;
    const saved = normalizePickLockMinutes(doc.setting_value);
    return saved ?? config.pickLockMinutesBeforeDeadline;
  } catch (err) {
    // fallback to config/default if mongo not available
    return config.pickLockMinutesBeforeDeadline;
  }
}

export async function setPickLockMinutesBeforeDeadline(minutes) {
  const normalized = normalizePickLockMinutes(minutes);
  if (normalized === null) {
    throw new Error("PICK_LOCK_MINUTES_BEFORE_DEADLINE must be an integer from 0 to 180");
  }

  try {
    const updated = await setSettingDoc(PICK_LOCK_KEY, String(normalized));

    return { key: updated.setting_key, value: Number(updated.setting_value), updatedAt: updated.updated_at };
  } catch (err) {
    throw err;
  }
}

function emptyMediaOverrides() {
  return {
    drivers: {},
    teams: {},
    races: {}
  };
}

function normalizeMediaOverrideType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "driver") return "drivers";
  if (normalized === "team") return "teams";
  if (normalized === "race") return "races";
  return MEDIA_OVERRIDE_TYPES.includes(normalized) ? normalized : null;
}

function normalizeMediaOverrideEntry(entityId, entry) {
  if (!entry || typeof entry !== "object") return null;
  const imageUrl = String(entry.imageUrl || "").trim();
  if (!imageUrl) return null;

  return {
    entityId: String(entityId || entry.entityId || "").trim(),
    imageUrl,
    alt: String(entry.alt || "").trim(),
    label: String(entry.label || "").trim(),
    fileName: String(entry.fileName || "").trim(),
    mimeType: String(entry.mimeType || "").trim(),
    updatedAt: entry.updatedAt || null
  };
}

function normalizeMediaOverrides(value) {
  const fallback = emptyMediaOverrides();
  if (!value || typeof value !== "object") return fallback;

  MEDIA_OVERRIDE_TYPES.forEach((type) => {
    const source = value[type];
    if (!source || typeof source !== "object") return;

    Object.entries(source).forEach(([entityId, entry]) => {
      const normalizedEntry = normalizeMediaOverrideEntry(entityId, entry);
      if (!normalizedEntry?.entityId) return;
      fallback[type][normalizedEntry.entityId] = normalizedEntry;
    });
  });

  return fallback;
}

export async function getMediaOverrides() {
  const saved = await getJsonSetting(MEDIA_OVERRIDES_KEY, emptyMediaOverrides());
  return normalizeMediaOverrides(saved);
}

export async function upsertMediaOverride({ entityType, entityId, imageUrl, alt = "", label = "", fileName = "", mimeType = "" }) {
  const normalizedType = normalizeMediaOverrideType(entityType);
  const normalizedId = String(entityId || "").trim();
  if (!normalizedType) {
    throw new Error("Invalid media override type");
  }
  if (!normalizedId) {
    throw new Error("Media override entity id is required");
  }

  const overrides = await getMediaOverrides();
  overrides[normalizedType][normalizedId] = {
    entityId: normalizedId,
    imageUrl: String(imageUrl || "").trim(),
    alt: String(alt || "").trim(),
    label: String(label || "").trim(),
    fileName: String(fileName || "").trim(),
    mimeType: String(mimeType || "").trim(),
    updatedAt: new Date().toISOString()
  };

  await setJsonSetting(MEDIA_OVERRIDES_KEY, overrides);
  return overrides;
}

export async function deleteMediaOverride(entityType, entityId) {
  const normalizedType = normalizeMediaOverrideType(entityType);
  const normalizedId = String(entityId || "").trim();
  if (!normalizedType) {
    throw new Error("Invalid media override type");
  }
  if (!normalizedId) {
    throw new Error("Media override entity id is required");
  }

  const overrides = await getMediaOverrides();
  delete overrides[normalizedType][normalizedId];
  await setJsonSetting(MEDIA_OVERRIDES_KEY, overrides);
  return overrides;
}
