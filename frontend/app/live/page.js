"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Header from "../../components/Header";
import BottomNav from "../../components/BottomNav";
import { publicApiFetch } from "../../lib/api";
import { getCircuitVisual, getDriverVisual, getRaceVisualKey, getTeamVisual, resolveVisualOverride } from "../../lib/f1Media";
import { useF1MediaOverrides } from "../../lib/f1MediaOverrides";

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

function LiveF1PageContent() {
  const currentYear = new Date().getUTCFullYear();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialSeason = searchParams.get("season") || String(currentYear);

  const [season, setSeason] = useState(initialSeason);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mediaOverrides = useF1MediaOverrides();

  useEffect(() => {
    setSeason(initialSeason);
  }, [initialSeason]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const payload = await publicApiFetch(`/f1/live?season=${encodeURIComponent(season)}`);
        if (!active) return;
        setData(payload);
      } catch (err) {
        if (!active) return;
        setData(null);
        setError(err.message || "Failed to load live F1 data");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [season]);

  function updateSeason(nextSeason) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("season", nextSeason);
    router.replace(`${pathname}?${params.toString()}`);
  }

  const seasonOptions = [currentYear, currentYear - 1, currentYear - 2].map(String);
  const nextRaceSessions = getNextRaceSessions(data?.nextRace);
  const nextRaceVisual = data?.nextRace
    ? resolveVisualOverride(getCircuitVisual(data.nextRace), mediaOverrides.races?.[getRaceVisualKey(data.nextRace)])
    : null;
  const latestRaceVisual = data?.latestRace
    ? resolveVisualOverride(getCircuitVisual(data.latestRace), mediaOverrides.races?.[getRaceVisualKey(data.latestRace)])
    : null;

  return (
    <div className="space-y-4 pb-24">
      <Header title="Live F1" subtitle="Full race calendar, constructors, and driver detail from Jolpica" />

      <section className="card p-4 text-sm text-slate-200">
        <label className="block">
          <span className="mb-1 block font-semibold text-accent-cyan">Season</span>
          <select
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            value={season}
            onChange={(e) => updateSeason(e.target.value)}
          >
            {seasonOptions.map((option) => (
              <option key={option} value={option} className="bg-track-900 text-white">
                {option}
              </option>
            ))}
          </select>
        </label>
      </section>

      {loading ? <p className="card p-4 text-sm text-slate-300">Loading live F1 season data...</p> : null}
      {error ? <p className="card p-4 text-sm text-red-300">{error}</p> : null}

      {data ? (
        <>
          {data.snapshotMode === "persisted" ? (
            <p className="card p-4 text-sm text-accent-gold">Using the last saved Live F1 snapshot because the Jolpica API is temporarily unavailable.</p>
          ) : null}
          <section className="grid gap-4 md:grid-cols-2">
            <article className="card p-4">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-accent-cyan">Next Race</p>
              {data.nextRace ? (
                <>
                  {nextRaceVisual ? <img src={nextRaceVisual.src} alt={nextRaceVisual.alt} className="h-40 w-full rounded-2xl object-cover" /> : null}
                  <p className="mt-2 font-display text-3xl text-white">{data.nextRace.name}</p>
                  <p className="mt-1 text-sm text-slate-300">Round {data.nextRace.round} at {data.nextRace.circuitName}</p>
                  <p className="text-sm text-slate-400">{data.nextRace.locality}, {data.nextRace.country}</p>
                  <div className="mt-3 space-y-1 text-sm">
                    {nextRaceSessions.map((session) => (
                      <p key={session.label} className="font-semibold text-accent-cyan">
                        {session.label}: {formatDate(session.value)}
                      </p>
                    ))}
                  </div>
                </>
              ) : <p className="mt-2 text-sm text-slate-300">No next race available.</p>}
            </article>

            <article className="card p-4">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-accent-cyan">Latest Completed Race</p>
              {data.latestRace ? (
                <>
                  {latestRaceVisual ? <img src={latestRaceVisual.src} alt={latestRaceVisual.alt} className="h-40 w-full rounded-2xl object-cover" /> : null}
                  <p className="mt-2 font-display text-3xl text-white">{data.latestRace.name}</p>
                  <p className="mt-1 text-sm text-slate-300">{data.latestRace.circuitName}</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-100">
                    {data.latestRace.podium.map((entry) => (
                      <div key={`${entry.position}-${entry.driver.id || entry.driver.fullName}`} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                        <p>#{entry.position} {entry.driver.fullName}</p>
                        <p className="text-slate-400">{entry.team?.name || "Team TBC"}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : <p className="mt-2 text-sm text-slate-300">No completed race available yet.</p>}
            </article>
          </section>

          <section className="card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.25em] text-accent-cyan">Race Calendar</p>
                <h2 className="mt-1 font-display text-3xl text-white">{data.season} full season</h2>
              </div>
              <p className="text-xs text-slate-400">{data.completedRaceCount}/{data.totalRaceCount} completed</p>
            </div>

            <div className="mt-4 space-y-3">
              {data.calendar.map((race) => {
                const circuitVisual = resolveVisualOverride(
                  getCircuitVisual(race),
                  mediaOverrides.races?.[getRaceVisualKey(race)]
                );

                return (
                <article key={`${race.season}-${race.round}`} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <img src={circuitVisual.src} alt={circuitVisual.alt} className="mb-3 h-24 w-full rounded-2xl object-cover md:hidden" />
                      <p className="text-sm font-semibold text-accent-cyan">Round {race.round}</p>
                      <p className="font-display text-2xl text-white">{race.name}</p>
                      <p className="text-sm text-slate-300">{race.circuitName}</p>
                      <p className="text-sm text-slate-400">{race.locality}, {race.country}</p>
                    </div>
                    <img src={circuitVisual.src} alt={circuitVisual.alt} className="hidden h-24 w-44 rounded-2xl object-cover md:block" />
                    <div className="text-right text-xs text-slate-400">
                      <p>{formatDate(race.raceDate)}</p>
                      {race.qualifyingDate ? <p className="mt-1">Qualifying: {formatDate(race.qualifyingDate)}</p> : null}
                      {race.hasSprint && race.sprintDate ? <p className="mt-1 text-accent-gold">Sprint: {formatDate(race.sprintDate)}</p> : null}
                    </div>
                  </div>
                </article>
                );
              })}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="card p-4">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-accent-cyan">Teams</p>
              <div className="mt-4 space-y-3">
                {data.constructors.map((entry) => {
                  const teamVisual = resolveVisualOverride(getTeamVisual(entry.team), mediaOverrides.teams?.[entry.team.id]);

                  return (
                  <Link
                    key={entry.team.id || entry.team.name}
                    href={`/live/teams/${entry.team.id}?season=${data.season}`}
                    className="block rounded-2xl border border-white/10 bg-black/10 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <img src={teamVisual.src} alt={teamVisual.alt} className="h-16 w-24 rounded-xl object-cover" />
                      <div>
                        <p className="font-semibold text-white">#{entry.position} {entry.team.name}</p>
                        <p className="text-sm text-slate-400">{entry.team.nationality || "Unknown nationality"}</p>
                      </div>
                      <div className="text-right text-sm text-slate-300">
                        <p>{entry.points} pts</p>
                        <p>{entry.wins} wins</p>
                      </div>
                    </div>
                  </Link>
                  );
                })}
              </div>
            </article>

            <article className="card p-4">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-accent-cyan">Drivers</p>
              <div className="mt-4 space-y-3">
                {data.driverStandings.map((entry) => {
                  const driverVisual = resolveVisualOverride(getDriverVisual(entry.driver, entry.team), mediaOverrides.drivers?.[entry.driver.id]);

                  return (
                  <Link
                    key={entry.driver.id || entry.driver.fullName}
                    href={`/live/drivers/${entry.driver.id}?season=${data.season}`}
                    className="block rounded-2xl border border-white/10 bg-black/10 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <img src={driverVisual.src} alt={driverVisual.alt} className="h-16 w-24 rounded-xl object-cover" />
                      <div>
                        <p className="font-semibold text-white">#{entry.position} {entry.driver.fullName}</p>
                        <p className="text-sm text-slate-400">{entry.team?.name || "Team TBC"}</p>
                      </div>
                      <div className="text-right text-sm text-slate-300">
                        <p>{entry.points} pts</p>
                        <p>{entry.wins} wins</p>
                      </div>
                    </div>
                  </Link>
                  );
                })}
              </div>
            </article>
          </section>
        </>
      ) : null}

      <BottomNav />
    </div>
  );
}

export default function LiveF1Page() {
  return (
    <Suspense fallback={<div className="space-y-4 pb-24"><Header title="Live F1" subtitle="Loading live race data" /><p className="card p-4 text-sm text-slate-300">Loading live F1 data...</p><BottomNav /></div>}>
      <LiveF1PageContent />
    </Suspense>
  );
}