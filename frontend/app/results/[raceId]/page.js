"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Header from "../../../components/Header";
import { apiFetch } from "../../../lib/api";

export default function RaceResultsPage() {
  const { raceId } = useParams();
  const [rows, setRows] = useState([]);

  useEffect(() => {
    apiFetch(`/leaderboard/race/${raceId}`)
      .then((data) => {
        setRows(Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : []);
      })
      .catch(() => setRows([]));
  }, [raceId]);

  return (
    <div className="pb-24">
      <Header title="Race Results" subtitle="Points for this race weekend" />
      <section className="card p-3">
        {rows.map((row, idx) => (
          <div key={row.id} className="flex items-center justify-between border-b border-white/10 px-2 py-3 text-sm last:border-0">
            <p>
              #{idx + 1} {row.name}
            </p>
            <p className="font-bold">{row.points} pts</p>
          </div>
        ))}
      </section>
    </div>
  );
}
