"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Header from "../../components/Header";
import BottomNav from "../../components/BottomNav";
import LiveF1Panel from "../../components/LiveF1Panel";
import { apiFetch } from "../../lib/api";

export default function DashboardPage() {
  const nearestRaceWindowMs = 24 * 60 * 60 * 1000;
  const [races, setRaces] = useState([]);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [leagueMessage, setLeagueMessage] = useState("");
  const [myLeagues, setMyLeagues] = useState([]);

  async function loadLeagues() {
    try {
      const leagues = await apiFetch("/leagues/mine");
      setMyLeagues(leagues);
    } catch {
      setMyLeagues([]);
    }
  }

  useEffect(() => {
    apiFetch("/races")
      .then(setRaces)
      .catch(() => setRaces([]));

    loadLeagues();
  }, []);

  async function joinLeague(e) {
    e.preventDefault();
    setLeagueMessage("");
    try {
      const joined = await apiFetch("/leagues/join", {
        method: "POST",
        body: JSON.stringify({ inviteCode })
      });
      setLeagueMessage(`Joined: ${joined.league.name}`);
      setInviteCode("");
      await loadLeagues();
    } catch (err) {
      setLeagueMessage(err.message);
    }
  }

  const scheduledRaces = races
    .filter((race) => race.status !== "completed" || race.has_results)
    .sort((a, b) => {
      if (a.has_results && !b.has_results) return 1;
      if (!a.has_results && b.has_results) return -1;
      if (a.has_results && b.has_results) {
        return new Date(b.deadline_at).getTime() - new Date(a.deadline_at).getTime();
      }
      return new Date(a.deadline_at).getTime() - new Date(b.deadline_at).getTime();
    });

  const nearestRaceCutoff = Date.now() - nearestRaceWindowMs;
  const nearestRaceCandidates = races
    .filter((race) => race.status !== "completed" || race.has_results)
    .filter((race) => {
      const raceTime = new Date(race.race_date || race.deadline_at).getTime();
      if (Number.isNaN(raceTime)) return true;
      return raceTime >= nearestRaceCutoff;
    })
    .sort((a, b) => new Date(a.race_date || a.deadline_at).getTime() - new Date(b.race_date || b.deadline_at).getTime());

  const displayedRaces = showAllUpcoming ? scheduledRaces : nearestRaceCandidates.slice(0, 1);

  function getLeaderboardResultsHref(race) {
    const raceTime = new Date(race.race_date || race.deadline_at);
    const year = Number.isNaN(raceTime.getTime()) ? new Date().getUTCFullYear() : raceTime.getUTCFullYear();
    const params = new URLSearchParams({
      boardMode: "latestRace",
      raceId: race.id,
      year: String(year)
    });
    return `/leaderboard?${params.toString()}`;
  }

  return (
    <div className="space-y-4 pb-24">
      <Header title="Upcoming Races" subtitle="Submit your picks before lock" />

      <section className="card p-4 text-sm text-slate-200">
        <p className="font-semibold text-accent-cyan">Your Leagues</p>
        {myLeagues.length === 0 ? <p className="mt-2 text-slate-300">You are not in a league yet.</p> : null}
        {myLeagues.map((league) => (
          <p key={league.id} className="mt-1 text-slate-100">
            {league.name}
          </p>
        ))}

        <form onSubmit={joinLeague} className="mt-3 space-y-2">
          <input
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            placeholder="Enter league invite code"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            required
          />
          <button className="tap rounded-xl bg-accent-cyan px-3 py-2 font-bold text-track-900">Join League</button>
          {leagueMessage ? <p className="text-accent-gold">{leagueMessage}</p> : null}
        </form>
      </section>

      {scheduledRaces.length > 1 ? (
        <button
          type="button"
          className="tap rounded-xl border border-white/30 px-3 py-2 text-sm font-semibold text-slate-100"
          onClick={() => setShowAllUpcoming((v) => !v)}
        >
          {showAllUpcoming ? "Show nearest race only" : "Show all races"}
        </button>
      ) : null}

      {displayedRaces.map((race) => (
        <article key={race.id} className="card p-4">
          <p className="font-display text-2xl text-accent-cyan">{race.name}</p>
          <p className="text-sm text-slate-300">{race.circuit_name}</p>
          <p className="mt-2 text-xs text-slate-400">Deadline: {new Date(race.deadline_at).toLocaleString()}</p>
          <p className="mt-1 text-xs text-slate-400">
            {race.has_results
              ? "Results are available for this race."
              : race.is_visible === false
              ? "This race is currently hidden by the admin."
              : race.predictions_live === false
              ? "Predictions are not live yet."
              : race.is_locked
              ? "Predictions are closed for this race."
              : "Predictions are live."}
          </p>
          {race.has_results ? (
            <Link
              href={getLeaderboardResultsHref(race)}
              className="tap mt-3 block rounded-xl bg-accent-cyan px-3 py-2 text-center font-bold text-track-900"
            >
              View Results
            </Link>
          ) : race.is_visible === false || race.predictions_live === false || race.is_locked ? (
            <button
              type="button"
              disabled
              className="tap mt-3 block w-full cursor-not-allowed rounded-xl bg-slate-600 px-3 py-2 text-center font-bold text-slate-200 opacity-70"
            >
              Make Picks
            </button>
          ) : (
            <Link
              href={`/races/${race.id}/picks`}
              className="tap mt-3 block rounded-xl bg-accent-red px-3 py-2 text-center font-bold text-white"
            >
              Make Picks
            </Link>
          )}
        </article>
      ))}
      {displayedRaces.length === 0 ? <p className="card p-4 text-sm text-slate-300">No races available.</p> : null}

      <LiveF1Panel />

      <BottomNav />
    </div>
  );
}
