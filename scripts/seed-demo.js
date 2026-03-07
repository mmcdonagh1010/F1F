import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { connectMongo } from '../backend/src/mongo.js';
import User from '../backend/src/models/User.js';
import League from '../backend/src/models/League.js';
import LeagueMember from '../backend/src/models/LeagueMember.js';
import Race from '../backend/src/models/Race.js';
import RaceDriver from '../backend/src/models/RaceDriver.js';
import PickCategory from '../backend/src/models/PickCategory.js';
import Pick from '../backend/src/models/Pick.js';
import Result from '../backend/src/models/Result.js';
import { calculateRaceScores } from '../backend/src/services/scoring.js';

// Sample drivers
const drivers = [
  { name: 'Max Verstappen', team: 'Red Bull Racing' },
  { name: 'Lewis Hamilton', team: 'Mercedes' },
  { name: 'Charles Leclerc', team: 'Ferrari' },
  { name: 'Sergio Perez', team: 'Red Bull Racing' },
  { name: 'George Russell', team: 'Mercedes' },
  { name: 'Carlos Sainz', team: 'Ferrari' },
  { name: 'Lando Norris', team: 'McLaren' },
  { name: 'Oscar Piastri', team: 'McLaren' },
  { name: 'Fernando Alonso', team: 'Aston Martin' },
  { name: 'Lance Stroll', team: 'Aston Martin' },
  { name: 'Pierre Gasly', team: 'Alpine' },
  { name: 'Esteban Ocon', team: 'Alpine' },
  { name: 'Valtteri Bottas', team: 'Sauber' },
  { name: 'Zhou Guanyu', team: 'Sauber' },
  { name: 'Yuki Tsunoda', team: 'RB' },
  { name: 'Daniel Ricciardo', team: 'RB' },
  { name: 'Alexander Albon', team: 'Williams' },
  { name: 'Logan Sargeant', team: 'Williams' },
  { name: 'Kevin Magnussen', team: 'Haas' },
  { name: 'Nico Hulkenberg', team: 'Haas' }
];

async function seedDemo() {
  await connectMongo();

  console.log('Connected to MongoDB');

  // Clear existing data
  await User.deleteMany({});
  await League.deleteMany({});
  await LeagueMember.deleteMany({});
  await Race.deleteMany({});
  await RaceDriver.deleteMany({});
  await PickCategory.deleteMany({});
  await Pick.deleteMany({});
  await Result.deleteMany({});
  await mongoose.model('Score').deleteMany({});

  console.log('Cleared existing data');

  // Create 10 players and 1 admin
  const users = [];
  const passwordHash = await bcrypt.hash('password123', 10);

  for (let i = 1; i <= 10; i++) {
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

  console.log('Created 11 users');

  // Create league
  const league = new League({
    name: 'Demo League',
    invite_code: 'demo123'
  });
  await league.save();

  console.log('Created league');

  // Add all users to league
  for (const user of users) {
    const member = new LeagueMember({
      league: league._id,
      user: user._id
    });
    await member.save();
  }

  console.log('Added users to league');

  // Create 10 races
  const races = [];
  for (let i = 1; i <= 10; i++) {
    const raceDate = new Date(2023, i - 1, 15); // Spread over months
    const deadline = new Date(raceDate.getTime() - 30 * 60 * 1000); // 30 min before

    const race = new Race({
      name: `Demo Race ${i}`,
      circuit_name: `Circuit ${i}`,
      external_round: i,
      race_date: raceDate,
      deadline_at: deadline,
      status: 'completed',
      leagues: [league._id]
    });
    await race.save();
    races.push(race);

    // Create drivers for this race (all 20)
    const raceDrivers = [];
    for (let j = 0; j < drivers.length; j++) {
      const rd = new RaceDriver({
        race: race._id,
        driver_name: drivers[j].name,
        team_name: drivers[j].team,
        display_order: j + 1
      });
      await rd.save();
      raceDrivers.push(rd);
    }

    // Create pick categories
    const categories = [
      { name: 'Race Result P1', is_position_based: true, exact_points: 10, partial_points: 1 },
      { name: 'Race Result P2', is_position_based: true, exact_points: 8, partial_points: 1 },
      { name: 'Race Result P3', is_position_based: true, exact_points: 6, partial_points: 1 },
      { name: 'Race Qualification P1', is_position_based: true, exact_points: 5, partial_points: 1 },
      { name: 'Race Qualification P2', is_position_based: true, exact_points: 4, partial_points: 1 },
      { name: 'Race Qualification P3', is_position_based: true, exact_points: 3, partial_points: 1 },
      { name: 'Sprint Result P1', is_position_based: true, exact_points: 5, partial_points: 1 },
      { name: 'Sprint Result P2', is_position_based: true, exact_points: 4, partial_points: 1 },
      { name: 'Sprint Result P3', is_position_based: true, exact_points: 3, partial_points: 1 },
      { name: 'Sprint Qualification P1', is_position_based: true, exact_points: 3, partial_points: 1 },
      { name: 'Sprint Qualification P2', is_position_based: true, exact_points: 2, partial_points: 1 },
      { name: 'Sprint Qualification P3', is_position_based: true, exact_points: 1, partial_points: 1 }
    ];

    const categoryDocs = [];
    for (let k = 0; k < categories.length; k++) {
      const cat = new PickCategory({
        race: race._id,
        name: categories[k].name,
        display_order: k + 1,
        is_position_based: categories[k].is_position_based,
        exact_points: categories[k].exact_points,
        partial_points: categories[k].partial_points
      });
      await cat.save();
      categoryDocs.push(cat);
    }

    // Create results (official)
    // Shuffle drivers for positions
    const shuffled = [...drivers].sort(() => Math.random() - 0.5);
    for (let k = 0; k < categories.length; k++) {
      const cat = categories[k];
      const position = parsePositionCategoryMeta(cat.name).position;
      const driver = shuffled[position - 1];
      const result = new Result({
        race: race._id,
        category: cat._id, // Assuming it's ObjectId
        value_text: driver.name,
        value_number: null
      });
      await result.save();
    }

    // Create picks for each user
    for (const user of users) {
      for (const cat of categoryDocs) {
        const randomDriver = drivers[Math.floor(Math.random() * drivers.length)];
        const pick = new Pick({
          league: league._id,
          user: user._id,
          race: race._id,
          category: cat._id,
          value_text: randomDriver.name,
          value_number: null
        });
        await pick.save();
      }
    }

    // Calculate scores
    await calculateRaceScores(race._id, league._id);

    console.log(`Completed race ${i}`);
  }

  console.log('Demo seeded successfully');
  process.exit(0);
}

function parsePositionCategoryMeta(categoryName) {
  const match = String(categoryName || "").match(/(race result|sprint result|race qualification|sprint qualification)\s*p(\d+)/i);
  if (!match) return null;

  let scope = "race-result";
  const normalized = match[1].toLowerCase();
  if (normalized.includes("sprint") && normalized.includes("qualification")) scope = "sprint-qualification";
  else if (normalized.includes("race") && normalized.includes("qualification")) scope = "race-qualification";
  else if (normalized.includes("sprint")) scope = "sprint-result";

  return {
    scope,
    position: Number(match[2])
  };
}

seedDemo().catch(console.error);