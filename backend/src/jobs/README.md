# Reminder Job

Use a scheduler (Railway cron, Supabase scheduled function, or GitHub Actions) to call:

POST /api/notifications/send-deadline-reminders/:raceId

Recommended cadence:
- 24h before deadline
- 2h before deadline

In production, replace placeholder logic with a push provider implementation such as `web-push` and VAPID keys.
