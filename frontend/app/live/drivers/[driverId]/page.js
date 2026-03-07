"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Header from "../../../../components/Header";
import BottomNav from "../../../../components/BottomNav";
import { publicApiFetch } from "../../../../lib/api";

function formatDate(value) {
  if (!value) return "TBC";
  return new Date(value).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function LiveDriverDetailPageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const season = searchParams.get("season") || String(new Date().getUTCFullYear());
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    publicApiFetch(`/f1/live/drivers/${params.driverId}?season=${encodeURIComponent(season)}`)
      .then((payload) => {
        if (!active) return;
        setDetail(payload);
        setError("");
      })
      .catch((err) => {
        if (!active) return;
        setDetail(null);
        setError(err.message || "Failed to load driver detail");
      });

    return () => {
      active = false;
    };
  }, [params.driverId, season]);

  return (
    <div className="space-y-4 pb-24">
      <Header title="Driver Detail" subtitle={`Season ${season} performance snapshot`} />

      <section className="card p-4 text-sm text-slate-200">
        <Link href={`/live?season=${season}`} className="text-accent-cyan underline">
          Back to Live F1
        </Link>
      </section>

      {error ? <p className="card p-4 text-sm text-red-300">{error}</p> : null}

      {detail ? (
        <>
          {detail.snapshotMode === "persisted" ? (
            <p className="card p-4 text-sm text-accent-gold">Showing the last saved driver snapshot because Jolpica is temporarily unavailable.</p>
          ) : null}
          <section className="card p-4">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-accent-cyan">Driver</p>
            <h2 className="mt-2 font-display text-4xl text-white">{detail.driver.fullName}</h2>
            <p className="mt-1 text-sm text-slate-300">{detail.driver.nationality || "Unknown nationality"}</p>
            {detail.resultSeason && String(detail.resultSeason) !== String(season) ? (
              <p className="mt-2 text-sm text-slate-400">Race history shown from {detail.resultSeason} because {season} has no completed rounds yet.</p>
            ) : null}
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl bg-white/5 p-3">
                <p className="text-xs uppercase text-slate-400">Standing</p>
                <p className="mt-1 text-2xl font-bold text-white">{detail.standing?.position ? `#${detail.standing.position}` : "TBC"}</p>
              </div>
              <div className="rounded-2xl bg-white/5 p-3">
                <p className="text-xs uppercase text-slate-400">Points</p>
                <p className="mt-1 text-2xl font-bold text-white">{detail.standing?.points || 0}</p>
              </div>
              <div className="rounded-2xl bg-white/5 p-3">
                <p className="text-xs uppercase text-slate-400">Wins</p>
                <p className="mt-1 text-2xl font-bold text-white">{detail.stats.wins}</p>
              </div>
              <div className="rounded-2xl bg-white/5 p-3">
                <p className="text-xs uppercase text-slate-400">Podiums</p>
                <p className="mt-1 text-2xl font-bold text-white">{detail.stats.podiums}</p>
              </div>
            </div>
            {detail.standing?.team?.id ? (
              <Link href={`/live/teams/${detail.standing.team.id}?season=${season}`} className="mt-4 inline-block text-sm text-accent-cyan underline">
                View {detail.standing.team.name} constructor detail
              </Link>
            ) : null}
          </section>

          <section className="card p-4">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-accent-cyan">Race Results</p>
            <div className="mt-4 space-y-3">
              {detail.results.map((result) => (
                <article key={`${result.race.season}-${result.race.round}`} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{result.race.name}</p>
                      <p className="text-sm text-slate-400">{formatDate(result.race.raceDate)} • {result.team?.name || "Team TBC"}</p>
                    </div>
                    <div className="text-right text-sm text-slate-300">
                      <p>Finish: {result.position ? `P${result.position}` : result.status || "TBC"}</p>
                      <p>{result.points} pts</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}

      <BottomNav />
    </div>
  );
}

export default function LiveDriverDetailPage() {
  return (
    <Suspense fallback={<div className="space-y-4 pb-24"><Header title="Driver Detail" subtitle="Loading driver snapshot" /><p className="card p-4 text-sm text-slate-300">Loading driver detail...</p><BottomNav /></div>}>
      <LiveDriverDetailPageContent />
    </Suspense>
  );
}