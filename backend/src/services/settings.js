import { config } from "../config.js";

import AppSetting from "../models/AppSetting.js";
import { connectMongo } from "../mongo.js";

const PICK_LOCK_KEY = "pick_lock_minutes_before_deadline";

export function normalizePickLockMinutes(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 0 || parsed > 180) return null;
  return parsed;
}

export async function getPickLockMinutesBeforeDeadline() {
  try {
    await connectMongo();
    const doc = await AppSetting.findOne({ setting_key: PICK_LOCK_KEY }).lean().exec();
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
    await connectMongo();
    const updated = await AppSetting.findOneAndUpdate(
      { setting_key: PICK_LOCK_KEY },
      { setting_value: String(normalized), updated_at: new Date() },
      { upsert: true, new: true }
    ).lean().exec();

    return { key: updated.setting_key, value: Number(updated.setting_value), updatedAt: updated.updated_at };
  } catch (err) {
    throw err;
  }
}
