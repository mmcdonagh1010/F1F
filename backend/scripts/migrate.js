#!/usr/bin/env node

import { Client } from 'pg';
import { connectMongo } from '../src/mongo.js';
import User from '../src/models/User.js';
import League from '../src/models/League.js';
import LeagueMember from '../src/models/LeagueMember.js';
import Race from '../src/models/Race.js';
import RaceDriver from '../src/models/RaceDriver.js';
import PickCategory from '../src/models/PickCategory.js';
import Pick from '../src/models/Pick.js';
import Notification from '../src/models/Notification.js';

async function main() {
  // DATABASE_URL should point at an existing Postgres instance.  Once data
  // has been migrated and you no longer require Postgres the variable can be
  // removed from .env and the script will refuse to run (see README).  This
  // prevents accidental connections.
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not configured; nothing to migrate.');
    process.exit(1);
  }
  console.log('connecting to databases...');
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  await connectMongo();

  // maps for keeping track of id conversions
  const userMap = new Map();
  const leagueMap = new Map();
  const raceMap = new Map();
  const categoryMap = new Map();

  // helper for upsert by unique field
  async function insertIfNotExists(model, query, data) {
    let doc = await model.findOne(query).exec();
    if (!doc) doc = await model.create(data);
    return doc;
  }

  console.log('migrating users');
  const { rows: users } = await pg.query('SELECT * FROM users');
  if (users.length) {
    const userDocs = users.map((u) => ({
      name: u.name,
      email: u.email,
      password_hash: u.password_hash,
      role: u.role,
      created_at: u.created_at
    }));
    const createdUsers = await User.insertMany(userDocs, { ordered: false }).catch((e) => {
      // ignore duplicate key errors
      if (e.code !== 11000) throw e;
      return e.insertedDocs || [];
    });
    users.forEach((u, idx) => {
      const doc = createdUsers[idx];
      if (doc) userMap.set(u.id, doc._id);
    });
  }

  console.log('migrating leagues');
  const { rows: leagues } = await pg.query('SELECT * FROM leagues');
  if (leagues.length) {
    const leagueDocs = leagues.map((l) => ({
      name: l.name,
      invite_code: l.invite_code,
      created_at: l.created_at
    }));
    const createdLeagues = await League.insertMany(leagueDocs, { ordered: false }).catch((e) => {
      if (e.code !== 11000) throw e;
      return e.insertedDocs || [];
    });
    leagues.forEach((l, idx) => {
      const doc = createdLeagues[idx];
      if (doc) leagueMap.set(l.id, doc._id);
    });
  }

  console.log('migrating league_members');
  const { rows: members } = await pg.query('SELECT * FROM league_members');
  for (const m of members) {
    const leagueId = leagueMap.get(m.league_id);
    const userId = userMap.get(m.user_id);
    if (!leagueId || !userId) continue;
    await LeagueMember.updateOne(
      { league: leagueId, user: userId },
      { league: leagueId, user: userId, joined_at: m.joined_at },
      { upsert: true }
    ).exec();
  }

  console.log('migrating races');
  const { rows: races } = await pg.query('SELECT * FROM races');
  if (races.length) {
    const raceDocs = races.map((r) => ({
      league: r.league_id ? leagueMap.get(r.league_id) : null,
      leagues: [],
      name: r.name,
      circuit_name: r.circuit_name,
      external_round: r.external_round,
      race_date: r.race_date,
      deadline_at: r.deadline_at,
      status: r.status,
      is_visible: r.is_visible,
      tie_breaker_value: r.tie_breaker_value,
      created_at: r.created_at
    }));
    const createdRaces = await Race.insertMany(raceDocs, { ordered: false }).catch((e) => {
      if (e.code !== 11000) throw e;
      return e.insertedDocs || [];
    });
    races.forEach((r, idx) => {
      const doc = createdRaces[idx];
      if (doc) raceMap.set(r.id, doc._id);
    });
  }

  console.log('migrating race_leagues join table into race.leagues field');
  const { rows: raceLeagues } = await pg.query('SELECT * FROM race_leagues');
  for (const rl of raceLeagues) {
    const raceId = raceMap.get(rl.race_id);
    const leagueId = leagueMap.get(rl.league_id);
    if (raceId && leagueId) {
      await Race.updateOne({ _id: raceId }, { $addToSet: { leagues: leagueId } }).exec();
    }
  }

  console.log('migrating race_drivers');
  const { rows: drivers } = await pg.query('SELECT * FROM race_drivers');
  if (drivers.length) {
    const driverDocs = [];
    for (const d of drivers) {
      const raceId = raceMap.get(d.race_id);
      if (!raceId) continue;
      driverDocs.push({
        race: raceId,
        driver_name: d.driver_name,
        team_name: d.team_name,
        display_order: d.display_order,
        created_at: d.created_at
      });
    }
    if (driverDocs.length) {
      await RaceDriver.insertMany(driverDocs, { ordered: false }).catch((e) => {
        if (e.code !== 11000) throw e;
      });
    }
  }

  console.log('migrating pick_categories');
  const { rows: cats } = await pg.query('SELECT * FROM pick_categories');
  if (cats.length) {
    const catDocs = [];
    cats.forEach((c) => {
      const raceId = raceMap.get(c.race_id);
      if (!raceId) return;
      catDocs.push({
        race: raceId,
        name: c.name,
        display_order: c.display_order,
        is_position_based: c.is_position_based,
        exact_points: c.exact_points,
        partial_points: c.partial_points,
        created_at: c.created_at
      });
    });
    if (catDocs.length) {
      const createdCats = await PickCategory.insertMany(catDocs, { ordered: false }).catch((e) => {
        if (e.code !== 11000) throw e;
        return e.insertedDocs || [];
      });
      cats.forEach((c, idx) => {
        const raceId = raceMap.get(c.race_id);
        if (!raceId) return;
        const doc = createdCats[idx];
        if (doc) categoryMap.set(c.id, doc._id);
      });
    }
  }

  console.log('migrating picks');
  const { rows: picks } = await pg.query('SELECT * FROM picks');
  for (const p of picks) {
    const raceId = raceMap.get(p.race_id);
    const userId = userMap.get(p.user_id);
    const leagueId = leagueMap.get(p.league_id);
    const catId = categoryMap.get(p.pick_category_id);
    if (!raceId || !userId) continue;
    await Pick.create({
      race: raceId,
      user: userId,
      league: leagueId || null,
      category: catId || null,
      value_text: p.value_text,
      value_number: p.value_number,
      created_at: p.created_at
    });
  }

  console.log('migrating notifications');
  const { rows: notes } = await pg.query('SELECT * FROM notifications');
  for (const n of notes) {
    const userId = userMap.get(n.user_id);
    const raceId = raceMap.get(n.race_id);
    await Notification.create({
      user: userId || null,
      race: raceId || null,
      type: n.type,
      payload: n.payload,
      title: n.title,
      body: n.body,
      is_read: n.is_read,
      metadata: n.metadata,
      created_at: n.created_at
    });
  }

  console.log('migration complete');
  await pg.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
