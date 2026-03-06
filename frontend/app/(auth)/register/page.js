"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Header from "../../../components/Header";
import { apiFetch } from "../../../lib/api";
import { storeAuthSession } from "../../../lib/auth";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", inviteCode: "" });
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");

    try {
      const res = await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password
        })
      });
      storeAuthSession(res.token, res.user);

      if (form.inviteCode.trim()) {
        await apiFetch("/leagues/join", {
          method: "POST",
          body: JSON.stringify({ inviteCode: form.inviteCode.trim().toUpperCase() })
        });
      }

      router.push("/dashboard");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="pb-24">
      <Header title="Create Account" subtitle="Join your private F1 picks league" />
      <form onSubmit={submit} className="card space-y-4 p-5">
        <input
          className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
          type="text"
          placeholder="Full name"
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        <input
          className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
          type="email"
          placeholder="Email"
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          required
        />
        <input
          className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
          type="password"
          placeholder="Password"
          minLength={8}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
        <input
          className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
          type="text"
          placeholder="League invite code (optional)"
          onChange={(e) => setForm({ ...form, inviteCode: e.target.value })}
        />
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <button className="tap w-full rounded-xl bg-accent-red font-bold text-white">Register</button>
        <Link href="/login" className="block text-center text-sm text-accent-cyan">
          Already registered? Login
        </Link>
      </form>
    </div>
  );
}
