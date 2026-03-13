import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectMongo } from '../src/mongo.js';
import User from '../src/models/User.js';
import League from '../src/models/League.js';
import LeagueMember from '../src/models/LeagueMember.js';
import Race from '../src/models/Race.js';
import RaceDriver from '../src/models/RaceDriver.js';
import PickCategory from '../src/models/PickCategory.js';
import Pick from '../src/models/Pick.js';
import Result from '../src/models/Result.js';
import Score from '../src/models/Score.js';
import { syncCompletedRaceResultsFromJolpica } from '../src/services/jolpicaSync.js';
import { getLockDeadlineAt } from '../src/services/raceDeadline.js';
import { getPickLockMinutesBeforeDeadline } from '../src/services/settings.js';

const SEASON = 2026;
const JOLPICA_BASE = 'https://api.jolpi.ca/ergast/f1';
const LEAGUE_NAME = 'F12026';
const LEAGUE_INVITE_CODE = 'F12026';
const DEFAULT_PASSWORD = process.env.SEED_TEST_USER_PASSWORD || 'Password123!';

const TEST_USERS = [
  { name: 'Ava Quinn', email: 'ava.f12026@example.com' },
  { name: 'Ben Carter', email: 'ben.f12026@example.com' },
  { name: 'Chloe Byrne', email: 'chloe.f12026@example.com' },
  { name: 'Dylan Walsh', email: 'dylan.f12026@example.com' },
  { name: 'Erin Doyle', email: 'erin.f12026@example.com' }
];

const DRIVERS = [
  { name: 'Pierre Gasly', teamName: 'Alpine-Mercedes' },
  { name: 'Franco Colapinto', teamName: 'Alpine-Mercedes' },
  { name: 'Fernando Alonso', teamName: 'Aston Martin Aramco-Honda' },
  { name: 'Lance Stroll', teamName: 'Aston Martin Aramco-Honda' },
  { name: 'Alexander Albon', teamName: 'Atlassian Williams-Mercedes' },
  { name: 'Carlos Sainz Jr.', teamName: 'Atlassian Williams-Mercedes' },
  { name: 'Gabriel Bortoleto', teamName: 'Audi' },
  { name: 'Nico Hulkenberg', teamName: 'Audi' },
  { name: 'Sergio Perez', teamName: 'Cadillac-Ferrari' },
  { name: 'Valtteri Bottas', teamName: 'Cadillac-Ferrari' },
  { name: 'Charles Leclerc', teamName: 'Ferrari' },
  { name: 'Lewis Hamilton', teamName: 'Ferrari' },
  { name: 'Esteban Ocon', teamName: 'Haas-Ferrari' },
  { name: 'Oliver Bearman', teamName: 'Haas-Ferrari' },
  { name: 'Lando Norris', teamName: 'McLaren-Mercedes' },
  { name: 'Oscar Piastri', teamName: 'McLaren-Mercedes' },
  { name: 'Kimi Antonelli', teamName: 'Mercedes' },
  { name: 'George Russell', teamName: 'Mercedes' },
  { name: 'Liam Lawson', teamName: 'Racing Bulls-Red Bull Ford' },
  { name: 'Arvid Lindblad', teamName: 'Racing Bulls-Red Bull Ford' },
  { name: 'Max Verstappen', teamName: 'Red Bull Racing-Red Bull Ford' },
  { name: 'Isack Hadjar', teamName: 'Red Bull Racing-Red Bull Ford' }
];

const FALLBACK_RACE_WEEKENDS = [
  { round: 1, name: 'Australian Grand Prix', circuitName: 'Albert Park Circuit', date: '2026-03-08', hasSprintWeekend: false },
  { round: 2, name: 'Chinese Grand Prix', circuitName: 'Shanghai International Circuit', date: '2026-03-15', hasSprintWeekend: true },
  { round: 3, name: 'Japanese Grand Prix', circuitName: 'Suzuka Circuit', date: '2026-03-29', hasSprintWeekend: false },
  { round: 4, name: 'Bahrain Grand Prix', circuitName: 'Bahrain International Circuit', date: '2026-04-12', hasSprintWeekend: false },
  { round: 5, name: 'Saudi Arabian Grand Prix', circuitName: 'Jeddah Corniche Circuit', date: '2026-04-19', hasSprintWeekend: false },
  { round: 6, name: 'Miami Grand Prix', circuitName: 'Miami International Autodrome', date: '2026-05-03', hasSprintWeekend: true },
  { round: 7, name: 'Canadian Grand Prix', circuitName: 'Circuit Gilles Villeneuve', date: '2026-05-24', hasSprintWeekend: true },
  { round: 8, name: 'Monaco Grand Prix', circuitName: 'Circuit de Monaco', date: '2026-06-07', hasSprintWeekend: false },
  { round: 9, name: 'Barcelona-Catalunya Grand Prix', circuitName: 'Circuit de Barcelona-Catalunya', date: '2026-06-14', hasSprintWeekend: false },
  { round: 10, name: 'Austrian Grand Prix', circuitName: 'Red Bull Ring', date: '2026-06-28', hasSprintWeekend: false },
  { round: 11, name: 'British Grand Prix', circuitName: 'Silverstone Circuit', date: '2026-07-05', hasSprintWeekend: true },
  { round: 12, name: 'Belgian Grand Prix', circuitName: 'Circuit de Spa-Francorchamps', date: '2026-07-19', hasSprintWeekend: false },
  { round: 13, name: 'Hungarian Grand Prix', circuitName: 'Hungaroring', date: '2026-07-26', hasSprintWeekend: false },
  { round: 14, name: 'Dutch Grand Prix', circuitName: 'Circuit Zandvoort', date: '2026-08-23', hasSprintWeekend: true },
  { round: 15, name: 'Italian Grand Prix', circuitName: 'Monza Circuit', date: '2026-09-06', hasSprintWeekend: false },
  { round: 16, name: 'Spanish Grand Prix', circuitName: 'Madring', date: '2026-09-13', hasSprintWeekend: false },
  { round: 17, name: 'Azerbaijan Grand Prix', circuitName: 'Baku City Circuit', date: '2026-09-26', hasSprintWeekend: false },
  { round: 18, name: 'Singapore Grand Prix', circuitName: 'Marina Bay Street Circuit', date: '2026-10-11', hasSprintWeekend: true },
  { round: 19, name: 'United States Grand Prix', circuitName: 'Circuit of the Americas', date: '2026-10-25', hasSprintWeekend: false },
  { round: 20, name: 'Mexico City Grand Prix', circuitName: 'Autodromo Hermanos Rodriguez', date: '2026-11-01', hasSprintWeekend: false },
  { round: 21, name: 'Sao Paulo Grand Prix', circuitName: 'Interlagos Circuit', date: '2026-11-08', hasSprintWeekend: false },
  { round: 22, name: 'Las Vegas Grand Prix', circuitName: 'Las Vegas Strip Circuit', date: '2026-11-21', hasSprintWeekend: false },
  { round: 23, name: 'Qatar Grand Prix', circuitName: 'Lusail International Circuit', date: '2026-11-29', hasSprintWeekend: false },
  { round: 24, name: 'Abu Dhabi Grand Prix', circuitName: 'Yas Marina Circuit', date: '2026-12-06', hasSprintWeekend: false }
];

function deterministicIndex(key, length) {
  if (!Number.isInteger(length) || length <= 0) return 0;
  const digest = crypto.createHash('sha256').update(String(key)).digest();
  return digest.readUInt32BE(0) % length;
}

function parsePositionCategoryMeta(categoryName) {
  const match = String(categoryName || '').match(/(race result|sprint result|race qualification|sprint qualification)\s*p(\d+)/i);
  if (!match) return null;

  let scope = 'race-result';
  const normalized = match[1].toLowerCase();
  if (normalized.includes('sprint') && normalized.includes('qualification')) scope = 'sprint-qualification';
  else if (normalized.includes('race') && normalized.includes('qualification')) scope = 'race-qualification';
  else if (normalized.includes('sprint')) scope = 'sprint-result';

  return {
    scope,
    position: Number(match[2])
  };
}

function parseDateTime(dateText, timeText, fallbackHour = '13:00:00Z') {
  if (!dateText) return null;
  return new Date(`${dateText}T${timeText || fallbackHour}`);
}

function buildFallbackDeadlineAt(weekend, raceDate, lockMinutes) {
  const daysBeforeRace = weekend?.hasSprintWeekend ? 2 : 1;
  const fallbackSessionAt = new Date(raceDate.getTime() - daysBeforeRace * 24 * 60 * 60 * 1000);
  return new Date(getLockDeadlineAt(fallbackSessionAt.toISOString(), lockMinutes) || fallbackSessionAt.toISOString());
}

async function buildDeadlineAt(weekend, raceDate, lockMinutes) {
  const firstSession =
    (weekend?.SprintQualifying?.date
      ? parseDateTime(weekend.SprintQualifying.date, weekend?.SprintQualifying?.time, '13:00:00Z')
      : null) ||
    (weekend?.Qualifying?.date
      ? parseDateTime(weekend.Qualifying.date, weekend?.Qualifying?.time, '13:00:00Z')
      : null) ||
    (weekend?.FirstPractice?.date
      ? parseDateTime(weekend.FirstPractice.date, weekend?.FirstPractice?.time, '13:00:00Z')
      : null);

  if (firstSession) {
    return new Date(getLockDeadlineAt(firstSession.toISOString(), lockMinutes) || firstSession.toISOString());
  }

  return buildFallbackDeadlineAt(weekend, raceDate, lockMinutes);
}

function buildRaceCategories(hasSprintWeekend) {
  const categories = [];

  [1, 2, 3].forEach((position) => {
    categories.push({
      name: `Race Qualification P${position}`,
      isPositionBased: true,
      exactPoints: 5,
      partialPoints: 1
    });
  });

  if (hasSprintWeekend) {
    [1, 2, 3].forEach((position) => {
      categories.push({
        name: `Sprint Qualification P${position}`,
        isPositionBased: true,
        exactPoints: 5,
        partialPoints: 1
      });
    });

    [1, 2, 3].forEach((position) => {
      categories.push({
        name: `Sprint Result P${position}`,
        isPositionBased: true,
        exactPoints: 5,
        partialPoints: 1
      });
    });
  }

  categories.push(
    { name: 'Driver of the Weekend', isPositionBased: false, exactPoints: 10, partialPoints: 0 },
    { name: 'Fastest Lap Driver', isPositionBased: false, exactPoints: 8, partialPoints: 0 },
    { name: 'Team of the Weekend', isPositionBased: false, exactPoints: 10, partialPoints: 0 }
  );

  [1, 2, 3].forEach((position) => {
    categories.push({
      name: `Race Result P${position}`,
      isPositionBased: true,
      exactPoints: 5,
      partialPoints: 1
    });
  });

  return categories.map((category, index) => ({
    ...category,
    displayOrder: index + 1
  }));
}

async function fetchSeasonSchedule(season) {
  const lockMinutes = await getPickLockMinutesBeforeDeadline();

  try {
    const response = await fetch(`${JOLPICA_BASE}/${season}/races.json`);
    if (!response.ok) {
      throw new Error(`Jolpica schedule request failed (${response.status})`);
    }

    const payload = await response.json();
    const races = payload?.MRData?.RaceTable?.Races || [];
    if (!races.length) {
      throw new Error('Jolpica returned no races');
    }

    return Promise.all(races.map(async (race) => {
      const raceDate = parseDateTime(race.date, race.time, '13:00:00Z');
      return {
        round: Number(race.round),
        name: race.raceName,
        circuitName: race?.Circuit?.circuitName || race.raceName,
        date: race.date,
        raceDate,
        deadlineAt: await buildDeadlineAt(race, raceDate, lockMinutes),
        hasSprintWeekend: Boolean(race.Sprint)
      };
    }));
  } catch (error) {
    console.warn(`Falling back to bundled 2026 calendar: ${error.message}`);
    return FALLBACK_RACE_WEEKENDS.map((weekend) => {
      const raceDate = parseDateTime(weekend.date, '13:00:00Z', '13:00:00Z');
      return {
        ...weekend,
        raceDate,
        deadlineAt: buildFallbackDeadlineAt(weekend, raceDate, lockMinutes)
      };
    });
  }
}

function buildDriverPool(categoryName) {
  const meta = parsePositionCategoryMeta(categoryName);
  const dominantRace = ['Max Verstappen', 'Lando Norris', 'Charles Leclerc', 'Oscar Piastri', 'Lewis Hamilton', 'George Russell'];
  const dominantQualifying = ['Max Verstappen', 'Charles Leclerc', 'Lando Norris', 'Lewis Hamilton', 'George Russell', 'Oscar Piastri'];
  const dominantSprint = ['Max Verstappen', 'Lando Norris', 'Oscar Piastri', 'Charles Leclerc', 'George Russell'];

  if (!meta) {
    return ['Max Verstappen', 'Lando Norris', 'Charles Leclerc', 'Oscar Piastri', 'Lewis Hamilton', 'George Russell'];
  }

  if (meta.scope === 'race-qualification') return dominantQualifying;
  if (meta.scope === 'sprint-qualification') return dominantQualifying;
  if (meta.scope === 'sprint-result') return dominantSprint;
  return dominantRace;
}

function chooseDriverPick(categoryName, round, userIndex) {
  const driverPool = buildDriverPool(categoryName);
  const clusterKey = `${round}:${categoryName}:cluster:${Math.floor(userIndex / 2)}`;
  const individualKey = `${round}:${categoryName}:user:${userIndex}`;
  const shouldCluster = deterministicIndex(`${individualKey}:mode`, 100) < 65;
  const selectedKey = shouldCluster ? clusterKey : individualKey;
  const candidatePool = shouldCluster ? driverPool.slice(0, Math.min(driverPool.length, 4)) : driverPool;
  return candidatePool[deterministicIndex(selectedKey, candidatePool.length)];
}

function chooseTeamPick(round, userIndex) {
  const teams = ['McLaren-Mercedes', 'Ferrari', 'Mercedes', 'Red Bull Racing-Red Bull Ford', 'Aston Martin Aramco-Honda'];
  const shouldCluster = deterministicIndex(`${round}:team:${userIndex}:mode`, 100) < 70;
  const key = shouldCluster ? `${round}:team:cluster:${Math.floor(userIndex / 2)}` : `${round}:team:user:${userIndex}`;
  const pool = shouldCluster ? teams.slice(0, 3) : teams;
  return pool[deterministicIndex(key, pool.length)];
}

function buildPickValue(categoryName, round, userIndex) {
  if (categoryName === 'Team of the Weekend') {
    return { value_text: chooseTeamPick(round, userIndex), value_number: null };
  }

  return {
    value_text: chooseDriverPick(categoryName, round, userIndex),
    value_number: null
  };
}

async function ensureAdminUser(passwordHash) {
  let admin = await User.findOne({ role: 'admin' }).exec();
  if (admin) return admin;

  admin = await User.create({
    name: 'Admin',
    email: 'admin@example.com',
    password_hash: passwordHash,
    role: 'admin',
    email_verified_at: new Date()
  });

  return admin;
}

async function removeExistingTargetLeague() {
  const leagues = await League.find({
    $or: [
      { name: LEAGUE_NAME },
      { invite_code: LEAGUE_INVITE_CODE }
    ]
  }).lean().exec();

  if (!leagues.length) return;

  const leagueIds = leagues.map((league) => league._id);
  const races = await Race.find({ $or: [{ league: { $in: leagueIds } }, { leagues: { $in: leagueIds } }] }).select('_id').lean().exec();
  const raceIds = races.map((race) => race._id);

  if (raceIds.length) {
    await Promise.all([
      Pick.deleteMany({ race: { $in: raceIds } }).exec(),
      Result.deleteMany({ race: { $in: raceIds } }).exec(),
      Score.deleteMany({ race: { $in: raceIds } }).exec(),
      PickCategory.deleteMany({ race: { $in: raceIds } }).exec(),
      RaceDriver.deleteMany({ race: { $in: raceIds } }).exec(),
      Race.deleteMany({ _id: { $in: raceIds } }).exec()
    ]);
  }

  await LeagueMember.deleteMany({ league: { $in: leagueIds } }).exec();
  await League.deleteMany({ _id: { $in: leagueIds } }).exec();
}

async function upsertTestUsers(passwordHash) {
  const users = [];

  for (const user of TEST_USERS) {
    const updated = await User.findOneAndUpdate(
      { email: user.email },
      {
        $set: {
          name: user.name,
          email: user.email,
          password_hash: passwordHash,
          role: 'player',
          email_verified_at: new Date(),
          email_verification_token_hash: null,
          email_verification_sent_at: null,
          password_reset_token_hash: null,
          password_reset_expires_at: null
        },
        $setOnInsert: {
          created_at: new Date()
        }
      },
      { upsert: true, new: true }
    ).exec();

    users.push(updated);
  }

  return users;
}

async function seedRaceWeekend(leagueId, weekend) {
  const race = await Race.create({
    league: leagueId,
    leagues: [leagueId],
    name: weekend.name,
    circuit_name: weekend.circuitName,
    external_round: weekend.round,
    race_date: weekend.raceDate,
    manual_deadline_at: weekend.deadlineAt,
    deadline_at: weekend.deadlineAt,
    status: 'scheduled',
    is_visible: true,
    predictions_live: true
  });

  const driverDocs = DRIVERS.map((driver, index) => ({
    race: race._id,
    driver_name: driver.name,
    team_name: driver.teamName,
    display_order: index + 1
  }));
  await RaceDriver.insertMany(driverDocs);

  const categories = buildRaceCategories(weekend.hasSprintWeekend).map((category) => ({
    race: race._id,
    name: category.name,
    display_order: category.displayOrder,
    is_position_based: category.isPositionBased,
    exact_points: category.exactPoints,
    partial_points: category.partialPoints,
    metadata: {}
  }));
  const insertedCategories = await PickCategory.insertMany(categories);

  return { race, categories: insertedCategories };
}

async function seedPicksForRace(leagueId, race, categories, users) {
  const picks = [];

  users.forEach((user, userIndex) => {
    categories.forEach((category) => {
      const value = buildPickValue(category.name, race.external_round, userIndex);
      const submittedAt = new Date(Math.min(
        race.deadline_at.getTime() - (userIndex + 1) * 60 * 60 * 1000,
        Date.now() - (userIndex + 1) * 60 * 1000
      ));

      picks.push({
        league: leagueId,
        user: user._id,
        race: race._id,
        category: category._id,
        value_text: value.value_text,
        value_number: value.value_number,
        status: 'submitted',
        submitted_at: submittedAt,
        updated_at: submittedAt,
        created_at: submittedAt
      });
    });
  });

  await Pick.insertMany(picks);
  return picks.length;
}

async function main() {
  await connectMongo();

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  const admin = await ensureAdminUser(passwordHash);
  const raceWeekends = await fetchSeasonSchedule(SEASON);

  await removeExistingTargetLeague();

  const league = await League.create({
    name: LEAGUE_NAME,
    invite_code: LEAGUE_INVITE_CODE,
    created_at: new Date()
  });

  const testUsers = await upsertTestUsers(passwordHash);
  const memberDocs = [admin, ...testUsers].map((user) => ({
    league: league._id,
    user: user._id,
    joined_at: new Date()
  }));
  await LeagueMember.insertMany(memberDocs);

  let raceCount = 0;
  let categoryCount = 0;
  let pickCount = 0;

  for (const weekend of raceWeekends) {
    const { race, categories } = await seedRaceWeekend(league._id, weekend);
    raceCount += 1;
    categoryCount += categories.length;
    pickCount += await seedPicksForRace(league._id, race, categories, testUsers);
  }

  const syncSummary = await syncCompletedRaceResultsFromJolpica({ season: SEASON });

  console.log(JSON.stringify({
    league: {
      name: league.name,
      inviteCode: league.invite_code,
      id: String(league._id)
    },
    admin: {
      email: admin.email,
      role: admin.role
    },
    testUsers: TEST_USERS.map((user) => ({
      ...user,
      password: DEFAULT_PASSWORD
    })),
    counts: {
      races: raceCount,
      categories: categoryCount,
      picks: pickCount,
      members: memberDocs.length
    },
    syncSummary
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });