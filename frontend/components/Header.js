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
      <img
        src="/banner.png"
        alt="TURN 1 CARNAGE banner"
        className="mb-4 h-72 w-full rounded-2xl object-cover object-[center_22%] shadow-lg shadow-black/30 md:h-96"
      />
      <h1 className="text-3xl font-extrabold leading-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-slate-300">{subtitle}</p> : null}
      {userName ? <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Logged in as {userName}</p> : null}
    </header>
  );
}
