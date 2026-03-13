"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Header from "../../components/Header";
import BottomNav from "../../components/BottomNav";
import { apiFetch } from "../../lib/api";

const AUTO_REFRESH_MS = 15 * 60 * 1000;

function LeaderboardPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentYear = new Date().getUTCFullYear();

  const searchYear = searchParams.get("year") || String(currentYear);
  const searchLeagueId = searchParams.get("leagueId") || "";
  const searchBoardMode = searchParams.get("boardMode") || "racePoints";
  const searchRaceId = searchParams.get("raceId") || "";
  const submitted = searchParams.get("submitted") === "1";
  const submittedRace = searchParams.get("submittedRace") || "your race";

  const [year, setYear] = useState(searchYear);
  const [boardMode, setBoardMode] = useState(searchBoardMode);
  const [availableYears, setAvailableYears] = useState([]);
  const [availableLeagues, setAvailableLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState(searchLeagueId);
  const [races, setRaces] = useState([]);
  const [rows, setRows] = useState([]);
  const [latestRace, setLatestRace] = useState(null);
  const [latestCategories, setLatestCategories] = useState([]);
  const [latestRows, setLatestRows] = useState([]);
  const [selectedRaceId, setSelectedRaceId] = useState(searchRaceId);

  function replaceUrl(nextValues) {
    const params = new URLSearchParams(searchParams.toString());
    const nextYear = nextValues.year ?? year;
    const nextLeagueId = nextValues.leagueId ?? leagueId;
    const nextBoardMode = nextValues.boardMode ?? boardMode;
    const nextRaceId = nextValues.raceId ?? selectedRaceId;

    params.set("year", String(nextYear));

    if (nextLeagueId) params.set("leagueId", nextLeagueId);
    else params.delete("leagueId");

    if (nextBoardMode !== "racePoints") params.set("boardMode", nextBoardMode);
    else params.delete("boardMode");

    if (nextRaceId) params.set("raceId", nextRaceId);
    else params.delete("raceId");

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  async function loadBoard(targetYear, targetLeagueId, targetRaceId) {
    try {
      const leagueQuery = targetLeagueId ? `&leagueId=${targetLeagueId}` : "";
      const raceQuery = targetRaceId ? `&raceId=${targetRaceId}` : "";
      const [seasonData, latestData] = await Promise.all([
        apiFetch(`/leaderboard/season?year=${targetYear}${leagueQuery}`),
        apiFetch(`/leaderboard/latest?year=${targetYear}${leagueQuery}${raceQuery}`)
      ]);

      const leagues = seasonData.availableLeagues || latestData.availableLeagues || [];
      const resolvedLeagueId = targetLeagueId || seasonData.leagueId || leagues[0]?.id || "";
      const raceExists = Boolean(targetRaceId) && (seasonData.races || []).some((race) => race.id === targetRaceId);

      setRows(seasonData.rows || []);
      setRaces(seasonData.races || []);
      setAvailableYears(seasonData.availableYears || []);
      setAvailableLeagues(leagues);
      setLatestRace(latestData.latestRace || null);
      setLatestCategories(latestData.categories || []);
      setLatestRows(latestData.rows || []);
      if (latestData.latestRace?.id && (!targetRaceId || !raceExists || latestData.latestRace.id !== targetRaceId)) {
        setSelectedRaceId(latestData.latestRace.id);
      }

      if (resolvedLeagueId && resolvedLeagueId !== leagueId) {
        setLeagueId(resolvedLeagueId);
        replaceUrl({ year: targetYear, leagueId: resolvedLeagueId });
      }
    } catch {
      setRows([]);
      setRaces([]);
      setAvailableYears([]);
      setAvailableLeagues([]);
      setLatestRace(null);
      setLatestCategories([]);
      setLatestRows([]);
    }
  }

  useEffect(() => {
    loadBoard(year, leagueId, selectedRaceId);
  }, [year, leagueId, selectedRaceId]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadBoard(year, leagueId, selectedRaceId);
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [year, leagueId, selectedRaceId]);

  useEffect(() => {
    if (searchYear !== year) setYear(searchYear);
    if (searchLeagueId !== leagueId) setLeagueId(searchLeagueId);
    if (searchBoardMode !== boardMode) setBoardMode(searchBoardMode);
    if (searchRaceId !== selectedRaceId) setSelectedRaceId(searchRaceId);
  }, [searchYear, searchLeagueId, searchBoardMode, searchRaceId]);

  useEffect(() => {
    replaceUrl({ year, leagueId, boardMode, raceId: selectedRaceId });
  }, [year, leagueId, boardMode, selectedRaceId]);

  function raceShortName(name) {
    return name.replace(" Grand Prix", "");
  }

  return (
    <div className="pb-24">
      <Header title="Leaderboard" subtitle={`Season ${year} standings and race result scoring`} />

      {submitted ? (
        <section className="card mb-3 border border-emerald-300/30 bg-emerald-500/10 p-3">
          <p className="text-sm font-semibold text-emerald-100">Predictions submitted for {submittedRace}.</p>
          <p className="mt-1 text-xs text-emerald-200">Your updated standings will appear here after results are scored.</p>
        </section>
      ) : null}

      <section className="card mb-3 p-3">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-slate-200">
            <span className="mb-1 block font-semibold text-accent-cyan">Season Year</span>
            <select
              className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            >
              {(availableYears.length > 0 ? availableYears : [currentYear]).map((optionYear) => (
                <option key={optionYear} value={String(optionYear)} className="bg-track-900 text-white">
                  {optionYear}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-slate-200">
            <span className="mb-1 block font-semibold text-accent-cyan">League</span>
            <select
              className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
              value={leagueId}
              onChange={(e) => setLeagueId(e.target.value)}
              disabled={availableLeagues.length === 0}
            >
              {availableLeagues.length === 0 ? (
                <option value="" className="bg-track-900 text-white">Loading leagues...</option>
              ) : null}
              {availableLeagues.map((league) => (
                <option key={league.id} value={league.id} className="bg-track-900 text-white">
                  {league.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {availableLeagues.length > 1 ? (
          <p className="mt-2 text-xs text-slate-400">
            Switch between every league this player belongs to.
          </p>
        ) : null}

        <div className="mt-3">
          <span className="mb-1 block text-sm font-semibold text-accent-cyan">Main Leaderboard View</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={`tap rounded-xl px-3 py-2 text-sm font-bold ${
                boardMode === "racePoints" ? "bg-accent-red text-white" : "border border-white/30 text-slate-200"
              }`}
              onClick={() => setBoardMode("racePoints")}
            >
              Season Points
            </button>
            <button
              type="button"
              className={`tap rounded-xl px-3 py-2 text-sm font-bold ${
                boardMode === "latestRace" ? "bg-accent-red text-white" : "border border-white/30 text-slate-200"
              }`}
              onClick={() => setBoardMode("latestRace")}
            >
              Race Results
            </button>
          </div>
        </div>
      </section>

      {boardMode === "racePoints" ? (
        <section className="card overflow-x-auto p-2">
          <table className="min-w-[760px] text-sm text-slate-100">
            <thead>
              <tr className="border-b border-white/20">
                <th className="px-2 py-2 text-left text-accent-cyan">#</th>
                <th className="px-2 py-2 text-left text-accent-cyan">Player</th>
                <th className="px-2 py-2 text-left text-accent-cyan">Total</th>
                {races.map((race) => (
                  <th key={race.id} className="px-2 py-2 text-left text-accent-cyan" title={race.name}>
                    {raceShortName(race.name)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.id} className="border-b border-white/10 last:border-0">
                  <td className="px-2 py-3 text-accent-gold">#{idx + 1}</td>
                  <td className="px-2 py-3 font-semibold">
                    <Link href={`/leaderboard/player/${row.id}?year=${year}${leagueId ? `&leagueId=${leagueId}` : ""}`} className="text-accent-cyan underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className="px-2 py-3 font-bold text-accent-gold">{row.totalPoints}</td>
                  {races.map((race) => (
                    <td key={`${row.id}-${race.id}`} className="px-2 py-3">
                      {row.racePoints?.[race.id] ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="card overflow-x-auto p-2">
          <div className="px-2 pb-3">
            <label className="block text-sm text-slate-200">
              <span className="mb-1 block font-semibold text-accent-cyan">Race Weekend</span>
              <select
                className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
                value={selectedRaceId}
                onChange={(e) => setSelectedRaceId(e.target.value)}
                disabled={races.length === 0}
              >
                {races.map((race) => (
                  <option key={race.id} value={race.id} className="bg-track-900 text-white">
                    {race.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {latestRace ? (
            <p className="px-2 pb-2 text-xs text-slate-400">
              Showing <span className="text-accent-cyan">{latestRace.name}</span>. Defaults to the current race weekend when active, otherwise the latest scored race.
            </p>
          ) : (
            <p className="px-2 pb-2 text-xs text-slate-400">No synced race weekend results available for {year}.</p>
          )}
          {latestRace ? (
            <table className="min-w-[760px] text-sm text-slate-100">
              <thead>
                <tr className="border-b border-white/20">
                  <th className="px-2 py-2 text-left text-accent-cyan">#</th>
                  <th className="px-2 py-2 text-left text-accent-cyan">Player</th>
                  <th className="px-2 py-2 text-left text-accent-cyan">Race Total</th>
                  {latestCategories.map((category) => (
                    <th key={category.id} className="px-2 py-2 text-left text-accent-cyan" title={category.name}>
                      {category.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {latestRows.map((row, idx) => (
                  <tr key={row.id} className="border-b border-white/10 last:border-0">
                    <td className="px-2 py-3 text-accent-gold">#{idx + 1}</td>
                    <td className="px-2 py-3 font-semibold">
                      <Link href={`/leaderboard/player/${row.id}?year=${year}&raceId=${latestRace.id}${leagueId ? `&leagueId=${leagueId}` : ""}`} className="text-accent-cyan underline">
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-2 py-3 font-bold text-accent-gold">{row.raceTotal}</td>
                    {latestCategories.map((category) => {
                      const points = row.categoryPoints?.[category.id] ?? 0;
                      const pickedValue = row.categoryPicks?.[category.id] || "-";
                      const officialValue = category.officialValue || "Not scored yet";
                      return (
                        <td
                          key={`${row.id}:${category.id}`}
                          className="px-2 py-3"
                          title={`${category.name}: picked ${pickedValue}; official ${officialValue}; awarded ${points} points`}
                        >
                          {points}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      )}
      <BottomNav />
    </div>
  );
}

export default function LeaderboardPage() {
  return (
    <Suspense fallback={<div className="pb-24"><Header title="Season Leaderboard" subtitle="Loading standings" /><p className="card p-4 text-sm text-slate-300">Loading leaderboard...</p><BottomNav /></div>}>
      <LeaderboardPageContent />
    </Suspense>
  );
}