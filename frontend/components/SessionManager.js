"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  SESSION_WARNING_MS,
  clearAuthSession,
  getAuthSessionExpiry,
  getStoredToken,
  refreshAuthSessionExpiry
} from "../lib/auth";

const ACTIVITY_EVENTS = ["click", "keydown", "mousedown", "touchstart", "scroll"];
const REFRESH_THROTTLE_MS = 60 * 1000;
const AUTH_ROUTES = new Set(["/login", "/register", "/verify-email", "/forgot-password", "/reset-password"]);

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function SessionManager() {
  const pathname = usePathname();
  const router = useRouter();
  const [expiresAt, setExpiresAt] = useState(0);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [showPrompt, setShowPrompt] = useState(false);
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    if (AUTH_ROUTES.has(pathname)) {
      setShowPrompt(false);
      return;
    }

    setExpiresAt(getAuthSessionExpiry());

    const handleActivity = () => {
      if (!getStoredToken()) return;
      const now = Date.now();
      if (now - lastRefreshAtRef.current < REFRESH_THROTTLE_MS) return;
      lastRefreshAtRef.current = now;
      const nextExpiry = refreshAuthSessionExpiry();
      if (nextExpiry) {
        setExpiresAt(nextExpiry);
        setShowPrompt(false);
      }
    };

    const handleStorage = () => {
      setExpiresAt(getAuthSessionExpiry());
    };

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, handleActivity, { passive: true });
    });
    window.addEventListener("storage", handleStorage);

    const intervalId = window.setInterval(() => {
      setCurrentTime(Date.now());
      const token = getStoredToken();
      const nextExpiry = getAuthSessionExpiry();
      setExpiresAt(nextExpiry);

      if (!token) {
        setShowPrompt(false);
        if (!AUTH_ROUTES.has(pathname)) {
          router.replace("/login");
        }
        return;
      }

      const remainingMs = nextExpiry - Date.now();
      if (remainingMs <= 0) {
        clearAuthSession();
        setShowPrompt(false);
        router.replace("/login");
        return;
      }

      setShowPrompt(remainingMs <= SESSION_WARNING_MS);
    }, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, handleActivity);
      });
      window.removeEventListener("storage", handleStorage);
      window.clearInterval(intervalId);
    };
  }, [pathname, router]);

  const remainingMs = expiresAt - currentTime;
  const remainingLabel = useMemo(() => formatRemaining(remainingMs), [remainingMs]);

  function continueSession() {
    const nextExpiry = refreshAuthSessionExpiry();
    lastRefreshAtRef.current = Date.now();
    setExpiresAt(nextExpiry);
    setShowPrompt(false);
  }

  function logoutNow() {
    clearAuthSession();
    setShowPrompt(false);
    router.replace("/login");
  }

  if (!showPrompt || AUTH_ROUTES.has(pathname) || !getStoredToken()) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 p-4 md:items-center">
      <div className="w-full max-w-md rounded-3xl border border-white/20 bg-track-800/95 p-5 shadow-2xl backdrop-blur">
        <p className="text-lg font-extrabold text-white">Session Expiring</p>
        <p className="mt-2 text-sm text-slate-300">
          You will be logged out in {remainingLabel} unless you continue your session.
        </p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={continueSession}
            className="tap flex-1 rounded-xl bg-accent-cyan px-4 py-3 font-bold text-track-900"
          >
            Continue
          </button>
          <button
            type="button"
            onClick={logoutNow}
            className="tap flex-1 rounded-xl border border-white/30 px-4 py-3 font-bold text-white"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}