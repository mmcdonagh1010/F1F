"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Header from "../../../../components/Header";
import BottomNav from "../../../../components/BottomNav";
import { apiFetch } from "../../../../lib/api";

function buildPlayerStats(detail) {
  const races = detail?.races || [];
  const picks = races.flatMap((race) => race.picks || []);
  const totalPicks = picks.length;
  const exactHits = picks.filter((pick) => {
    if (pick.isPositionPrediction) return pick.positionsAway === 0;
    return Boolean(pick.pickValue) && pick.pickValue === pick.resultValue;
  }).length;
  const scoredPicks = picks.filter((pick) => Number(pick.points || 0) > 0).length;
  const averageRacePoints = races.length > 0 ? detail.totalPoints / races.length : 0;
  const bestRace = races.reduce((best, race) => (!best || race.racePoints > best.racePoints ? race : best), null);
  const pickTotals = new Map();

  picks.forEach((pick) => {
    const label = String(pick.pickValue || "").trim();
    if (!label) return;
    pickTotals.set(label, (pickTotals.get(label) || 0) + Number(pick.points || 0));
  });

  const topPrediction = Array.from(pickTotals.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;

  return {
    totalPicks,
    exactHits,
    scoredPicks,
    exactRate: totalPicks > 0 ? (exactHits / totalPicks) * 100 : 0,
    averageRacePoints,
    bestRace,
    topPrediction
  };
}

function raceShortName(name) {
  return String(name || "").replace(" Grand Prix", "");
}

function formatPickedValue(pick) {
  if (!pick?.pickValue) return "-";
  if (pick.isPositionPrediction && pick.actualPickedPosition) {
    return `${pick.pickValue} [P${pick.actualPickedPosition}]`;
  }
  return pick.pickValue;
}

function PlayerLeaderboardDetailPageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const year = searchParams.get("year") || String(new Date().getUTCFullYear());
  const leagueId = searchParams.get("leagueId") || "";
  const initialRaceId = searchParams.get("raceId") || "all";
  const userId = params.userId;
  const [selectedRaceId, setSelectedRaceId] = useState(initialRaceId);

  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const stats = useMemo(() => buildPlayerStats(detail), [detail]);

  useEffect(() => {
    const raceQuery = selectedRaceId !== "all" ? `&raceId=${selectedRaceId}` : "";
    apiFetch(`/leaderboard/season/player/${userId}?year=${year}${leagueId ? `&leagueId=${leagueId}` : ""}${raceQuery}`)
      .then((data) => {
        setDetail(data);
        setError("");
      })
      .catch((err) => {
        setDetail(null);
        setError(err.message);
      });
  }, [userId, year, leagueId, selectedRaceId]);

  useEffect(() => {
    setSelectedRaceId(initialRaceId);
  }, [initialRaceId]);

  return (
    <div className="pb-24">
      <Header title="Player Scoring Detail" subtitle={`Year ${year} race-by-race breakdown`} />

      <section className="card mb-3 p-4 text-sm text-slate-200">
        <Link href={`/leaderboard?year=${year}${leagueId ? `&leagueId=${leagueId}` : ""}`} className="text-accent-cyan underline">
          Back to Leaderboard
        </Link>
      </section>

      {error ? <p className="card p-4 text-sm text-red-300">{error}</p> : null}

      {detail ? (
        <section className="space-y-4">
          <div className="card p-4 text-sm text-slate-200">
            <p className="font-display text-2xl text-accent-cyan">{detail.user.name}</p>
            <p className="font-bold text-accent-gold">Total: {detail.totalPoints} pts</p>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-white/15 bg-white/5 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Exact Picks</p>
                <p className="mt-2 text-2xl font-semibold text-white">{stats.exactHits}</p>
                <p className="mt-1 text-xs text-slate-400">{stats.exactRate.toFixed(1)}% of all picks</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/5 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Scoring Picks</p>
                <p className="mt-2 text-2xl font-semibold text-white">{stats.scoredPicks}</p>
                <p className="mt-1 text-xs text-slate-400">Out of {stats.totalPicks} total predictions</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/5 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Average Race</p>
                <p className="mt-2 text-2xl font-semibold text-white">{stats.averageRacePoints.toFixed(1)}</p>
                <p className="mt-1 text-xs text-slate-400">Points per race weekend</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/5 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Top Prediction</p>
                <p className="mt-2 text-lg font-semibold text-white">{stats.topPrediction?.[0] || "N/A"}</p>
                <p className="mt-1 text-xs text-slate-400">{stats.topPrediction ? `${stats.topPrediction[1]} points earned` : "No scored picks yet"}</p>
              </div>
            </div>
            {detail.races.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-white/15 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">Race History</p>
                    <p className="text-xs text-slate-400">Best race: {stats.bestRace ? `${stats.bestRace.raceName} (${stats.bestRace.racePoints} pts)` : "N/A"}</p>
                  </div>
                </div>
                <div className="mt-4 flex h-40 items-end gap-2 overflow-x-auto pb-2">
                  {detail.races.map((race) => {
                    const peak = Math.max(...detail.races.map((row) => row.racePoints), 1);
                    const heightPercent = Math.max(10, Math.round((race.racePoints / peak) * 100));
                    return (
                      <div key={race.raceId} className="flex min-w-[56px] flex-col items-center gap-2">
                        <div className="text-xs font-semibold text-accent-gold">{race.racePoints}</div>
                        <div className="flex h-28 w-full items-end rounded-xl bg-white/5 px-2 pb-2">
                          <div className="w-full rounded-xl bg-gradient-to-t from-accent-red to-accent-cyan" style={{ height: `${heightPercent}%` }} />
                        </div>
                        <div className="text-center text-[10px] uppercase tracking-[0.18em] text-slate-400">{raceShortName(race.raceName)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <div className="card overflow-x-auto p-3">
            <div className="mb-4 px-1">
            <label className="block text-sm text-slate-200">
              <span className="mb-1 block font-semibold text-accent-cyan">Filter By Race</span>
              <select
                className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
                value={selectedRaceId}
                onChange={(e) => setSelectedRaceId(e.target.value)}
              >
                <option value="all" className="bg-track-900 text-white">
                  All races
                </option>
                {(detail.availableRaces || []).map((race) => (
                  <option key={race.raceId} value={race.raceId} className="bg-track-900 text-white">
                    {race.raceName}
                  </option>
                ))}
              </select>
            </label>
            </div>

            {(detail.races || []).map((race) => (
              <div key={race.raceId} className="mb-4 rounded-xl border border-white/20 bg-white/5 p-3 last:mb-0">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold text-slate-100">{race.raceName}</p>
                <p className="font-bold text-accent-gold">{race.racePoints} pts</p>
              </div>
              <p className="mb-3 text-xs text-slate-400">{new Date(race.raceDate).toLocaleDateString()}</p>

              <table className="min-w-[560px] text-xs text-slate-100">
                <thead>
                  <tr className="border-b border-white/20">
                    <th className="px-2 py-2 text-left text-accent-cyan">Category</th>
                    <th className="px-2 py-2 text-left text-accent-cyan">Pick</th>
                    <th className="px-2 py-2 text-left text-accent-cyan">Official</th>
                    <th className="px-2 py-2 text-left text-accent-cyan">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {race.picks.map((pick) => (
                    <tr key={pick.categoryId} className="border-b border-white/10 last:border-0">
                      <td className="px-2 py-2">{pick.categoryName}</td>
                      <td className="px-2 py-2">{formatPickedValue(pick)}</td>
                      <td className="px-2 py-2">{pick.resultValue || "-"}</td>
                      <td className="px-2 py-2 font-bold text-accent-gold">
                        {pick.points}
                        {pick.isPositionPrediction && pick.positionsAway !== null ? (
                          <span className="ml-2 text-[11px] font-medium text-slate-400">
                            {pick.positionsAway === 0 ? "exact" : `${pick.positionsAway} away`}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <BottomNav />
    </div>
  );
}

export default function PlayerLeaderboardDetailPage() {
  return (
    <Suspense fallback={<div className="pb-24"><Header title="Player Scoring Detail" subtitle="Loading breakdown" /><p className="card p-4 text-sm text-slate-300">Loading player detail...</p><BottomNav /></div>}>
      <PlayerLeaderboardDetailPageContent />
    </Suspense>
  );
}
