# Reminder Job

Use a scheduler (Railway cron, Supabase scheduled function, or GitHub Actions) to call:

POST /api/notifications/send-deadline-reminders/:raceId

Recommended cadence:
- 24h before deadline
- 2h before deadline

In production, replace placeholder logic with a push provider implementation such as `web-push` and VAPID keys.

Jolpica Auto Sync

The backend now starts a built-in polling job for free Jolpica data.

Environment variables:
- `JOLPICA_AUTO_SYNC_ENABLED=true`
- `JOLPICA_AUTO_SYNC_INTERVAL_MS=900000`
- `JOLPICA_AUTO_SYNC_SEASON=2026`

Behavior:
- refreshes the current season race calendar into local `races`
- syncs completed Jolpica weekends into local `results`
- recalculates `scores` for updated races
