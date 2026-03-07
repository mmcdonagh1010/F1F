use("f1f");

const userCount = db.getCollection("users").countDocuments({});
print(`users.countDocuments(): ${userCount}`);

const users = db.getCollection("users").find(
  {},
  {
    name: 1,
    email: 1,
    role: 1,
    created_at: 1
  }
).sort({ created_at: 1 }).toArray();

print("users.find(...):");
printjson(users);

const leagueCount = db.getCollection("leagues").countDocuments({});
print(`leagues.countDocuments(): ${leagueCount}`);

const raceCount = db.getCollection("races").countDocuments({});
print(`races.countDocuments(): ${raceCount}`);