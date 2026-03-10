"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Header from "../../../components/Header";
import { publicApiFetch } from "../../../lib/api";
import { storeAuthSession } from "../../../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");

  async function submit(e) {
    e.preventDefault();
    setError("");
    setVerificationEmail("");

    try {
      const res = await publicApiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify(form)
      });
      storeAuthSession(res.user, res.sessionExpiresAt);
      router.push("/dashboard");
    } catch (err) {
      if (err.data?.verificationRequired) {
        setVerificationEmail(form.email.trim().toLowerCase());
        setError("Verify your email before logging in. Open the verification page below to use your verification link or resend one.");
        return;
      }
      setError(err.message);
    }
  }

  return (
    <div className="pb-24">
      <Header title="Login" subtitle="Welcome back to race weekend" />
      <form onSubmit={submit} className="card space-y-4 p-5">
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
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          required
        />
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        {verificationEmail ? (
          <Link href={`/verify-email?email=${encodeURIComponent(verificationEmail)}`} className="block text-center text-sm text-accent-cyan underline">
            Verify this account
          </Link>
        ) : null}
        <button className="tap w-full rounded-xl bg-accent-red font-bold text-white">Login</button>
        <Link href="/forgot-password" className="block text-center text-sm text-accent-cyan">
          Forgot your password?
        </Link>
        <Link href="/verify-email" className="block text-center text-sm text-accent-cyan">
          Need to verify your email?
        </Link>
        <Link href="/register" className="block text-center text-sm text-accent-cyan">
          Need an account? Register
        </Link>
      </form>
    </div>
  );
}
