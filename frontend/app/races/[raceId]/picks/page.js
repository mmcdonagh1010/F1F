"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Header from "../../../../components/Header";
import { apiFetch } from "../../../../lib/api";

function isTeamBattleMarginCategory(name) {
  return String(name || "").toLowerCase().includes("team battle") && String(name || "").toLowerCase().includes("margin");
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
  const normalized = String(category?.name || "").toLowerCase();
  if (isTeamBattleMarginCategory(normalized)) return false;
  if (isDriverOfWeekendCategory(normalized)) return false;
  if (category?.is_position_based) return true;
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

function getConfiguredDriverForCategory(category) {
  return String(category?.metadata?.fixedDriver || "").trim();
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

function getDriverOfWeekendLabel(category) {
  const fixedDriver = String(category?.metadata?.fixedDriver || "").trim();
  const scopeLabel = getDriverOfWeekendScopeLabel(getDriverOfWeekendScope(category));
  return fixedDriver ? `${fixedDriver} ${scopeLabel}` : `Driver of the Weekend ${scopeLabel}`;
}

function buildPositionNumberOptions() {
  return Array.from({ length: 20 }, (_, index) => {
    const value = String(index + 1);
    return { value, label: value };
  });
}

function parsePositionCategoryMeta(category) {
  const match = String(category?.name || "").match(/^(Race Qualification|Sprint Qualification|Race Result|Sprint Result) P(\d+)$/i);
  if (!match) return null;

  const scope = match[1].toLowerCase().replace(/\s+/g, "-");
  return {
    scope,
    position: Number(match[2]),
    shortLabel: `P${match[2]}`
  };
}

function buildPredictionSections(categories) {
  const sectionOrder = [
    ["race-qualification", "Race Qualification Prediction", "Pick the qualifying order."],
    ["race-result", "Race Result Prediction", "Pick the race finish order."],
    ["sprint-qualification", "Sprint Qualification Prediction", "Pick the sprint qualifying order."],
    ["sprint-result", "Sprint Result Prediction", "Pick the sprint finish order."]
  ];

  const positionSections = sectionOrder
    .map(([scope, title, description]) => ({
      key: scope,
      title,
      description,
      layout: "positions",
      categories: (categories || [])
        .filter((category) => parsePositionCategoryMeta(category)?.scope === scope)
        .sort((a, b) => parsePositionCategoryMeta(a).position - parsePositionCategoryMeta(b).position)
    }))
    .filter((section) => section.categories.length > 0);

  const usedIds = new Set(positionSections.flatMap((section) => section.categories.map((category) => category.id)));
  const remaining = (categories || []).filter((category) => !usedIds.has(category.id));
  const teamBattleCategories = remaining.filter((category) =>
    isTeamBattleDriverCategory(category.name) || isTeamBattleMarginCategory(category.name) || isTeamOfWeekendCategory(category.name)
  );
  const driverOfWeekendCategories = remaining.filter((category) => isDriverOfWeekendCategory(category.name));
  const featuredCategories = remaining.filter(
    (category) =>
      !teamBattleCategories.some((item) => item.id === category.id) &&
      !driverOfWeekendCategories.some((item) => item.id === category.id)
  );

  const sections = [...positionSections];
  if (teamBattleCategories.length > 0) {
    sections.push({
      key: "team-battle",
      title: "Team Of The Weekend",
      description: "Make the team battle picks for the selected team.",
      layout: "stack",
      categories: teamBattleCategories
    });
  }
  if (driverOfWeekendCategories.length > 0) {
    sections.push({
      key: "driver-of-weekend",
      title: "Driver Of The Weekend",
      description: "Predict the locked driver's official finishing positions.",
      layout: "stack",
      categories: driverOfWeekendCategories
    });
  }
  if (featuredCategories.length > 0) {
    sections.push({
      key: "featured",
      title: "Special Predictions",
      description: "Complete the remaining weekend picks.",
      layout: "stack",
      categories: featuredCategories
    });
  }

  return sections;
}

function getInputMeta(category, race, values) {
  const drivers = race?.drivers || [];
  const categories = race?.categories || [];
  const configuredTeam = getConfiguredTeamForCategory(category);
  const teamOfWeekendCategory = categories.find((item) => isTeamOfWeekendCategory(item.name));
  const selectedTeam = configuredTeam || String(values?.[teamOfWeekendCategory?.id] || "").trim();

  if (isTeamBattleMarginCategory(category.name)) {
    return {
      inputType: "teamMarginBand",
      options: [
        { value: "1-2", label: "1-2" },
        { value: "3-4", label: "3-4" },
        { value: "5+", label: "5+" }
      ],
      hint: selectedTeam
        ? `Pick the finishing gap between the two ${selectedTeam} drivers.`
        : "Pick the teammate finishing-margin band."
    };
  }

  if (isDriverOfWeekendCategory(category.name)) {
    return {
      inputType: "positionNumberSelect",
      options: buildPositionNumberOptions(),
      hint: `Pick the finishing position for ${String(category?.metadata?.fixedDriver || "the selected driver").trim()} in ${getDriverOfWeekendScopeLabel(getDriverOfWeekendScope(category))}.`
    };
  }

  if (isTeamBattleDriverCategory(category.name)) {
    const options = (drivers || [])
      .filter((driver) => !selectedTeam || String(driver.team_name || "").trim() === selectedTeam)
      .map((driver) => ({
        value: driver.driver_name,
        label: driver.team_name ? `${driver.driver_name} (${driver.team_name})` : driver.driver_name
      }));

    return {
      inputType: "driverSelect",
      options,
      hint: selectedTeam
        ? `Pick one driver from ${selectedTeam}.`
        : "Select a driver from the official race list."
    };
  }

  if (isDriverSelectionCategory(category)) {
    return {
      inputType: "driverSelect",
      options: drivers.map((driver) => ({
        value: driver.driver_name,
        label: driver.team_name ? `${driver.driver_name} (${driver.team_name})` : driver.driver_name
      })),
      hint: "Select a driver from the official race list."
    };
  }

  if (isTeamOfWeekendCategory(category.name)) {
    const teams = [...new Set(drivers.map((driver) => String(driver.team_name || "").trim()).filter(Boolean))];
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
  const [savedValues, setSavedValues] = useState({});
  const [message, setMessage] = useState("");
  const [isLocked, setIsLocked] = useState(false);
  const [selectedLeagueId, setSelectedLeagueId] = useState("");
  const [applyToAllLeagues, setApplyToAllLeagues] = useState(false);
  const [availableLeagues, setAvailableLeagues] = useState([]);
  const [updatedLeagueNames, setUpdatedLeagueNames] = useState([]);
  const [saveStatus, setSaveStatus] = useState("empty");
  const [submittedAt, setSubmittedAt] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

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
          setSaveStatus(existing.status || "empty");
          setSubmittedAt(existing.submittedAt || null);
        } catch {
          // Keep empty defaults if no picks found.
          setSaveStatus("empty");
          setSubmittedAt(null);
        }

        setValues(initial);
        setSavedValues(initial);
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
        setSavedValues(next);
        setSaveStatus(existing.status || "empty");
        setSubmittedAt(existing.submittedAt || null);
      })
      .catch(() => {});
  }, [raceId, selectedLeagueId, race]);

  const sections = useMemo(() => buildPredictionSections(race?.categories || []), [race]);
  const hasUnsavedChanges = useMemo(() => JSON.stringify(values) !== JSON.stringify(savedValues), [values, savedValues]);

  useEffect(() => {
    if (isLocked || !hasUnsavedChanges) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges, isLocked]);

  async function savePicks(mode) {
    if (isLocked) {
      setMessage("Picks are locked for this race. You can view your submitted picks below.");
      return;
    }
    setIsSaving(true);
    const picks = race.categories.map((category) => {
      const raw = (values[category.id] || "").toString().trim();

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

    try {
      const res = await apiFetch(`/picks/${raceId}`, {
        method: "POST",
        body: JSON.stringify({
          picks,
          leagueId: selectedLeagueId,
          applyToAllLeagues: applyToAllLeagues && availableLeagues.length > 1,
          mode
        })
      });
      const updatedNames = (res.leagueIds || [])
        .map((id) => availableLeagues.find((league) => league.id === id)?.name || id)
        .filter(Boolean);
      setUpdatedLeagueNames(updatedNames);
      setSavedValues(values);
      setSaveStatus(res.status || (mode === "submit" ? "submitted" : "draft"));
      setSubmittedAt(res.submittedAt || null);
      setMessage(mode === "submit" ? "Picks submitted successfully" : "Draft saved successfully");
    } catch (err) {
      setUpdatedLeagueNames([]);
      setMessage(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  if (!race) {
    return <p>Loading race...</p>;
  }

  function renderCategoryField(category, compact = false) {
    const meta = getInputMeta(category, race, values);
    const configuredTeam = getConfiguredTeamForCategory(category);
    const teamOfWeekendCategory = race.categories.find((item) => isTeamOfWeekendCategory(item.name));
    const selectedTeam = configuredTeam || (teamOfWeekendCategory ? String(values[teamOfWeekendCategory.id] || "").trim() : "");
    const filteredDriverOptions = isTeamBattleDriverCategory(category.name) && selectedTeam
      ? (meta.options || []).filter((option) => option.label.includes(`(${selectedTeam})`))
      : meta.options;
    const positionMeta = parsePositionCategoryMeta(category);

    return (
      <label key={category.id} className={`block ${compact ? "rounded-2xl border border-white/10 bg-white/5 p-3" : ""}`}>
        <span className="mb-1 block text-sm font-semibold text-slate-200">
          {positionMeta ? positionMeta.shortLabel : isDriverOfWeekendCategory(category.name) ? getDriverOfWeekendLabel(category) : category.name}
        </span>
        {positionMeta ? <span className="mb-2 block text-xs text-slate-400">{category.name}</span> : null}
        {meta.inputType === "driverSelect" ? (
          <select
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            value={values[category.id] || ""}
            disabled={isLocked}
            onChange={(e) => setValues({ ...values, [category.id]: e.target.value })}
          >
            <option value="" className="bg-track-900 text-slate-300">
              {isDriverOfWeekendCategory(category.name) && filteredDriverOptions?.length === 0
                ? "Select position picks first"
                : isTeamBattleDriverCategory(category.name) && selectedTeam
                ? `Select driver from ${selectedTeam}`
                : "Select driver"}
            </option>
            {(filteredDriverOptions || []).map((option) => (
              <option key={option.value} value={option.value} className="bg-track-900 text-white">
                {option.label}
              </option>
            ))}
          </select>
        ) : meta.inputType === "positionNumberSelect" ? (
          <select
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            value={values[category.id] || ""}
            disabled={isLocked}
            onChange={(e) => setValues({ ...values, [category.id]: e.target.value })}
          >
            <option value="" className="bg-track-900 text-slate-300">Select position</option>
            {meta.options.map((option) => (
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
          >
            <option value="" className="bg-track-900 text-slate-300">Select team</option>
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
          >
            <option value="" className="bg-track-900 text-slate-300">Select gap</option>
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
          />
        )}
        {meta.hint ? <span className="mt-1 block text-xs text-slate-400">{meta.hint}</span> : null}
      </label>
    );
  }

  return (
    <div className="pb-24">
      <Header title={race.name} subtitle="Lock in your predictions" />
      <form className="card space-y-4 p-5">
        {isLocked ? (
          <p className="rounded-xl border border-amber-300/40 bg-amber-500/15 p-2 text-sm text-amber-200">
            Picks are locked because the deadline window is now closed. You can only view picks.
          </p>
        ) : null}
        {!isLocked && hasUnsavedChanges ? (
          <p className="rounded-xl border border-sky-300/30 bg-sky-500/10 p-2 text-sm text-sky-100">
            You have unsaved prediction changes.
          </p>
        ) : null}
        {!isLocked && saveStatus === "submitted" ? (
          <p className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 p-2 text-sm text-emerald-100">
            Final picks submitted{submittedAt ? ` on ${new Date(submittedAt).toLocaleString()}` : ""}. You can still update them until the lock window closes.
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
        {sections.map((section) => {
          const fixedTeam = section.categories.map(getConfiguredTeamForCategory).find(Boolean) || "";
          const fixedDriver = section.categories.map(getConfiguredDriverForCategory).find(Boolean) || "";
          return (
            <section key={section.key} className="rounded-3xl border border-white/15 bg-white/5 p-4">
              <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">{section.title}</h2>
                  <p className="text-xs text-slate-400">{section.description}</p>
                </div>
                {fixedTeam ? (
                  <span className="inline-flex w-fit rounded-full border border-accent-cyan/40 bg-accent-cyan/10 px-3 py-1 text-xs font-semibold text-accent-cyan">
                    Team locked by admin: {fixedTeam}
                  </span>
                ) : fixedDriver ? (
                  <span className="inline-flex w-fit rounded-full border border-accent-cyan/40 bg-accent-cyan/10 px-3 py-1 text-xs font-semibold text-accent-cyan">
                    Driver locked by admin: {fixedDriver}
                  </span>
                ) : null}
              </div>
              <div className={section.layout === "positions" ? "grid grid-cols-1 gap-3 md:grid-cols-3" : "space-y-3"}>
                {section.categories.map((category) => renderCategoryField(category, section.layout === "positions"))}
              </div>
            </section>
          );
        })}
        {!isLocked ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <button
              type="button"
              className="tap w-full rounded-xl border border-white/30 px-4 py-3 font-bold text-white disabled:opacity-60"
              onClick={() => savePicks("draft")}
              disabled={isSaving}
            >
              Save Draft
            </button>
            <button
              type="button"
              className="tap w-full rounded-xl bg-accent-red px-4 py-3 font-bold text-white disabled:opacity-60"
              onClick={() => savePicks("submit")}
              disabled={isSaving}
            >
              Final Submit
            </button>
          </div>
        ) : null}
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
