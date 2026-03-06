"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Header from "../../../../components/Header";
import BottomNav from "../../../../components/BottomNav";
import { apiFetch } from "../../../../lib/api";

export default function PlayerLeaderboardDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const year = searchParams.get("year") || String(new Date().getUTCFullYear());
  const leagueId = searchParams.get("leagueId") || "";
  const initialRaceId = searchParams.get("raceId") || "all";
  const userId = params.userId;
  const [selectedRaceId, setSelectedRaceId] = useState(initialRaceId);

  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");

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
  }, [userId, year, selectedRaceId]);

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
        <section className="card overflow-x-auto p-3">
          <div className="mb-3 px-1 text-sm text-slate-200">
            <p className="font-display text-2xl text-accent-cyan">{detail.user.name}</p>
            <p className="font-bold text-accent-gold">Total: {detail.totalPoints} pts</p>
          </div>

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
                      <td className="px-2 py-2">{pick.pickValue || "-"}</td>
                      <td className="px-2 py-2">{pick.resultValue || "-"}</td>
                      <td className="px-2 py-2 font-bold text-accent-gold">{pick.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      ) : null}

      <BottomNav />
    </div>
  );
}
