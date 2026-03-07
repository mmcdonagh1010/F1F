"use client";

import { useEffect } from "react";

const RELOAD_FLAG = "f1f_sw_reset_done";

export default function ServiceWorkerReset() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.getRegistrations().then(async (registrations) => {
      if (!registrations.length) return;

      await Promise.all(registrations.map((registration) => registration.unregister()));

      if (typeof caches !== "undefined") {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
      }

      if (!window.sessionStorage.getItem(RELOAD_FLAG)) {
        window.sessionStorage.setItem(RELOAD_FLAG, "true");
        window.location.reload();
      }
    });
  }, []);

  return null;
}