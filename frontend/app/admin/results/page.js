"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "../../../components/Header";
import BottomNav from "../../../components/BottomNav";
import { apiFetch } from "../../../lib/api";

function isTeamBattleMarginCategory(name) {
  const normalized = name.toLowerCase();
  return normalized.includes("team battle") && normalized.includes("margin");
}

function isTeamOfWeekendCategory(name) {
  return String(name || "").toLowerCase().includes("team of the weekend");
}

function isTeamBattleDriverCategory(name) {
  const normalized = String(name || "").toLowerCase();
  return normalized.includes("team battle") && normalized.includes("driver");
}

function isDriverSelectionCategory(category) {
  const normalized = category.name.toLowerCase();
  if (isTeamBattleMarginCategory(normalized)) return false;
  if (category.is_position_based) return true;
  if (/\bp\d+\b/i.test(normalized)) return true;

  return ["driver", "winner", "pole", "fastest lap", "qualification", "result"].some((token) =>
    normalized.includes(token)
  );
}

function getResultInputMeta(category, drivers) {
  if (isTeamOfWeekendCategory(category.name)) {
    const teams = [...new Set((drivers || []).map((driver) => String(driver.team_name || "").trim()).filter(Boolean))];
    return {
      type: "select",
      placeholder: "Select team",
      options: teams.map((team) => ({ value: team, label: team })),
      hint: "Choose exactly one team for Team of the Weekend."
    };
  }

  if (isDriverSelectionCategory(category)) {
    return {
      type: "select",
      placeholder: "Select driver",
      options: (drivers || []).map((driver) => ({
        value: driver.driver_name,
        label: driver.team_name ? `${driver.driver_name} (${driver.team_name})` : driver.driver_name
      })),
      hint: "Driver must be selected from this race's configured drivers."
    };
  }

  if (isTeamBattleMarginCategory(category.name)) {
    return {
      type: "select",
      placeholder: "Select margin",
      options: [
        { value: "1-2", label: "1-2" },
        { value: "3-4", label: "3-4" },
        { value: "5+", label: "5+" }
      ],
      hint: "Use standardized teammate margin bands."
    };
  }

  return {
    type: "text",
    placeholder: `Enter result for ${category.name}`,
    options: [],
    hint: ""
  };
}

export default function AdminResultsPage() {
  const [races, setRaces] = useState([]);
  const [selectedRaceId, setSelectedRaceId] = useState("");
  const [raceDetail, setRaceDetail] = useState(null);
  const [resultValues, setResultValues] = useState({});
  const [tieBreakerValue, setTieBreakerValue] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    apiFetch("/races")
      .then((data) => {
        setRaces(data);
        if (data.length > 0) {
          setSelectedRaceId(data[0].id);
        }
      })
      .catch(() => setRaces([]));
  }, []);

  useEffect(() => {
    if (!selectedRaceId) return;

    apiFetch(`/races/${selectedRaceId}`)
      .then((detail) => {
        setRaceDetail(detail);
        const initial = {};
        detail.categories.forEach((category) => {
          initial[category.id] = "";
        });
        setResultValues(initial);
        setTieBreakerValue("");
      })
      .catch(() => setRaceDetail(null));
  }, [selectedRaceId]);

  const hasDriverOfWeekendCategory = useMemo(() => {
    if (!raceDetail) return false;
    return raceDetail.categories.some((category) => isDriverSelectionCategory(category));
  }, [raceDetail]);

  async function submitResults(e) {
    e.preventDefault();
    setMessage("");

    if (!raceDetail) return;

    const results = raceDetail.categories.map((category) => {
      const meta = getResultInputMeta(category, raceDetail.drivers);
      const raw = (resultValues[category.id] || "").toString().trim();

      return {
        categoryId: category.id,
        valueText: raw,
        valueNumber: null
      };
    });

    try {
      const res = await apiFetch(`/admin/races/${selectedRaceId}/results`, {
        method: "POST",
        body: JSON.stringify({
          tieBreakerValue: tieBreakerValue || null,
          results
        })
      });
      setMessage(res.message || "Results saved");
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <Header title="Enter Results" subtitle="Post official outcomes and calculate scores" />

      <section className="card space-y-3 p-4">
        <label className="block text-sm text-slate-200">
          <span className="mb-1 block font-semibold text-accent-cyan">Select Race</span>
          <select
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            value={selectedRaceId}
            onChange={(e) => setSelectedRaceId(e.target.value)}
          >
            {races.map((race) => (
              <option key={race.id} value={race.id} className="bg-track-900 text-white">
                {race.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      {raceDetail ? (
        <form onSubmit={submitResults} className="card space-y-4 p-4">
          <h2 className="font-display text-2xl text-accent-cyan">{raceDetail.name}</h2>
          {hasDriverOfWeekendCategory && (!raceDetail.drivers || raceDetail.drivers.length === 0) ? (
            <p className="text-sm text-red-300">This race has driver-based categories but no race drivers are configured.</p>
          ) : null}

          {raceDetail.categories.map((category) => {
            const meta = getResultInputMeta(category, raceDetail.drivers);
            const teamOfWeekendCategory = raceDetail.categories.find((item) => isTeamOfWeekendCategory(item.name));
            const selectedTeam = teamOfWeekendCategory ? String(resultValues[teamOfWeekendCategory.id] || "").trim() : "";
            const filteredOptions = isTeamBattleDriverCategory(category.name) && selectedTeam
              ? (meta.options || []).filter((option) => option.label.includes(`(${selectedTeam})`))
              : meta.options;
            return (
              <label key={category.id} className="block">
                <span className="mb-1 block text-sm font-semibold text-slate-200">{category.name}</span>
                {meta.type === "select" ? (
                  <select
                    className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
                    value={resultValues[category.id] || ""}
                    onChange={(e) => setResultValues({ ...resultValues, [category.id]: e.target.value })}
                    required
                  >
                    <option value="" className="bg-track-900 text-slate-300">
                      {isTeamBattleDriverCategory(category.name) && selectedTeam
                        ? `Select driver from ${selectedTeam}`
                        : meta.placeholder}
                    </option>
                    {(filteredOptions || []).map((option) => (
                      <option key={option.value} value={option.value} className="bg-track-900 text-white">
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
                    type="text"
                    placeholder={meta.placeholder}
                    value={resultValues[category.id] || ""}
                    onChange={(e) => setResultValues({ ...resultValues, [category.id]: e.target.value })}
                    required
                  />
                )}
                {meta.hint ? <span className="mt-1 block text-xs text-slate-400">{meta.hint}</span> : null}
              </label>
            );
          })}

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-200">Tie Breaker Value (optional)</span>
            <input
              className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
              type="text"
              placeholder="Example: 1:31:44.000"
              value={tieBreakerValue}
              onChange={(e) => setTieBreakerValue(e.target.value)}
            />
          </label>

          <button className="tap w-full rounded-xl bg-accent-red px-4 py-2 font-bold text-white">Save Results</button>
          {message ? <p className="text-sm text-accent-gold">{message}</p> : null}
        </form>
      ) : null}

      <BottomNav />
    </div>
  );
}
