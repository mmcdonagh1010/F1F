# Fantasy F1 Picks League

Mobile-first Fantasy Formula 1 picks application for private leagues.

## Stack
- Frontend: Next.js + Tailwind CSS + PWA (`frontend/`)
- Backend: Node.js + Express + JWT (`backend/`)
- Database: PostgreSQL schema in `backend/src/sql/schema.sql`

## Quick Start

### 1. Backend
```bash
cd backend
npm install
cp .env.example .env
npm run db:schema
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
- Pick lock window setting (`PICK_LOCK_MINUTES_BEFORE_DEADLINE`) from UI
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
