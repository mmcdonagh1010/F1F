import { config } from "../config.js";

import AppSetting from "../models/AppSetting.js";
import { connectMongo } from "../mongo.js";

const PICK_LOCK_KEY = "pick_lock_minutes_before_deadline";
const JOLPICA_SYNC_STATUS_KEY = "jolpica_sync_status";

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
