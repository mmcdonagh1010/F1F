"use client";

import { useState } from "react";
import Link from "next/link";
import Header from "../../../components/Header";
import { publicApiFetch } from "../../../lib/api";

export default function RegisterPage() {
  const [form, setForm] = useState({ name: "", email: "", password: "", inviteCode: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [verificationPreviewUrl, setVerificationPreviewUrl] = useState("");
  const normalizedEmail = form.email.trim().toLowerCase();

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setVerificationPreviewUrl("");

    try {
      const res = await publicApiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password
        })
      });
      const baseMessage = res.verificationPreviewUrl
        ? `${res.message} This environment is using a preview link instead of outbound email, so use the verification link below.`
        : res.message;
      setSuccess(form.inviteCode.trim()
        ? `${baseMessage} After you verify and log in, join your league with invite code ${form.inviteCode.trim().toUpperCase()}.`
        : baseMessage);
      setVerificationPreviewUrl(res.verificationPreviewUrl || "");
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
        {success ? <p className="text-sm text-emerald-200">{success}</p> : null}
        {normalizedEmail ? (
          <Link href={`/verify-email?email=${encodeURIComponent(normalizedEmail)}`} className="block text-center text-sm text-accent-cyan">
            Open verification page
          </Link>
        ) : null}
        {verificationPreviewUrl ? (
          <Link href={verificationPreviewUrl} className="block text-center text-sm text-accent-cyan underline">
            Open verification preview
          </Link>
        ) : null}
        <button className="tap w-full rounded-xl bg-accent-red font-bold text-white">Register</button>
        <Link href="/login" className="block text-center text-sm text-accent-cyan">
          Already registered? Login
        </Link>
      </form>
    </div>
  );
}
