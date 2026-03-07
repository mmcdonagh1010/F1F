"use client";

import { useEffect, useState } from "react";
import { getStoredUser } from "../lib/auth";

export default function Header({ title, subtitle }) {
  const [userName, setUserName] = useState("");

  useEffect(() => {
    const user = getStoredUser();
    setUserName(String(user?.name || "").trim());
  }, []);

  return (
    <header className="mb-5">
      <p className="font-display text-2xl tracking-wide text-accent-cyan">F1 FRIENDS LEAGUE</p>
      <h1 className="text-3xl font-extrabold leading-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-slate-300">{subtitle}</p> : null}
      {userName ? <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Logged in as {userName}</p> : null}
    </header>
  );
}
