"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Header from "../../components/Header";
import BottomNav from "../../components/BottomNav";
import { apiFetch } from "../../lib/api";

export default function LeaderboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentYear = new Date().getUTCFullYear();

  const searchYear = searchParams.get("year") || String(currentYear);
  const searchLeagueId = searchParams.get("leagueId") || "";
  const searchBoardMode = searchParams.get("boardMode") || "racePoints";
  const searchViewMode = searchParams.get("viewMode") || "summary";

  const [year, setYear] = useState(searchYear);
  const [boardMode, setBoardMode] = useState(searchBoardMode);
  const [viewMode, setViewMode] = useState(searchViewMode);
  const [availableYears, setAvailableYears] = useState([]);
  const [availableLeagues, setAvailableLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState(searchLeagueId);
  const [races, setRaces] = useState([]);
  const [rows, setRows] = useState([]);
  const [latestRace, setLatestRace] = useState(null);
  const [latestCategories, setLatestCategories] = useState([]);
  const [latestRows, setLatestRows] = useState([]);
  const [revealedRaceId, setRevealedRaceId] = useState("");
  const [revealedRows, setRevealedRows] = useState([]);
  const [revealMessage, setRevealMessage] = useState("");

  function replaceUrl(nextValues) {
    const params = new URLSearchParams(searchParams.toString());
    const nextYear = nextValues.year ?? year;
    const nextLeagueId = nextValues.leagueId ?? leagueId;
    const nextBoardMode = nextValues.boardMode ?? boardMode;
    const nextViewMode = nextValues.viewMode ?? viewMode;

    params.set("year", String(nextYear));

    if (nextLeagueId) params.set("leagueId", nextLeagueId);
    else params.delete("leagueId");

    if (nextBoardMode !== "racePoints") params.set("boardMode", nextBoardMode);
    else params.delete("boardMode");

    if (nextViewMode !== "summary") params.set("viewMode", nextViewMode);
    else params.delete("viewMode");

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  async function loadBoard(targetYear, targetLeagueId) {
    try {
      const leagueQuery = targetLeagueId ? `&leagueId=${targetLeagueId}` : "";
      const [seasonData, latestData] = await Promise.all([
        apiFetch(`/leaderboard/season?year=${targetYear}${leagueQuery}`),
        apiFetch(`/leaderboard/latest?year=${targetYear}${leagueQuery}`)
      ]);

      const leagues = seasonData.availableLeagues || latestData.availableLeagues || [];
      const resolvedLeagueId = targetLeagueId || seasonData.leagueId || leagues[0]?.id || "";

      setRows(seasonData.rows || []);
      setRaces(seasonData.races || []);
      setAvailableYears(seasonData.availableYears || []);
      setAvailableLeagues(leagues);
      setLatestRace(latestData.latestRace || null);
      setLatestCategories(latestData.categories || []);
      setLatestRows(latestData.rows || []);

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
    loadBoard(year, leagueId);
  }, [year, leagueId]);

  useEffect(() => {
    if (!revealedRaceId) {
      setRevealedRows([]);
      setRevealMessage("");
      return;
    }

    apiFetch(`/picks/${revealedRaceId}/reveal${leagueId ? `?leagueId=${leagueId}` : ""}`)
      .then((data) => {
        setRevealedRows(data.picks || []);
        setRevealMessage("");
      })
      .catch((err) => {
        setRevealedRows([]);
        setRevealMessage(err.message);
      });
  }, [revealedRaceId, leagueId]);

  useEffect(() => {
    if (searchYear !== year) setYear(searchYear);
    if (searchLeagueId !== leagueId) setLeagueId(searchLeagueId);
    if (searchBoardMode !== boardMode) setBoardMode(searchBoardMode);
    if (searchViewMode !== viewMode) setViewMode(searchViewMode);
  }, [searchYear, searchLeagueId, searchBoardMode, searchViewMode]);

  useEffect(() => {
    replaceUrl({ year, leagueId, boardMode, viewMode });
  }, [year, leagueId, boardMode, viewMode]);

  function raceShortName(name) {
    return name.replace(" Grand Prix", "");
  }

  const racesToDisplay = viewMode === "summary" ? races.slice(0, 3) : races;

  return (
    <div className="pb-24">
      <Header title="Season Leaderboard" subtitle={`Year ${year} with race-by-race points`} />

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
              By Race Points
            </button>
            <button
              type="button"
              className={`tap rounded-xl px-3 py-2 text-sm font-bold ${
                boardMode === "latestRace" ? "bg-accent-red text-white" : "border border-white/30 text-slate-200"
              }`}
              onClick={() => setBoardMode("latestRace")}
            >
              Latest Race Results
            </button>
          </div>
        </div>

        {boardMode === "racePoints" ? (
          <div className="mt-3">
            <span className="mb-1 block text-sm font-semibold text-accent-cyan">Leaderboard View</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`tap rounded-xl px-3 py-2 text-sm font-bold ${
                  viewMode === "summary" ? "bg-accent-red text-white" : "border border-white/30 text-slate-200"
                }`}
                onClick={() => setViewMode("summary")}
              >
                Summary
              </button>
              <button
                type="button"
                className={`tap rounded-xl px-3 py-2 text-sm font-bold ${
                  viewMode === "full" ? "bg-accent-red text-white" : "border border-white/30 text-slate-200"
                }`}
                onClick={() => setViewMode("full")}
              >
                Full
              </button>
            </div>
            {viewMode === "summary" ? (
              <p className="mt-2 text-xs text-slate-400">Showing first 3 races plus total for quick mobile scanning.</p>
            ) : (
              <p className="mt-2 text-xs text-slate-400">Showing all race columns.</p>
            )}
          </div>
        ) : null}
      </section>

      {boardMode === "racePoints" ? (
        <section className="card overflow-x-auto p-2">
          <table className={`${viewMode === "summary" ? "min-w-[520px]" : "min-w-[760px]"} text-sm text-slate-100`}>
            <thead>
              <tr className="border-b border-white/20">
                <th className="px-2 py-2 text-left text-accent-cyan">#</th>
                <th className="px-2 py-2 text-left text-accent-cyan">Player</th>
                <th className="px-2 py-2 text-left text-accent-cyan">Total</th>
                {racesToDisplay.map((race) => (
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
                  {racesToDisplay.map((race) => (
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
          {latestRace ? (
            <p className="px-2 pb-2 text-xs text-slate-400">
              Latest race in {year}: <span className="text-accent-cyan">{latestRace.name}</span>
            </p>
          ) : (
            <p className="px-2 pb-2 text-xs text-slate-400">No completed race results available for {year}.</p>
          )}
          {latestRace ? (
            <table className="min-w-[760px] text-sm text-slate-100">
              <thead>
                <tr className="border-b border-white/20">
                  <th className="px-2 py-2 text-left text-accent-cyan">#</th>
                  <th className="px-2 py-2 text-left text-accent-cyan">Player</th>
                  <th className="px-2 py-2 text-left text-accent-cyan">Race Total</th>
                  <th className="px-2 py-2 text-left text-accent-cyan">Overall</th>
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
                    <td className="px-2 py-3 font-bold text-accent-gold">{row.overallPoints}</td>
                    {latestCategories.map((category) => (
                      <td key={`${row.id}:${category.id}`} className="px-2 py-3">
                        {row.categoryPoints?.[category.id] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </section>
      )}

      <section className="card overflow-x-auto p-3">
        <h3 className="mb-2 text-sm font-semibold text-accent-cyan">Revealed Picks (After Lock)</h3>
        <select
          className="tap mb-3 w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
          value={revealedRaceId}
          onChange={(e) => setRevealedRaceId(e.target.value)}
        >
          <option value="" className="bg-track-900 text-white">Select race to view revealed picks</option>
          {races.map((race) => (
            <option key={race.id} value={race.id} className="bg-track-900 text-white">
              {race.name}
            </option>
          ))}
        </select>

        {revealMessage ? <p className="mb-2 text-xs text-amber-300">{revealMessage}</p> : null}

        {revealedRows.length > 0 ? (
          <table className="min-w-[640px] text-sm text-slate-100">
            <thead>
              <tr className="border-b border-white/20">
                <th className="px-2 py-2 text-left text-accent-cyan">Player</th>
                <th className="px-2 py-2 text-left text-accent-cyan">Category</th>
                <th className="px-2 py-2 text-left text-accent-cyan">Pick</th>
              </tr>
            </thead>
            <tbody>
              {revealedRows.map((row, idx) => (
                <tr key={`${row.player_name}:${row.category_id}:${idx}`} className="border-b border-white/10 last:border-0">
                  <td className="px-2 py-2">{row.player_name}</td>
                  <td className="px-2 py-2">{row.category_name}</td>
                  <td className="px-2 py-2">{row.value_text || row.value_number || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
      <BottomNav />
    </div>
  );
}