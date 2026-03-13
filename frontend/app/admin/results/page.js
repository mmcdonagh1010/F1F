"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "../../../components/Header";
import BottomNav from "../../../components/BottomNav";
import { apiFetch } from "../../../lib/api";

function isTeamBattleMarginCategory(name) {
  const normalized = name.toLowerCase();
  return normalized.includes("team battle") && normalized.includes("margin");
}

function isDriverOfWeekendCategory(name) {
  return String(name || "").toLowerCase().includes("driver of the weekend");
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
  if (isDriverOfWeekendCategory(normalized)) return false;
  if (category.is_position_based) return true;
  if (/\bp\d+\b/i.test(normalized)) return true;

  return ["driver", "winner", "pole", "fastest lap", "qualification", "result"].some((token) =>
    normalized.includes(token)
  );
}

function isReferencedPositionCategory(category) {
  const normalized = String(category?.name || "").toLowerCase();
  if (!category) return false;
  if (isDriverOfWeekendCategory(normalized)) return false;
  if (isTeamOfWeekendCategory(normalized)) return false;
  if (isTeamBattleDriverCategory(normalized) || isTeamBattleMarginCategory(normalized)) return false;
  return Boolean(category.is_position_based) || /\bp\d+\b/i.test(normalized);
}

function getConfiguredTeamForCategory(category) {
  return String(category?.metadata?.fixedTeam || "").trim();
}

function getDriverOfWeekendScope(category) {
  return String(category?.metadata?.driverOfWeekendScope || "").trim();
}

function getDriverOfWeekendScopeLabel(scope) {
  if (scope === "race-result") return "Race Result";
  if (scope === "sprint-result") return "Sprint Result";
  if (scope === "race-qualification") return "Race Qualification";
  if (scope === "sprint-qualification") return "Sprint Qualification";
  return "Weekend Position";
}

function buildPositionNumberOptions() {
  return Array.from({ length: 20 }, (_, index) => {
    const value = String(index + 1);
    return { value, label: value };
  });
}

function buildSelectedPositionDriverOptions(categories, values, drivers, currentCategoryId) {
  const driverMap = new Map(
    (drivers || []).map((driver) => [
      String(driver.driver_name || "").trim().toLowerCase(),
      {
        value: driver.driver_name,
        label: driver.team_name ? `${driver.driver_name} (${driver.team_name})` : driver.driver_name
      }
    ])
  );
  const optionMap = new Map();

  (categories || []).forEach((category) => {
    if (!isReferencedPositionCategory(category)) return;

    const selectedValue = String(values?.[category.id] || "").trim();
    if (!selectedValue) return;

    const option = driverMap.get(selectedValue.toLowerCase()) || { value: selectedValue, label: selectedValue };
    optionMap.set(option.value.toLowerCase(), option);
  });

  const currentValue = String(values?.[currentCategoryId] || "").trim();
  if (currentValue && !optionMap.has(currentValue.toLowerCase())) {
    const option = driverMap.get(currentValue.toLowerCase()) || { value: currentValue, label: currentValue };
    optionMap.set(option.value.toLowerCase(), option);
  }

  return Array.from(optionMap.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function getResultInputMeta(category, drivers, categories, resultValues) {
  if (isTeamOfWeekendCategory(category.name)) {
    const teams = [...new Set((drivers || []).map((driver) => String(driver.team_name || "").trim()).filter(Boolean))];
    return {
      type: "select",
      placeholder: "Select team",
      options: teams.map((team) => ({ value: team, label: team })),
      hint: "Choose exactly one team for Team of the Weekend."
    };
  }

  if (isDriverOfWeekendCategory(category.name)) {
    return {
      type: "select",
      placeholder: "Select position",
      options: buildPositionNumberOptions(),
      hint: `Enter the finishing position for ${String(category?.metadata?.fixedDriver || "the selected driver").trim()} in ${getDriverOfWeekendScopeLabel(getDriverOfWeekendScope(category))}.`
    };
  }

  if (isDriverSelectionCategory(category)) {
    const configuredTeam = getConfiguredTeamForCategory(category);
    return {
      type: "select",
      placeholder: "Select driver",
      options: (drivers || [])
        .filter((driver) => !configuredTeam || String(driver.team_name || "").trim() === configuredTeam)
        .map((driver) => ({
          value: driver.driver_name,
          label: driver.team_name ? `${driver.driver_name} (${driver.team_name})` : driver.driver_name
        })),
      hint: configuredTeam
        ? `Driver must be selected from ${configuredTeam}.`
        : "Driver must be selected from this race's configured drivers."
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

function isSprintQualificationCategory(category) {
  return /^sprint qualification p\d+$/i.test(String(category?.name || "").trim());
}

export default function AdminResultsPage() {
  const [races, setRaces] = useState([]);
  const [selectedRaceId, setSelectedRaceId] = useState("");
  const [raceDetail, setRaceDetail] = useState(null);
  const [resultValues, setResultValues] = useState({});
  const [tieBreakerValue, setTieBreakerValue] = useState("");
  const [message, setMessage] = useState("");
  const [isImportingSprintQualifying, setIsImportingSprintQualifying] = useState(false);
  const [isSavingSprintQualifying, setIsSavingSprintQualifying] = useState(false);

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

  const sprintQualificationCategories = useMemo(() => {
    if (!raceDetail) return [];
    return raceDetail.categories.filter((category) => isSprintQualificationCategory(category));
  }, [raceDetail]);

  function buildCategoryResults(categories) {
    return categories.map((category) => {
      const raw = (resultValues[category.id] || "").toString().trim();

      if (isDriverOfWeekendCategory(category.name)) {
        return {
          categoryId: category.id,
          valueText: null,
          valueNumber: raw ? Number(raw) : null
        };
      }

      return {
        categoryId: category.id,
        valueText: raw,
        valueNumber: null
      };
    });
  }

  async function submitResults(e) {
    e.preventDefault();
    setMessage("");

    if (!raceDetail) return;

    const results = buildCategoryResults(raceDetail.categories);

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

  async function importSprintQualifyingResults() {
    if (!selectedRaceId) return;
    setMessage("");
    setIsImportingSprintQualifying(true);

    try {
      const res = await apiFetch(`/admin/races/${selectedRaceId}/results/sprint-qualifying/import`, {
        method: "POST"
      });
      setMessage(res.message || "Sprint qualifying results imported");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setIsImportingSprintQualifying(false);
    }
  }

  async function saveSprintQualifyingResults() {
    if (!selectedRaceId || sprintQualificationCategories.length === 0) return;
    setMessage("");
    setIsSavingSprintQualifying(true);

    try {
      const res = await apiFetch(`/admin/races/${selectedRaceId}/results/sprint-qualifying`, {
        method: "POST",
        body: JSON.stringify({
          results: buildCategoryResults(sprintQualificationCategories)
        })
      });
      setMessage(res.message || "Sprint qualifying results saved");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setIsSavingSprintQualifying(false);
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
          {sprintQualificationCategories.length > 0 ? (
            <div className="rounded-xl border border-white/20 bg-white/5 p-3">
              <p className="text-sm font-semibold text-slate-100">Sprint Qualifying</p>
              <p className="mt-1 text-xs text-slate-400">Use OpenF1 import when available, or save only the sprint qualifying categories without marking the full race completed.</p>
              <div className="mt-3 flex flex-col gap-2 md:flex-row">
                <button
                  type="button"
                  className="tap rounded-xl bg-accent-cyan px-4 py-2 font-bold text-track-900 disabled:opacity-60"
                  onClick={importSprintQualifyingResults}
                  disabled={isImportingSprintQualifying}
                >
                  {isImportingSprintQualifying ? "Importing Sprint Qualifying..." : "Import Sprint Qualifying"}
                </button>
                <button
                  type="button"
                  className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-white disabled:opacity-60"
                  onClick={saveSprintQualifyingResults}
                  disabled={isSavingSprintQualifying}
                >
                  {isSavingSprintQualifying ? "Saving Sprint Qualifying..." : "Save Sprint Qualifying Only"}
                </button>
              </div>
            </div>
          ) : null}
          {hasDriverOfWeekendCategory && (!raceDetail.drivers || raceDetail.drivers.length === 0) ? (
            <p className="text-sm text-red-300">This race has driver-based categories but no race drivers are configured.</p>
          ) : null}

          {raceDetail.categories.map((category) => {
            const meta = getResultInputMeta(category, raceDetail.drivers, raceDetail.categories, resultValues);
            const teamOfWeekendCategory = raceDetail.categories.find((item) => isTeamOfWeekendCategory(item.name));
            const selectedTeam = getConfiguredTeamForCategory(category) || (teamOfWeekendCategory ? String(resultValues[teamOfWeekendCategory.id] || "").trim() : "");
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
