"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { publicApiFetch } from "../lib/api";

function formatDate(value) {
  if (!value) return "TBC";
  return new Date(value).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getNextRaceSessions(race) {
  if (!race) return [];

  return [
    { label: "Race start", value: race.raceDate },
    { label: "Sprint Race start", value: race.sprintDate },
    { label: "Sprint Qualification start", value: race.sprintQualifyingDate },
    { label: "Qualification start", value: race.qualifyingDate }
  ].filter((session) => Boolean(session.value));
}

export default function LiveF1Panel({ compact = false, season }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const suffix = season ? `?season=${encodeURIComponent(season)}` : "";
        const payload = await publicApiFetch(`/f1/live${suffix}`);
        if (!active) return;
        setData(payload);
      } catch (err) {
        if (!active) return;
        setError(err.message || "Failed to load live Formula 1 data");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [season]);

  if (loading) {
    return <section className="card p-5 text-sm text-slate-200">Loading live Formula 1 data...</section>;
  }

  if (error || !data) {
    return <section className="card p-5 text-sm text-rose-200">{error || "Live Formula 1 data is unavailable."}</section>;
  }

  const standings = compact ? data.driverStandings.slice(0, 3) : data.driverStandings.slice(0, 5);
  const constructors = compact ? data.constructors.slice(0, 3) : data.constructors.slice(0, 5);
  const upcoming = compact ? data.upcomingRaces.slice(0, 2) : data.upcomingRaces;
  const standingsLabel = data.standingsSeason && data.standingsSeason !== data.season ? `${data.standingsSeason} standings` : `${data.season} standings`;
  const latestResultLabel = data.latestResultSeason && data.latestResultSeason !== data.season ? `${data.latestResultSeason} latest completed race` : "Latest Result";
  const nextRaceSessions = getNextRaceSessions(data.nextRace);

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-white/10 bg-white/5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-accent-cyan">Live F1 Feed</p>
            <h2 className="mt-2 font-display text-3xl text-white">{data.season} championship snapshot</h2>
            <p className="mt-2 text-sm text-slate-300">Powered by {data.source}. Upcoming races, latest results, teams, and driver standings refresh from the free Jolpica API.</p>
            <Link href={`/live?season=${data.season}`} className="mt-3 inline-block text-sm font-semibold text-accent-cyan underline">
              Open full Live F1 page
            </Link>
            {data.snapshotMode === "persisted" ? (
              <p className="mt-2 text-xs text-accent-gold">Showing the last saved snapshot because Jolpica is temporarily rate-limiting requests.</p>
            ) : null}
          </div>
          <div className="rounded-2xl border border-white/15 bg-black/10 px-3 py-2 text-right text-xs text-slate-300">
            <p>{data.completedRaceCount} of {data.totalRaceCount} races completed</p>
            <p className="mt-1">Updated {formatDate(data.fetchedAt)}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-5 md:grid-cols-2">
        <article className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Next Race</p>
          {data.nextRace ? (
            <>
              <p className="mt-2 text-2xl font-extrabold text-white">{data.nextRace.name}</p>
              <p className="mt-1 text-sm text-slate-300">Round {data.nextRace.round} at {data.nextRace.circuitName}</p>
              <p className="mt-1 text-sm text-slate-400">{data.nextRace.locality}, {data.nextRace.country}</p>
              <div className="mt-3 space-y-1 text-sm">
                {nextRaceSessions.map((session) => (
                  <p key={session.label} className="font-semibold text-accent-cyan">
                    {session.label}: {formatDate(session.value)}
                  </p>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-300">No upcoming race is scheduled for this season snapshot.</p>
          )}
        </article>

        <article className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">{latestResultLabel}</p>
          {data.latestRace ? (
            <>
              <p className="mt-2 text-2xl font-extrabold text-white">{data.latestRace.name}</p>
              <p className="mt-1 text-sm text-slate-300">{data.latestRace.circuitName}</p>
              <div className="mt-3 space-y-2 text-sm text-slate-200">
                {data.latestRace.podium.map((entry) => (
                  <div key={`${entry.position}-${entry.driver.id || entry.driver.fullName}`} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2">
                    <p>#{entry.position} {entry.driver.fullName}</p>
                    <p className="text-slate-400">{entry.team?.name || "Team TBC"}</p>
                  </div>
                ))}
              </div>
              {data.latestRace.fastestLap ? (
                <p className="mt-3 text-sm text-accent-cyan">Fastest lap: {data.latestRace.fastestLap.driver.fullName} in {data.latestRace.fastestLap.time || "TBC"}</p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-300">No completed race result is available yet.</p>
          )}
        </article>

        <article className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Upcoming Weekends</p>
          <div className="mt-3 space-y-2 text-sm text-slate-200">
            {upcoming.length > 0 ? upcoming.map((race) => (
              <div key={`${race.season}-${race.round}`} className="rounded-xl bg-white/5 px-3 py-2">
                <p className="font-semibold text-white">{race.name}</p>
                <p className="text-slate-400">Round {race.round} • {race.locality}, {race.country}</p>
                <p className="text-slate-300">{formatDate(race.raceDate)}</p>
              </div>
            )) : <p className="text-slate-300">No upcoming race weekends found.</p>}
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-black/10 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Championship Leaders</p>
          <p className="mt-1 text-xs text-slate-500">{standingsLabel}</p>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold text-white">Drivers</p>
              <div className="mt-2 space-y-2 text-sm text-slate-200">
                {standings.length > 0 ? standings.map((entry) => (
                  <div key={`${entry.position}-${entry.driver.id || entry.driver.fullName}`} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2">
                    <p>#{entry.position} {entry.driver.fullName}</p>
                    <p className="text-slate-400">{entry.points} pts</p>
                  </div>
                )) : <p className="text-slate-300">Standings will appear once official points are published.</p>}
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Constructors</p>
              <div className="mt-2 space-y-2 text-sm text-slate-200">
                {constructors.length > 0 ? constructors.map((entry) => (
                  <div key={`${entry.position}-${entry.team.id || entry.team.name}`} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2">
                    <p>#{entry.position} {entry.team.name}</p>
                    <p className="text-slate-400">{entry.points} pts</p>
                  </div>
                )) : <p className="text-slate-300">Constructor standings will appear once official points are published.</p>}
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}