# turn1carnage

Mobile-first Formula 1 picks application for private leagues under the turn1carnage brand.

## Stack
- Frontend: Next.js + Tailwind CSS + PWA (`frontend/`)
- Backend: Node.js + Express + JWT (`backend/`)
- Database: MongoDB (PostgreSQL is no longer used; a one-time migration script exists for legacy data)

## Quick Start

### 1. Backend
```bash
cd backend
npm install
cp .env.example .env
# configure MONGODB_URI or MONGO_URI_DEV in .env
# if you're still running Postgres and want to migrate existing data:
#   npm run db:migrate
npm run dev
```

### 2. Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Frontend runs at `http://localhost:3000` and backend runs at `http://localhost:4000`.

## Utility Scripts

> **Note:** PostgreSQL has been retired. The following database scripts are
> provided only to help migrate existing Postgres data into MongoDB; they are
> not required for new deployments.



### Database migrations

- `npm run db:schema`  (legacy Postgres schema runner, no-op in Mongo world)
- `npm run db:migrate`  perform a one‑time data migration from a running Postgres
  instance (requires `DATABASE_URL` pointing at your Postgres server).



From the repository root:

```powershell
./scripts/seed-demo.ps1
```

Creates a demo admin, league, race, and default categories for local demos.

```powershell
./scripts/verify-admin-flow.ps1
```

Runs an end-to-end admin flow check using only public API endpoints.

## Admin Dashboard Highlights

The Admin Dashboard now supports:
- League creation with generated invite codes
- League member listing
- API sync for races/drivers and latest race results
- Manual race weekend creation if API is unavailable
- Driver management per race (add/remove/edit `name` + `team`)
- Bulk JSON upload for races, drivers, and results
- Pick deadline offset setting (`PICK_LOCK_MINUTES_BEFORE_DEADLINE`) from UI
- Prediction categories with custom position slots (example: `P1,P2,P3,P9,P10,P11`)

### Bulk Upload JSON Examples

Bulk races payload:
```json
{
	"races": [
		{
			"leagueId": "<league-uuid>",
			"name": "Australian Grand Prix",
			"circuitName": "Albert Park",
			"externalRound": 1,
			"raceDate": "2026-03-15T04:00:00Z",
			"deadlineAt": "2026-03-14T03:00:00Z",
			"hasSprintWeekend": false,
			"predictionOptions": ["raceQualification", "racePositions", "fastestLapDriver"],
			"positionSlots": [1, 2, 3, 9, 10, 11],
			"drivers": [{ "name": "Lando Norris", "teamName": "McLaren" }]
		}
	]
}
```

Bulk drivers payload:
```json
{
	"uploads": [
		{
			"raceId": "<race-uuid>",
			"drivers": [
				{ "name": "Max Verstappen", "teamName": "Red Bull" },
				{ "name": "Charles Leclerc", "teamName": "Ferrari" }
			]
		}
	]
}
```

Bulk results payload:
```json
{
	"uploads": [
		{
			"raceId": "<race-uuid>",
			"tieBreakerValue": "1:31:44.000",
			"results": [
				{ "categoryName": "Race Result P1", "valueText": "Lando Norris" },
				{ "categoryName": "Fastest Lap Driver", "valueText": "Charles Leclerc" }
			]
		}
	]
}
```

## Product Blueprint
See `docs/PRODUCT_BLUEPRINT.md` for:
- architecture diagram
- database schema
- endpoint catalog
- UI page structure
- build and deployment guide
- security and scaling strategy

## AI Issue To PR Automation

The repo now includes GitHub Actions automation that can turn labeled GitHub issues into reviewable pull requests.

- Label an issue with `ai-fix` to trigger the AI issue workflow.
- The workflow reads the issue, runs an AI coding agent, validates the generated changes, and opens a PR.
- Every PR is validated again before merge.

Setup details are in `docs/AI_ISSUE_AUTOMATION.md`.

## Production URLs & Deployment Environment Variables

When running in production, set the following environment variables.

- **Frontend production URL**: FRONTEND_URL_PROD = https://teal-ganache-11922e.netlify.app
- **Backend production URL**: BACKEND_URL_PROD = https://f1-fantasy-league-backend.onrender.com

Backend env examples (set via your host's env UI):

Email delivery:

- `EMAIL_PROVIDER=resend`
- `EMAIL_FROM=Fantasy F1 <onboarding@resend.dev>` for initial testing, then switch to a verified sending domain
- `RESEND_API_KEY=<your resend api key>`
- Optional: `EMAIL_REPLY_TO=support@your-domain.com`
- Optional: `EMAIL_PREVIEW_FALLBACK=false` in staging/production so missing email config fails fast instead of falling back to preview links

Security notes:

- Verification and reset tokens are random 32-byte values and only stored hashed in MongoDB.
- Delivery uses Resend's HTTPS API; no SMTP credentials are embedded in links or returned to clients.
- Verification links expire after 24 hours; password reset links expire after 1 hour.
- Login still blocks unverified users, and forgot-password keeps user enumeration-resistant responses.

### Removing PostgreSQL dependencies

Once you've migrated your data and no longer need Postgres support, remove the
`pg` package and any related tooling:

```bash
cd backend
npm uninstall pg
rm -rf src/sql
# also remove "DATABASE_URL" from backend/.env (and any other Postgres
# configuration) so the application no longer attempts to load it
```



```
FRONTEND_URL_PROD=https://teal-ganache-11922e.netlify.app
BACKEND_URL_PROD=https://f1-fantasy-league-backend.onrender.com
DEBUG=false
```

Frontend env examples (Next.js - set build-time vars):

```
NEXT_PUBLIC_API_BASE_PROD=https://f1-fantasy-league-backend.onrender.com/api
NEXT_PUBLIC_DEBUG=false
```

Notes:
- On Netlify/Vercel, add `NEXT_PUBLIC_*` vars in the project settings and trigger a rebuild after changes.
- On Render/Railway, add backend `FRONTEND_URL_PROD` and `BACKEND_URL_PROD` in the service's environment settings.
- The backend CORS is configured to allow both debug and production frontend origins; restrict to production origin in production if desired.
