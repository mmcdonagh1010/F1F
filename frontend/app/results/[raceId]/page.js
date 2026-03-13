"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Header from "../../../components/Header";
import { apiFetch } from "../../../lib/api";

export default function RaceResultsPage() {
  const router = useRouter();
  const { raceId } = useParams();

  useEffect(() => {
    if (!raceId) return;

    let cancelled = false;

    async function redirectToLeaderboard() {
      try {
        const race = await apiFetch(`/races/${raceId}`);
        const raceTime = new Date(race?.race_date || race?.deadline_at);
        const year = Number.isNaN(raceTime.getTime()) ? new Date().getUTCFullYear() : raceTime.getUTCFullYear();
        const params = new URLSearchParams({
          boardMode: "latestRace",
          raceId: String(raceId),
          year: String(year)
        });
        if (!cancelled) router.replace(`/leaderboard?${params.toString()}`);
      } catch {
        if (!cancelled) router.replace(`/leaderboard?boardMode=latestRace&raceId=${encodeURIComponent(String(raceId))}`);
      }
    }

    redirectToLeaderboard();

    return () => {
      cancelled = true;
    };
  }, [raceId, router]);

  return (
    <div className="pb-24">
      <Header title="Race Results" subtitle="Redirecting to the leaderboard race results view" />
      <section className="card p-4 text-sm text-slate-300">Loading race results...</section>
    </div>
  );
}
