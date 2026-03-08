"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Header from "../../components/Header";
import { publicApiFetch } from "../../lib/api";

function ResetPasswordPageContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");

    try {
      const res = await publicApiFetch("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password })
      });
      setMessage(res.message);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="pb-24">
      <Header title="Reset Password" subtitle="Choose a new password" />
      <form onSubmit={submit} className="card space-y-4 p-5">
        <input
          className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
          type="password"
          placeholder="New password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {message ? <p className="text-sm text-emerald-200">{message}</p> : null}
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <button className="tap w-full rounded-xl bg-accent-red font-bold text-white" disabled={!token}>
          Reset Password
        </button>
        {!token ? <p className="text-sm text-amber-200">Open this page from a valid reset link.</p> : null}
        <Link href="/login" className="block text-center text-sm text-accent-cyan">
          Back to login
        </Link>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="pb-24"><Header title="Reset Password" subtitle="Loading reset form" /><p className="card p-4 text-sm text-slate-300">Loading reset form...</p></div>}>
      <ResetPasswordPageContent />
    </Suspense>
  );
}