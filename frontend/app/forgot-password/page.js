"use client";

import Link from "next/link";
import { useState } from "react";
import Header from "../../components/Header";
import { publicApiFetch } from "../../lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    setPreviewUrl("");

    try {
      const res = await publicApiFetch("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email })
      });
      setMessage(res.resetPreviewUrl
        ? `${res.message} This environment is using a preview link instead of outbound email, so use the reset preview link below.`
        : res.message);
      setPreviewUrl(res.resetPreviewUrl || "");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="pb-24">
      <Header title="Forgot Password" subtitle="Request a password reset link" />
      <form onSubmit={submit} className="card space-y-4 p-5">
        <input
          className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {message ? <p className="text-sm text-emerald-200">{message}</p> : null}
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        {previewUrl ? (
          <Link href={previewUrl} className="block text-center text-sm text-accent-cyan underline">
            Open reset preview
          </Link>
        ) : null}
        <button className="tap w-full rounded-xl bg-accent-red font-bold text-white">Send Reset Link</button>
        <Link href="/login" className="block text-center text-sm text-accent-cyan">
          Back to login
        </Link>
      </form>
    </div>
  );
}