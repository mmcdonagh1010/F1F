import { query } from "../db.js";
import { config } from "../config.js";

const PICK_LOCK_KEY = "pick_lock_minutes_before_deadline";

export function normalizePickLockMinutes(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 0 || parsed > 180) return null;
  return parsed;
}

export async function getPickLockMinutesBeforeDeadline() {
  const result = await query(
    `SELECT setting_value
     FROM app_settings
     WHERE setting_key = $1`,
    [PICK_LOCK_KEY]
  );

  if (result.rowCount === 0) {
    return config.pickLockMinutesBeforeDeadline;
  }

  const saved = normalizePickLockMinutes(result.rows[0].setting_value);
  return saved ?? config.pickLockMinutesBeforeDeadline;
}

export async function setPickLockMinutesBeforeDeadline(minutes) {
  const normalized = normalizePickLockMinutes(minutes);
  if (normalized === null) {
    throw new Error("PICK_LOCK_MINUTES_BEFORE_DEADLINE must be an integer from 0 to 180");
  }

  const updated = await query(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES ($1, $2)
     ON CONFLICT (setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value,
                   updated_at = NOW()
     RETURNING setting_key, setting_value, updated_at`,
    [PICK_LOCK_KEY, String(normalized)]
  );

  return {
    key: updated.rows[0].setting_key,
    value: Number(updated.rows[0].setting_value),
    updatedAt: updated.rows[0].updated_at
  };
}
