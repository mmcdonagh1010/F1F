"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Header from "../../components/Header";
import { publicApiFetch } from "../../lib/api";

function VerifyEmailPageContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const initialEmail = searchParams.get("email") || "";
  const [email, setEmail] = useState(initialEmail);
  const [message, setMessage] = useState(token ? "Verifying email..." : "Enter your email to resend the verification link.");
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    setIsSubmitting(true);
    publicApiFetch("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token })
    })
      .then((res) => {
        if (cancelled) return;
        setError("");
        setPreviewUrl("");
        setMessage(res.message);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsSubmitting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  async function resendVerification(e) {
    e.preventDefault();
    setError("");
    setPreviewUrl("");
    setIsSubmitting(true);

    try {
      const res = await publicApiFetch("/auth/verify-email/resend", {
        method: "POST",
        body: JSON.stringify({ email })
      });
      setMessage(res.message);
      setPreviewUrl(res.verificationPreviewUrl || "");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="pb-24">
      <Header title="Verify Email" subtitle="Confirm your account before logging in" />
      <form onSubmit={resendVerification} className="card space-y-4 p-5">
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
            Open verification preview
          </Link>
        ) : null}
        <button className="tap w-full rounded-xl bg-accent-red font-bold text-white" disabled={isSubmitting}>
          Resend Verification Email
        </button>
        <Link href="/login" className="block text-center text-sm text-accent-cyan">
          Back to login
        </Link>
      </form>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="pb-24"><Header title="Verify Email" subtitle="Loading verification" /><p className="card p-4 text-sm text-slate-300">Loading verification...</p></div>}>
      <VerifyEmailPageContent />
    </Suspense>
  );
}