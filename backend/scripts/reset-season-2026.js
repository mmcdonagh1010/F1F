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

const ADMIN_ACCOUNT = {
  name: process.env.SEED_ADMIN_NAME || 'Admin',
  email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com'
};

const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(18).toString('base64url');

const DEFAULT_LEAGUE = {
  name: '2026 Championship',
  inviteCode: 'F12026'
};

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

const SPRINT_ROUNDS = new Set([2, 6, 7, 11, 14, 18]);

const RACE_WEEKENDS = [
  { round: 1, name: 'Australian Grand Prix', circuitName: 'Albert Park Circuit', date: '2026-03-08' },
  { round: 2, name: 'Chinese Grand Prix', circuitName: 'Shanghai International Circuit', date: '2026-03-15' },
  { round: 3, name: 'Japanese Grand Prix', circuitName: 'Suzuka Circuit', date: '2026-03-29' },
  { round: 4, name: 'Bahrain Grand Prix', circuitName: 'Bahrain International Circuit', date: '2026-04-12' },
  { round: 5, name: 'Saudi Arabian Grand Prix', circuitName: 'Jeddah Corniche Circuit', date: '2026-04-19' },
  { round: 6, name: 'Miami Grand Prix', circuitName: 'Miami International Autodrome', date: '2026-05-03' },
  { round: 7, name: 'Canadian Grand Prix', circuitName: 'Circuit Gilles Villeneuve', date: '2026-05-24' },
  { round: 8, name: 'Monaco Grand Prix', circuitName: 'Circuit de Monaco', date: '2026-06-07' },
  { round: 9, name: 'Barcelona-Catalunya Grand Prix', circuitName: 'Circuit de Barcelona-Catalunya', date: '2026-06-14' },
  { round: 10, name: 'Austrian Grand Prix', circuitName: 'Red Bull Ring', date: '2026-06-28' },
  { round: 11, name: 'British Grand Prix', circuitName: 'Silverstone Circuit', date: '2026-07-05' },
  { round: 12, name: 'Belgian Grand Prix', circuitName: 'Circuit de Spa-Francorchamps', date: '2026-07-19' },
  { round: 13, name: 'Hungarian Grand Prix', circuitName: 'Hungaroring', date: '2026-07-26' },
  { round: 14, name: 'Dutch Grand Prix', circuitName: 'Circuit Zandvoort', date: '2026-08-23' },
  { round: 15, name: 'Italian Grand Prix', circuitName: 'Monza Circuit', date: '2026-09-06' },
  { round: 16, name: 'Spanish Grand Prix', circuitName: 'Madring', date: '2026-09-13' },
  { round: 17, name: 'Azerbaijan Grand Prix', circuitName: 'Baku City Circuit', date: '2026-09-26' },
  { round: 18, name: 'Singapore Grand Prix', circuitName: 'Marina Bay Street Circuit', date: '2026-10-11' },
  { round: 19, name: 'United States Grand Prix', circuitName: 'Circuit of the Americas', date: '2026-10-25' },
  { round: 20, name: 'Mexico City Grand Prix', circuitName: 'Autodromo Hermanos Rodriguez', date: '2026-11-01' },
  { round: 21, name: 'Sao Paulo Grand Prix', circuitName: 'Interlagos Circuit', date: '2026-11-08' },
  { round: 22, name: 'Las Vegas Grand Prix', circuitName: 'Las Vegas Strip Circuit', date: '2026-11-21' },
  { round: 23, name: 'Qatar Grand Prix', circuitName: 'Lusail International Circuit', date: '2026-11-29' },
  { round: 24, name: 'Abu Dhabi Grand Prix', circuitName: 'Yas Marina Circuit', date: '2026-12-06' }
];

function buildRaceDate(dateText) {
  return new Date(`${dateText}T13:00:00Z`);
}

function buildDeadlineAt(raceDate) {
  return new Date(raceDate.getTime() - 24 * 60 * 60 * 1000);
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

async function seedRaceWeekend(leagueId, weekend) {
  const raceDate = buildRaceDate(weekend.date);
  const deadlineAt = buildDeadlineAt(raceDate);

  const race = await Race.create({
    league: leagueId,
    leagues: [leagueId],
    name: weekend.name,
    circuit_name: weekend.circuitName,
    external_round: weekend.round,
    race_date: raceDate,
    deadline_at: deadlineAt,
    status: 'scheduled',
    is_visible: true
  });

  const driverDocs = DRIVERS.map((driver, index) => ({
    race: race._id,
    driver_name: driver.name,
    team_name: driver.teamName,
    display_order: index + 1
  }));

  await RaceDriver.insertMany(driverDocs);

  const categories = buildRaceCategories(SPRINT_ROUNDS.has(weekend.round)).map((category) => ({
    race: race._id,
    name: category.name,
    display_order: category.displayOrder,
    is_position_based: category.isPositionBased,
    exact_points: category.exactPoints,
    partial_points: category.partialPoints
  }));

  await PickCategory.insertMany(categories);
}

async function main() {
  await connectMongo();
  console.log('Connected to MongoDB');

  await mongoose.connection.dropDatabase();
  console.log('Dropped existing MongoDB database');

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const admin = await User.create({
    name: ADMIN_ACCOUNT.name,
    email: ADMIN_ACCOUNT.email,
    password_hash: passwordHash,
    role: 'admin'
  });

  const league = await League.create({
    name: DEFAULT_LEAGUE.name,
    invite_code: DEFAULT_LEAGUE.inviteCode
  });

  await LeagueMember.create({
    league: league._id,
    user: admin._id
  });

  for (const weekend of RACE_WEEKENDS) {
    await seedRaceWeekend(league._id, weekend);
  }

  console.log('Created admin account');
  console.log(`Admin email: ${ADMIN_ACCOUNT.email}`);
  console.log(`Admin password: ${ADMIN_PASSWORD}`);
  console.log(`Created league: ${league.name} (${league.invite_code})`);
  console.log(`Created races: ${RACE_WEEKENDS.length}`);
  console.log(`Created drivers per race: ${DRIVERS.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });