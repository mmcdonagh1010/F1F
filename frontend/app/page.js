import Link from "next/link";
import Header from "../components/Header";

export default function LandingPage() {
  return (
    <div className="space-y-5 pb-24">
      <Header title="Fantasy Formula 1 Picks" subtitle="Private league for race weekend predictions" />

      <section className="card p-5">
        <p className="text-sm text-slate-200">
          Pick pole, winner, podium, and bonus categories before lock. Score points automatically after official results.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Link href="/register" className="tap rounded-xl bg-accent-red px-4 py-3 text-center font-bold text-white">
            Join League
          </Link>
          <Link href="/login" className="tap rounded-xl border border-white/30 px-4 py-3 text-center font-bold text-white">
            Login
          </Link>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-display text-2xl tracking-wide text-accent-cyan">How It Works</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-100">
          <li>1. Submit picks before each race deadline.</li>
          <li>2. Admin posts official results.</li>
          <li>3. Scores auto-calculate and update leaderboard.</li>
        </ul>
      </section>
    </div>
  );
}
