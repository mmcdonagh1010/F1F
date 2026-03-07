import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
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
import { calculateRaceScores } from '../src/services/scoring.js';

const DEMO_YEAR = Number(process.env.DEMO_SEASON_YEAR || 2025);
const DEMO_USER_COUNT = Number(process.env.DEMO_USER_COUNT || 10);
const JOLPICA_BASE = 'https://api.jolpi.ca/ergast/f1';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Jolpica request failed (${res.status}) for ${url}`);
  }
  return res.json();
}

function getRaceTableRace(payload) {
  return payload?.MRData?.RaceTable?.Races?.[0] || null;
}

function getRaceTableRaces(payload) {
  return payload?.MRData?.RaceTable?.Races || [];
}

function parseRaceDate(race) {
  const date = race?.date;
  const time = race?.time || '00:00:00Z';
  if (!date) return null;
  return new Date(`${date}T${time}`);
}

function parseDeadlineAt(race) {
  const qualifyingDate = race?.Qualifying?.date;
  const qualifyingTime = race?.Qualifying?.time || '00:00:00Z';
  if (qualifyingDate) {
    return new Date(`${qualifyingDate}T${qualifyingTime}`);
  }

  const raceDate = parseRaceDate(race);
  if (!raceDate) return null;
  return new Date(raceDate.getTime() - 24 * 60 * 60 * 1000);
}

function hasSprintWeekend(race) {
  return Boolean(race?.Sprint);
}

function buildRaceCategories(includeSprint) {
  const categories = [];

  [1, 2, 3].forEach((position) => {
    categories.push({
      name: `Race Qualification P${position}`,
      is_position_based: true,
      exact_points: 5,
      partial_points: 1
    });
  });

  if (includeSprint) {
    [1, 2, 3].forEach((position) => {
      categories.push({
        name: `Sprint Result P${position}`,
        is_position_based: true,
        exact_points: 5,
        partial_points: 1
      });
    });
  }

  categories.push(
    { name: 'Driver of the Weekend', is_position_based: false, exact_points: 10, partial_points: 0 },
    { name: 'Fastest Lap Driver', is_position_based: false, exact_points: 8, partial_points: 0 },
    { name: 'Team of the Weekend', is_position_based: false, exact_points: 10, partial_points: 0 }
  );

  [1, 2, 3].forEach((position) => {
    categories.push({
      name: `Race Result P${position}`,
      is_position_based: true,
      exact_points: 5,
      partial_points: 1
    });
  });

  return categories;
}

function getFullDriverName(driver) {
  return `${driver?.givenName || ''} ${driver?.familyName || ''}`.trim();
}

function normalizeDriversFromRaceResults(results) {
  const seen = new Set();
  return (results || [])
    .map((row) => ({
      name: getFullDriverName(row?.Driver),
      teamName: row?.Constructor?.name || null
    }))
    .filter((row) => row.name)
    .filter((row) => {
      const key = row.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildPositionMap(items, accessor) {
  const map = new Map();
  (items || []).forEach((item) => {
    const position = Number(item?.position);
    const value = accessor(item);
    if (!Number.isInteger(position) || !value) return;
    map.set(position, value);
  });
  return map;
}

function findFastestLapDriver(results) {
  const ranked = (results || [])
    .filter((row) => Number(row?.FastestLap?.rank) > 0)
    .sort((a, b) => Number(a.FastestLap.rank) - Number(b.FastestLap.rank));
  return ranked[0] ? getFullDriverName(ranked[0].Driver) : null;
}

function findTopTeamByPoints(results) {
  const teamPoints = new Map();
  (results || []).forEach((row) => {
    const teamName = row?.Constructor?.name || null;
    const points = Number(row?.points || 0);
    if (!teamName) return;
    teamPoints.set(teamName, (teamPoints.get(teamName) || 0) + points);
  });

  return Array.from(teamPoints.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
}

function buildOfficialResultsByCategory({ categories, qualifyingResults, sprintResults, raceResults }) {
  const qualifyingMap = buildPositionMap(qualifyingResults, (row) => getFullDriverName(row?.Driver));
  const sprintMap = buildPositionMap(sprintResults, (row) => getFullDriverName(row?.Driver));
  const raceMap = buildPositionMap(raceResults, (row) => getFullDriverName(row?.Driver));
  const raceWinner = raceMap.get(1) || null;
  const fastestLapDriver = findFastestLapDriver(raceResults);
  const teamOfWeekend = findTopTeamByPoints(raceResults);

  return categories
    .map((category) => {
      let valueText = null;

      if (/^Race Qualification P\d+$/i.test(category.name)) {
        const position = Number(category.name.match(/P(\d+)/i)?.[1] || 0);
        valueText = qualifyingMap.get(position) || null;
      } else if (/^Sprint Result P\d+$/i.test(category.name)) {
        const position = Number(category.name.match(/P(\d+)/i)?.[1] || 0);
        valueText = sprintMap.get(position) || null;
      } else if (/^Race Result P\d+$/i.test(category.name)) {
        const position = Number(category.name.match(/P(\d+)/i)?.[1] || 0);
        valueText = raceMap.get(position) || null;
      } else if (category.name === 'Driver of the Weekend') {
        valueText = raceWinner;
      } else if (category.name === 'Fastest Lap Driver') {
        valueText = fastestLapDriver;
      } else if (category.name === 'Team of the Weekend') {
        valueText = teamOfWeekend;
      }

      return {
        categoryName: category.name,
        value_text: valueText,
        value_number: null
      };
    })
    .filter((row) => row.value_text);
}

function buildPickValue({ categoryName, drivers, userIndex, raceIndex, categoryIndex }) {
  const driverNames = drivers.map((driver) => driver.name);
  const teamNames = [...new Set(drivers.map((driver) => driver.teamName).filter(Boolean))];

  if (categoryName === 'Team of the Weekend') {
    return teamNames[(userIndex + raceIndex + categoryIndex) % teamNames.length] || null;
  }

  return driverNames[(userIndex + raceIndex + categoryIndex) % driverNames.length] || null;
}

async function loadSeasonWeekendData(season) {
  const schedulePayload = await fetchJson(`${JOLPICA_BASE}/${season}.json`);
  const weekends = getRaceTableRaces(schedulePayload);

  const detailedWeekends = [];
  for (const weekend of weekends) {
    const round = weekend.round;
    const [qualifyingPayload, raceResultsPayload, sprintPayload] = await Promise.all([
      fetchJson(`${JOLPICA_BASE}/${season}/${round}/qualifying.json`),
      fetchJson(`${JOLPICA_BASE}/${season}/${round}/results.json`),
      hasSprintWeekend(weekend)
        ? fetchJson(`${JOLPICA_BASE}/${season}/${round}/sprint.json`).catch(() => null)
        : Promise.resolve(null)
    ]);

    detailedWeekends.push({
      weekend,
      qualifyingRace: getRaceTableRace(qualifyingPayload),
      resultRace: getRaceTableRace(raceResultsPayload),
      sprintRace: sprintPayload ? getRaceTableRace(sprintPayload) : null
    });
  }

  return detailedWeekends;
}

async function seedDemo() {
  await connectMongo();

  console.log('Connected to MongoDB');
  console.log(`Loading real Formula 1 ${DEMO_YEAR} schedule and results from Jolpica`);

  const weekends = await loadSeasonWeekendData(DEMO_YEAR);
  if (!weekends.length) {
    throw new Error(`No race weekends returned for season ${DEMO_YEAR}`);
  }

  await User.deleteMany({});
  await League.deleteMany({});
  await LeagueMember.deleteMany({});
  await Race.deleteMany({});
  await RaceDriver.deleteMany({});
  await PickCategory.deleteMany({});
  await Pick.deleteMany({});
  await Result.deleteMany({});
  await Score.deleteMany({});

  console.log('Cleared existing data');

  const users = [];
  const passwordHash = await bcrypt.hash('password123', 10);

  for (let i = 1; i <= DEMO_USER_COUNT; i++) {
    const user = new User({
      name: `Player ${i}`,
      email: `player${i}@example.com`,
      password_hash: passwordHash,
      role: 'player'
    });
    await user.save();
    users.push(user);
  }

  const admin = new User({
    name: 'Admin',
    email: 'admin@example.com',
    password_hash: passwordHash,
    role: 'admin'
  });
  await admin.save();
  users.push(admin);

  console.log(`Created ${users.length} users`);

  const league = new League({
    name: `Formula 1 ${DEMO_YEAR} Demo League`,
    invite_code: `F1${DEMO_YEAR}`
  });
  await league.save();

  for (const user of users) {
    await LeagueMember.create({
      league: league._id,
      user: user._id
    });
  }

  console.log(`Created league ${league.name}`);
  console.log('Added users to league');

  for (let index = 0; index < weekends.length; index += 1) {
    const { weekend, qualifyingRace, resultRace, sprintRace } = weekends[index];
    const raceResults = resultRace?.Results || [];
    const qualifyingResults = qualifyingRace?.QualifyingResults || [];
    const sprintResults = sprintRace?.SprintResults || [];
    const drivers = normalizeDriversFromRaceResults(raceResults);
    const categories = buildRaceCategories(hasSprintWeekend(weekend));

    const race = new Race({
      league: league._id,
      leagues: [league._id],
      name: weekend.raceName,
      circuit_name: weekend?.Circuit?.circuitName || 'Unknown Circuit',
      external_round: Number(weekend.round),
      race_date: parseRaceDate(weekend),
      deadline_at: parseDeadlineAt(weekend),
      status: 'completed',
      is_visible: true
    });
    await race.save();

    await RaceDriver.insertMany(
      drivers.map((driver, driverIndex) => ({
        race: race._id,
        driver_name: driver.name,
        team_name: driver.teamName,
        display_order: driverIndex + 1
      }))
    );

    const categoryDocs = await PickCategory.insertMany(
      categories.map((category, categoryIndex) => ({
        race: race._id,
        name: category.name,
        display_order: categoryIndex + 1,
        is_position_based: category.is_position_based,
        exact_points: category.exact_points,
        partial_points: category.partial_points
      }))
    );

    const officialResults = buildOfficialResultsByCategory({
      categories,
      qualifyingResults,
      sprintResults,
      raceResults
    });

    await Result.insertMany(
      officialResults.map((result) => {
        const categoryDoc = categoryDocs.find((doc) => doc.name === result.categoryName);
        return {
          race: race._id,
          category: String(categoryDoc._id),
          value_text: result.value_text,
          value_number: result.value_number
        };
      })
    );

    for (let userIndex = 0; userIndex < users.length; userIndex += 1) {
      const user = users[userIndex];
      await Pick.insertMany(
        categoryDocs.map((categoryDoc, categoryIndex) => ({
          league: league._id,
          user: user._id,
          race: race._id,
          category: categoryDoc._id,
          value_text: buildPickValue({
            categoryName: categoryDoc.name,
            drivers,
            userIndex,
            raceIndex: index,
            categoryIndex
          }),
          value_number: null
        }))
      );
    }

    await calculateRaceScores(race._id, league._id);

    console.log(`Completed ${weekend.raceName}`);
  }

  console.log(`Demo seeded successfully for ${DEMO_YEAR}`);
  process.exit(0);
}

seedDemo()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });