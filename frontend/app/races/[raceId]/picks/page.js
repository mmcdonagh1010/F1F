"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Header from "../../../../components/Header";
import { apiFetch } from "../../../../lib/api";

function isTeamBattleMarginCategory(name) {
  return name.toLowerCase().includes("team battle") && name.toLowerCase().includes("margin");
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

function getInputMeta(category, drivers) {
  if (isTeamBattleMarginCategory(category.name)) {
    return {
      inputType: "teamMarginBand",
      options: [
        { value: "1-2", label: "1-2" },
        { value: "3-4", label: "3-4" },
        { value: "5+", label: "5+" }
      ],
      hint: "Pick the teammate finishing-margin band."
    };
  }

  if (isDriverSelectionCategory(category)) {
    return {
      inputType: "driverSelect",
      options: (drivers || []).map((driver) => ({
        value: driver.driver_name,
        label: driver.team_name ? `${driver.driver_name} (${driver.team_name})` : driver.driver_name
      })),
      hint: "Select a driver from the official race list."
    };
  }

  if (isTeamOfWeekendCategory(category.name)) {
    const teams = [...new Set((drivers || []).map((driver) => String(driver.team_name || "").trim()).filter(Boolean))];
    return {
      inputType: "teamSelect",
      options: teams.map((team) => ({ value: team, label: team })),
      hint: "Select one team for Team of the Weekend."
    };
  }

  return {
    inputType: "text",
    placeholder: `Pick for ${category.name}`,
    hint: ""
  };
}

export default function PicksPage() {
  const { raceId } = useParams();
  const [race, setRace] = useState(null);
  const [values, setValues] = useState({});
  const [message, setMessage] = useState("");
  const [isLocked, setIsLocked] = useState(false);
  const [selectedLeagueId, setSelectedLeagueId] = useState("");
  const [applyToAllLeagues, setApplyToAllLeagues] = useState(false);
  const [availableLeagues, setAvailableLeagues] = useState([]);
  const [updatedLeagueNames, setUpdatedLeagueNames] = useState([]);

  useEffect(() => {
    apiFetch(`/races/${raceId}`)
      .then(async (data) => {
        setRace(data);
        setIsLocked(Boolean(data.is_locked));
        const leagues = data.available_leagues || [];
        setAvailableLeagues(leagues);
        if (leagues.length > 0) {
          setSelectedLeagueId(leagues[0].id);
          setApplyToAllLeagues(leagues.length > 1);
        }
        const initial = {};
        data.categories.forEach((c) => {
          initial[c.id] = "";
        });

        try {
          const existing = await apiFetch(`/picks/${raceId}${leagues[0]?.id ? `?leagueId=${leagues[0].id}` : ""}`);
          (existing.picks || []).forEach((pick) => {
            initial[pick.category_id] = pick.value_text || (pick.value_number !== null ? String(pick.value_number) : "");
          });
        } catch {
          // Keep empty defaults if no picks found.
        }

        setValues(initial);
      })
      .catch(() => setRace(null));
  }, [raceId]);

  useEffect(() => {
    if (!raceId || !selectedLeagueId) return;

    apiFetch(`/picks/${raceId}?leagueId=${selectedLeagueId}`)
      .then((existing) => {
        const next = {};
        race?.categories?.forEach((c) => {
          next[c.id] = "";
        });
        (existing.picks || []).forEach((pick) => {
          next[pick.category_id] = pick.value_text || (pick.value_number !== null ? String(pick.value_number) : "");
        });
        setValues(next);
      })
      .catch(() => {});
  }, [raceId, selectedLeagueId, race]);

  async function savePicks(e) {
    e.preventDefault();
    if (isLocked) {
      setMessage("Picks are locked for this race. You can view your submitted picks below.");
      return;
    }
    const picks = race.categories.map((category) => {
      const raw = (values[category.id] || "").toString().trim();
      const meta = getInputMeta(category, race.drivers);

      if (meta.inputType === "teamMarginBand") {
        return {
          categoryId: category.id,
          valueText: raw,
          valueNumber: null
        };
      }

      return {
        categoryId: category.id,
        valueText: raw,
        valueNumber: null
      };
    });

    try {
      const res = await apiFetch(`/picks/${raceId}`, {
        method: "POST",
        body: JSON.stringify({
          picks,
          leagueId: selectedLeagueId,
          applyToAllLeagues: applyToAllLeagues && availableLeagues.length > 1
        })
      });
      const updatedNames = (res.leagueIds || [])
        .map((id) => availableLeagues.find((league) => league.id === id)?.name || id)
        .filter(Boolean);
      setUpdatedLeagueNames(updatedNames);
      setMessage("Picks saved successfully");
    } catch (err) {
      setUpdatedLeagueNames([]);
      setMessage(err.message);
    }
  }

  if (!race) {
    return <p>Loading race...</p>;
  }

  return (
    <div className="pb-24">
      <Header title={race.name} subtitle="Lock in your predictions" />
      <form onSubmit={savePicks} className="card space-y-4 p-5">
        {isLocked ? (
          <p className="rounded-xl border border-amber-300/40 bg-amber-500/15 p-2 text-sm text-amber-200">
            Picks are locked because the deadline window is now closed. You can only view picks.
          </p>
        ) : null}
        {race.categories.some((category) => isDriverSelectionCategory(category)) && (!race.drivers || race.drivers.length === 0) ? (
          <p className="text-sm text-red-300">This race requires driver picks but no race driver list is configured yet.</p>
        ) : null}
        {availableLeagues.length > 0 ? (
          <div className="rounded-xl border border-white/20 bg-white/5 p-3">
            <p className="mb-2 text-sm font-semibold text-accent-cyan">League Pick Scope</p>
            <select
              className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
              value={selectedLeagueId}
              disabled={isLocked || (applyToAllLeagues && availableLeagues.length > 1)}
              onChange={(e) => setSelectedLeagueId(e.target.value)}
            >
              {availableLeagues.map((league) => (
                <option key={league.id} value={league.id} className="bg-track-900 text-white">
                  {league.name}
                </option>
              ))}
            </select>
            {availableLeagues.length > 1 ? (
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={applyToAllLeagues}
                  disabled={isLocked}
                  onChange={(e) => setApplyToAllLeagues(e.target.checked)}
                />
                Apply these picks to all my leagues for this race
              </label>
            ) : null}
          </div>
        ) : null}
        {race.categories.map((category) => (
          <label key={category.id} className="block">
            {(() => {
              const meta = getInputMeta(category, race.drivers);
              const teamOfWeekendCategory = race.categories.find((c) => isTeamOfWeekendCategory(c.name));
              const selectedTeam = teamOfWeekendCategory
                ? String(values[teamOfWeekendCategory.id] || "").trim()
                : "";
              const filteredDriverOptions = isTeamBattleDriverCategory(category.name) && selectedTeam
                ? (meta.options || []).filter((option) => option.label.includes(`(${selectedTeam})`))
                : meta.options;
              return (
                <>
                  <span className="mb-1 block text-sm font-semibold text-slate-200">{category.name}</span>
                  {meta.inputType === "driverSelect" ? (
                    <select
                      className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
                      value={values[category.id] || ""}
                      disabled={isLocked}
                      onChange={(e) => setValues({ ...values, [category.id]: e.target.value })}
                      required
                    >
                      <option value="" className="bg-track-900 text-slate-300">
                        {isTeamBattleDriverCategory(category.name) && selectedTeam
                          ? `Select driver from ${selectedTeam}`
                          : "Select driver"}
                      </option>
                      {(filteredDriverOptions || []).map((option) => (
                        <option key={option.value} value={option.value} className="bg-track-900 text-white">
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : meta.inputType === "teamSelect" ? (
                    <select
                      className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
                      value={values[category.id] || ""}
                      disabled={isLocked}
                      onChange={(e) => setValues({ ...values, [category.id]: e.target.value })}
                      required
                    >
                      <option value="" className="bg-track-900 text-slate-300">
                        Select team
                      </option>
                      {meta.options.map((option) => (
                        <option key={option.value} value={option.value} className="bg-track-900 text-white">
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : meta.inputType === "teamMarginBand" ? (
                    <select
                      className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
                      value={values[category.id] || ""}
                      disabled={isLocked}
                      onChange={(e) => setValues({ ...values, [category.id]: e.target.value })}
                      required
                    >
                      <option value="" className="bg-track-900 text-slate-300">
                        Select margin band
                      </option>
                      {meta.options.map((option) => (
                        <option key={option.value} value={option.value} className="bg-track-900 text-white">
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
                      type="text"
                      inputMode="text"
                      placeholder={meta.placeholder}
                      value={values[category.id] || ""}
                      readOnly={isLocked}
                      onChange={(e) => setValues({ ...values, [category.id]: e.target.value })}
                      required
                    />
                  )}
                  {meta.hint ? <span className="mt-1 block text-xs text-slate-400">{meta.hint}</span> : null}
                </>
              );
            })()}
          </label>
        ))}
        {!isLocked ? <button className="tap w-full rounded-xl bg-accent-red font-bold text-white">Submit Picks</button> : null}
        {message ? <p className="text-sm text-accent-cyan">{message}</p> : null}
        {updatedLeagueNames.length > 0 ? (
          <div className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 p-2">
            <p className="text-xs font-semibold text-emerald-200">Updated leagues</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {updatedLeagueNames.map((name) => (
                <span key={name} className="rounded-full border border-emerald-300/40 px-2 py-0.5 text-xs text-emerald-100">
                  {name}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </form>
    </div>
  );
}
