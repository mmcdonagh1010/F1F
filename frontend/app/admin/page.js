"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "../../components/Header";
import BottomNav from "../../components/BottomNav";
import { apiFetch } from "../../lib/api";
import { getStoredUser } from "../../lib/auth";

const PREDICTION_OPTIONS = [
  { key: "raceQualificationPositions", label: "Race Qualification Positions", sprintOnly: false, defaultExactPoints: 5, defaultPartialPoints: 1 },
  { key: "sprintQualificationPositions", label: "Sprint Qualification Positions", sprintOnly: true, defaultExactPoints: 5, defaultPartialPoints: 1 },
  { key: "sprintResult", label: "Sprint Result Winner", sprintOnly: true, defaultExactPoints: 10, defaultPartialPoints: 5 },
  { key: "racePositions", label: "Race Positions (custom slots)", sprintOnly: false, defaultExactPoints: 5, defaultPartialPoints: 1 },
  { key: "sprintPositions", label: "Sprint Positions (custom slots)", sprintOnly: true, defaultExactPoints: 5, defaultPartialPoints: 1 },
  { key: "driverOfWeekend", label: "Driver of the Weekend", sprintOnly: false, defaultExactPoints: 10, defaultPartialPoints: 0 },
  { key: "teamOfWeekend", label: "Team of the Weekend", sprintOnly: false, defaultExactPoints: 10, defaultPartialPoints: 0 },
  { key: "fastestLapDriver", label: "Fastest Lap Driver", sprintOnly: false, defaultExactPoints: 8, defaultPartialPoints: 0 }
];

const ADMIN_TABS = [
  { key: "leagues", label: "Leagues" },
  { key: "predictionOptions", label: "Prediction Options" },
  { key: "createRace", label: "Create Race" },
  { key: "drivers", label: "Drivers" },
  { key: "sync", label: "API Sync" },
  { key: "results", label: "Results" },
  { key: "visibility", label: "Visibility" },
  { key: "settings", label: "Settings" },
  { key: "users", label: "Users" }
];

const OPTION_CATEGORY_NAMES = {
  sprintResult: "Sprint Result Winner",
  driverOfWeekend: "Driver of the Weekend",
  teamOfWeekend: "Team of the Weekend",
  fastestLapDriver: "Fastest Lap Driver"
};

function parseCsvLikeList(text) {
  return text
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  values.push(current.trim());
  return values;
}

function parseCsvObjects(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = cols[idx] ?? "";
    });
    return row;
  });
}

function parseCsvBulkPayload(type, text) {
  const rows = parseCsvObjects(text);

  if (type === "races") {
    return {
      races: rows.map((row) => ({
        leagueId: row.leagueId || undefined,
        leagueIds: parseCsvLikeList(row.leagueIds || "").map((item) => item.trim()).filter(Boolean),
        applyToAllLeagues: parseBool(row.applyToAllLeagues, true),
        name: row.name,
        circuitName: row.circuitName,
        externalRound: row.externalRound ? Number(row.externalRound) : null,
        raceDate: row.raceDate,
        deadlineAt: row.deadlineAt,
        hasSprintWeekend: parseBool(row.hasSprintWeekend),
        predictionOptions: parseCsvLikeList(row.predictionOptions || ""),
        positionSlotsByOption: {
          racePositions: parseCsvLikeList(row.racePositionSlots || row.positionSlots || "")
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item > 0),
          sprintPositions: parseCsvLikeList(row.sprintPositionSlots || row.positionSlots || "")
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item > 0),
          raceQualificationPositions: parseCsvLikeList(row.raceQualificationSlots || row.qualificationPositionSlots || "")
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item > 0),
          sprintQualificationPositions: parseCsvLikeList(row.sprintQualificationSlots || row.qualificationPositionSlots || "")
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item > 0)
        },
        drivers: parseCsvLikeList(row.drivers || "").map((entry) => {
          const [name, teamName] = entry.split("|").map((part) => part.trim());
          return { name, teamName: teamName || "" };
        })
      }))
    };
  }

  if (type === "drivers") {
    const grouped = new Map();
    rows.forEach((row) => {
      const raceId = String(row.raceId || "").trim();
      const driverName = String(row.driverName || "").trim();
      const teamName = String(row.teamName || "").trim();
      if (!raceId || !driverName) return;

      const current = grouped.get(raceId) || [];
      current.push({ name: driverName, teamName });
      grouped.set(raceId, current);
    });

    return {
      uploads: Array.from(grouped.entries()).map(([raceId, drivers]) => ({ raceId, drivers }))
    };
  }

  if (type === "results") {
    const grouped = new Map();
    rows.forEach((row) => {
      const raceId = String(row.raceId || "").trim();
      const categoryName = String(row.categoryName || "").trim();
      if (!raceId || !categoryName) return;

      const current = grouped.get(raceId) || {
        raceId,
        tieBreakerValue: row.tieBreakerValue || null,
        results: []
      };

      current.results.push({
        categoryName,
        valueText: row.valueText || null,
        valueNumber: row.valueNumber ? Number(row.valueNumber) : null
      });

      grouped.set(raceId, current);
    });

    return {
      uploads: Array.from(grouped.values())
    };
  }

  return null;
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

function normalizeDriverRows(drivers) {
  if (!Array.isArray(drivers)) return [];
  return drivers
    .map((driver) => {
      if (typeof driver === "string") return { name: driver, teamName: "" };
      return {
        name: String(driver?.name || driver?.driverName || "").trim(),
        teamName: String(driver?.teamName || driver?.team || "").trim()
      };
    })
    .filter((driver) => driver.name);
}

function mapCategoryNameToOptionKey(categoryName) {
  const normalized = String(categoryName || "").toLowerCase();
  if (/^race result p\d+$/i.test(categoryName || "")) return "racePositions";
  if (/^sprint result p\d+$/i.test(categoryName || "")) return "sprintPositions";
  if (/^race qualification p\d+$/i.test(categoryName || "")) return "raceQualificationPositions";
  if (/^sprint qualification p\d+$/i.test(categoryName || "")) return "sprintQualificationPositions";
  if (normalized.includes("sprint result winner")) return "sprintResult";
  if (normalized.includes("driver of the weekend")) return "driverOfWeekend";
  if (normalized.includes("team of the weekend")) return "teamOfWeekend";
  if (normalized.includes("team battle") && normalized.includes("driver")) return "teamOfWeekend";
  if (normalized.includes("team battle") && normalized.includes("margin")) return "teamOfWeekend";
  if (normalized.includes("fastest lap driver")) return "fastestLapDriver";
  return null;
}

function getDriverOfWeekendScopeLabel(scope) {
  if (scope === "race-result") return "Race Result";
  if (scope === "sprint-result") return "Sprint Result";
  if (scope === "race-qualification") return "Race Qualification";
  if (scope === "sprint-qualification") return "Sprint Qualification";
  return "Weekend Position";
}

function formatDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (input) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function hasSprintCategories(categories) {
  return (categories || []).some((category) => {
    const name = String(category?.name || "").toLowerCase();
    return name.includes("sprint qualification") || name.includes("sprint result");
  });
}

export default function AdminPage() {
  const router = useRouter();
  const currentYear = new Date().getUTCFullYear();
  const [activeTab, setActiveTab] = useState("leagues");
  const [isRoleResolved, setIsRoleResolved] = useState(false);

  const [message, setMessage] = useState("");
  const [allRaces, setAllRaces] = useState([]);
  const [leagues, setLeagues] = useState([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState("");
  const [leagueMembers, setLeagueMembers] = useState([]);

  const [createLeagueForm, setCreateLeagueForm] = useState({ name: "", inviteCode: "" });
  const [leagueMessage, setLeagueMessage] = useState("");
  const [editingLeagueId, setEditingLeagueId] = useState(null);
  const [editingLeagueForm, setEditingLeagueForm] = useState({ name: "", inviteCode: "" });
  const [editingRaceId, setEditingRaceId] = useState("");

  const [race, setRace] = useState({
    leagueId: "",
    leagueIds: [],
    applyToAllLeagues: true,
    name: "",
    circuitName: "",
    externalRound: "",
    raceDate: "",
    deadlineAt: "",
    hasSprintWeekend: false
  });
  const [selectedOptions, setSelectedOptions] = useState(["raceQualificationPositions", "racePositions", "fastestLapDriver"]);
  const [optionPoints, setOptionPoints] = useState(() =>
    Object.fromEntries(
      PREDICTION_OPTIONS.map((option) => [
        option.key,
        {
          exactPoints: option.defaultExactPoints,
          partialPoints: option.defaultPartialPoints
        }
      ])
    )
  );
  const [racePositionSlotsInput, setRacePositionSlotsInput] = useState("1,2,3");
  const [sprintPositionSlotsInput, setSprintPositionSlotsInput] = useState("1,2,3");
  const [raceQualificationSlotsInput, setRaceQualificationSlotsInput] = useState("1,2,3");
  const [sprintQualificationSlotsInput, setSprintQualificationSlotsInput] = useState("1,2,3");
  const [predictionPreview, setPredictionPreview] = useState({
    driverOfWeekend: "",
    teamOfWeekend: ""
  });
  const [predictionYear, setPredictionYear] = useState(String(currentYear));
  const [users, setUsers] = useState([]);
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingUserForm, setEditingUserForm] = useState({ name: "", email: "" });
  const [predictionRaceId, setPredictionRaceId] = useState("");
  const [predictionRaceDetail, setPredictionRaceDetail] = useState(null);
  const [predictionMessage, setPredictionMessage] = useState("");

  const [syncSeason, setSyncSeason] = useState(String(currentYear));
  const [syncMessage, setSyncMessage] = useState("");
  const [syncStatus, setSyncStatus] = useState(null);

  const [selectedDriverRaceId, setSelectedDriverRaceId] = useState("");
  const [driverYear, setDriverYear] = useState(String(currentYear));
  const [driverRows, setDriverRows] = useState([]);
  const [driverMessage, setDriverMessage] = useState("");

  const [bulkMessage, setBulkMessage] = useState("");

  const [lockMinutesInput, setLockMinutesInput] = useState("");
  const [lockMessage, setLockMessage] = useState("");

  const selectedLeague = useMemo(
    () => leagues.find((league) => league.id === selectedLeagueId) || null,
    [leagues, selectedLeagueId]
  );

  const availableRaceDrivers = useMemo(() => {
    const sourceDrivers = predictionRaceDetail?.drivers || [];
    return sourceDrivers
      .map((row) => ({
        name: String(row?.driver_name || "").trim(),
        teamName: String(row?.team_name || "").trim()
      }))
      .filter((row) => row.name);
  }, [predictionRaceDetail]);

  const availableRaceTeams = useMemo(() => {
    return [...new Set(availableRaceDrivers.map((row) => row.teamName).filter(Boolean))];
  }, [availableRaceDrivers]);

  const predictionYearOptions = useMemo(() => {
    const years = new Set([currentYear]);
    allRaces.forEach((raceRow) => {
      const y = new Date(raceRow.race_date).getUTCFullYear();
      if (Number.isInteger(y)) years.add(y);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [allRaces, currentYear]);

  const selectableDriverRaces = useMemo(() => {
    return allRaces
      .filter((raceRow) => new Date(raceRow.race_date).getUTCFullYear() === Number(driverYear))
      .sort((a, b) => new Date(a.race_date).getTime() - new Date(b.race_date).getTime());
  }, [allRaces, driverYear]);

  const selectablePredictionRaces = useMemo(() => {
    const now = Date.now();
    return allRaces
      .filter((raceRow) => new Date(raceRow.race_date).getUTCFullYear() === Number(predictionYear))
      .filter((raceRow) => raceRow.status !== "completed")
      .filter((raceRow) => new Date(raceRow.race_date).getTime() > now)
      .sort((a, b) => new Date(a.race_date).getTime() - new Date(b.race_date).getTime());
  }, [allRaces, predictionYear]);

  async function loadRaces() {
    try {
      const data = await apiFetch("/races");
      setAllRaces(data);
    } catch {
      setAllRaces([]);
    }
  }

  async function loadLeagues() {
    try {
      const data = await apiFetch("/admin/leagues");
      setLeagues(data);
      if (!selectedLeagueId && data[0]?.id) {
        setSelectedLeagueId(data[0].id);
        setRace((prev) => ({ ...prev, leagueId: data[0].id }));
      }
    } catch {
      setLeagues([]);
    }
  }

  async function loadLockSetting() {
    try {
      const data = await apiFetch("/admin/settings/pick-lock-minutes");
      setLockMinutesInput(String(data.value));
    } catch (err) {
      setLockMessage(err.message);
    }
  }

  async function loadSyncStatus() {
    try {
      const data = await apiFetch("/admin/sync/jolpica/status");
      setSyncStatus(data);
    } catch (err) {
      setSyncMessage(err.message);
      setSyncStatus(null);
    }
  }

  async function loadLeagueMembers(leagueId) {
    if (!leagueId) return;
    try {
      const data = await apiFetch(`/admin/leagues/${leagueId}/members`);
      setLeagueMembers(data.members || []);
    } catch (err) {
      setLeagueMessage(err.message);
      setLeagueMembers([]);
    }
  }

  async function loadDriversForRace(raceId) {
    if (!raceId) return;
    try {
      const detail = await apiFetch(`/races/${raceId}`);
      const mapped = (detail.drivers || []).map((driver) => ({
        name: driver.driver_name,
        teamName: driver.team_name || ""
      }));
      setDriverRows(mapped.length > 0 ? mapped : [{ name: "", teamName: "" }]);
    } catch {
      setDriverRows([{ name: "", teamName: "" }]);
    }
  }

  async function loadPredictionRaceDetail(raceId) {
    if (!raceId) {
      setPredictionRaceDetail(null);
      return;
    }

    try {
      const detail = await apiFetch(`/races/${raceId}`);
      setPredictionRaceDetail(detail);
      const selected = new Set();
      const pointsByOption = {};
      const raceSlots = [];
      const sprintSlots = [];
      const raceQualificationSlots = [];
      const sprintQualificationSlots = [];
      let configuredTeamOfWeekend = "";
      let configuredDriverOfWeekend = "";

      (detail.categories || []).forEach((category) => {
        const optionKey = mapCategoryNameToOptionKey(category.name);
        if (!optionKey) return;
        selected.add(optionKey);

        if (!configuredTeamOfWeekend && category?.metadata?.fixedTeam) {
          configuredTeamOfWeekend = String(category.metadata.fixedTeam).trim();
        }
        if (!configuredDriverOfWeekend && category?.metadata?.fixedDriver) {
          configuredDriverOfWeekend = String(category.metadata.fixedDriver).trim();
        }

        if (!pointsByOption[optionKey]) {
          pointsByOption[optionKey] = {
            exactPoints: Number(category.exact_points || 0),
            partialPoints: Number(category.partial_points || 0)
          };
        }

        const raceMatch = String(category.name || "").match(/^Race Result P(\d+)$/i);
        if (raceMatch) raceSlots.push(Number(raceMatch[1]));
        const sprintMatch = String(category.name || "").match(/^Sprint Result P(\d+)$/i);
        if (sprintMatch) sprintSlots.push(Number(sprintMatch[1]));
        const raceQualificationMatch = String(category.name || "").match(/^Race Qualification P(\d+)$/i);
        if (raceQualificationMatch) raceQualificationSlots.push(Number(raceQualificationMatch[1]));
        const sprintQualificationMatch = String(category.name || "").match(/^Sprint Qualification P(\d+)$/i);
        if (sprintQualificationMatch) sprintQualificationSlots.push(Number(sprintQualificationMatch[1]));
      });

      setSelectedOptions(Array.from(selected));
      setOptionPoints((prev) => ({ ...prev, ...pointsByOption }));
      if (raceSlots.length > 0) setRacePositionSlotsInput(raceSlots.sort((a, b) => a - b).join(","));
      if (sprintSlots.length > 0) setSprintPositionSlotsInput(sprintSlots.sort((a, b) => a - b).join(","));
      if (raceQualificationSlots.length > 0) {
        setRaceQualificationSlotsInput(raceQualificationSlots.sort((a, b) => a - b).join(","));
      }
      if (sprintQualificationSlots.length > 0) {
        setSprintQualificationSlotsInput(sprintQualificationSlots.sort((a, b) => a - b).join(","));
      }
      setPredictionPreview((prev) => ({
        ...prev,
        teamOfWeekend: configuredTeamOfWeekend,
        driverOfWeekend: configuredDriverOfWeekend
      }));

      const hasSprint = Array.from(selected).some((key) =>
        ["sprintQualificationPositions", "sprintResult", "sprintPositions"].includes(key)
      );
      setRace((prev) => ({ ...prev, hasSprintWeekend: hasSprint }));
    } catch {
      setPredictionRaceDetail(null);
    }
  }

  useEffect(() => {
    const user = getStoredUser();
    if (!user) {
      router.replace("/login");
      return;
    }

    if (user.role !== "admin") {
      router.replace("/dashboard");
      return;
    }

    setIsRoleResolved(true);
  }, [router]);

  useEffect(() => {
    if (!isRoleResolved) return;
    loadRaces();
    loadLeagues();
    loadLockSetting();
    loadSyncStatus();
  }, [isRoleResolved]);

  useEffect(() => {
    if (!isRoleResolved) return;
    if (activeTab !== "sync") return;
    loadSyncStatus();
  }, [activeTab, isRoleResolved]);

  useEffect(() => {
    if (!isRoleResolved) return;
    if (activeTab !== "users") return;
    (async () => {
      try {
        const data = await apiFetch("/admin/users");
        setUsers(data);
      } catch (err) {
        setMessage(String(err.message || err));
      }
    })();
  }, [activeTab, isRoleResolved]);

  useEffect(() => {
    if (!isRoleResolved) return;
    if (selectedLeagueId) {
      loadLeagueMembers(selectedLeagueId);
      setRace((prev) => ({ ...prev, leagueId: selectedLeagueId }));
    }
  }, [selectedLeagueId, isRoleResolved]);

  useEffect(() => {
    if (!isRoleResolved) return;
    if (selectedDriverRaceId) {
      loadDriversForRace(selectedDriverRaceId);
    }
  }, [selectedDriverRaceId, isRoleResolved]);

  useEffect(() => {
    if (!isRoleResolved) return;
    if (selectableDriverRaces.length === 0) {
      setSelectedDriverRaceId("");
      setDriverRows([{ name: "", teamName: "" }]);
      return;
    }

    if (!selectableDriverRaces.find((raceRow) => raceRow.id === selectedDriverRaceId)) {
      setSelectedDriverRaceId(selectableDriverRaces[0].id);
    }
  }, [driverYear, isRoleResolved, selectableDriverRaces, selectedDriverRaceId]);

  useEffect(() => {
    if (!isRoleResolved) return;
    if (selectablePredictionRaces.length === 0) {
      setPredictionRaceId("");
      setPredictionRaceDetail(null);
      return;
    }

    if (!selectablePredictionRaces.find((raceRow) => raceRow.id === predictionRaceId)) {
      setPredictionRaceId(selectablePredictionRaces[0].id);
    }
  }, [predictionRaceId, selectablePredictionRaces, isRoleResolved]);

  useEffect(() => {
    if (!isRoleResolved) return;
    if (!predictionRaceId) return;
    loadPredictionRaceDetail(predictionRaceId);
  }, [predictionRaceId, isRoleResolved]);

  if (!isRoleResolved) {
    return (
      <div className="pb-24">
        <Header title="Admin" subtitle="Checking access" />
        <p className="card p-4 text-sm text-slate-300">Checking permissions...</p>
      </div>
    );
  }

  function toggleOption(key) {
    setSelectedOptions((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  }

  function updateOptionPoints(optionKey, field, value) {
    const parsed = Number(value);
    const safeValue = Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;

    setOptionPoints((current) => ({
      ...current,
      [optionKey]: {
        ...(current[optionKey] || { exactPoints: 0, partialPoints: 0 }),
        [field]: safeValue
      }
    }));
  }

  async function createLeague(e) {
    e.preventDefault();
    setLeagueMessage("");
    try {
      await apiFetch("/admin/leagues", {
        method: "POST",
        body: JSON.stringify({
          name: createLeagueForm.name,
          inviteCode: createLeagueForm.inviteCode || undefined
        })
      });
      setCreateLeagueForm({ name: "", inviteCode: "" });
      setLeagueMessage("League created.");
      await loadLeagues();
    } catch (err) {
      setLeagueMessage(err.message);
    }
  }

  async function saveLeagueEdits() {
    if (!editingLeagueId) return;

    setLeagueMessage("");
    try {
      const payload = {
        name: editingLeagueForm.name,
        inviteCode: editingLeagueForm.inviteCode
      };
      const updated = await apiFetch(`/admin/leagues/${editingLeagueId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });

      setLeagues((prev) => prev.map((league) => (league.id === editingLeagueId ? updated : league)));
      if (selectedLeagueId === editingLeagueId) {
        setSelectedLeagueId(updated.id);
        await loadLeagueMembers(updated.id);
      }
      setEditingLeagueId(null);
      setEditingLeagueForm({ name: "", inviteCode: "" });
      setLeagueMessage("League updated.");
    } catch (err) {
      setLeagueMessage(err.message);
    }
  }

  async function updateUserRole(userId, role) {
    try {
      const updated = await apiFetch(`/admin/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      });
      setUsers((prev) => prev.map((row) => (row.id === userId ? { ...row, role: updated.role } : row)));
      setMessage("User role updated");
    } catch (err) {
      setMessage(String(err.message || err));
    }
  }

  async function createRace(e) {
    e.preventDefault();
    setMessage("");

    const racePositionSlots = parseCsvLikeList(racePositionSlotsInput)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);

    const sprintPositionSlots = parseCsvLikeList(sprintPositionSlotsInput)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    const raceQualificationSlots = parseCsvLikeList(raceQualificationSlotsInput)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    const sprintQualificationSlots = parseCsvLikeList(sprintQualificationSlotsInput)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);

    const payload = {
      ...race,
      externalRound: race.externalRound ? Number(race.externalRound) : null,
      predictionOptions: selectedOptions,
      pointOverrides: Object.fromEntries(
        selectedOptions.map((optionKey) => [
          optionKey,
          {
            exactPoints: Number(optionPoints[optionKey]?.exactPoints || 0),
            partialPoints: Number(optionPoints[optionKey]?.partialPoints || 0)
          }
        ])
      ),
      positionSlotsByOption: {
        racePositions: racePositionSlots,
        sprintPositions: sprintPositionSlots,
        raceQualificationPositions: raceQualificationSlots,
        sprintQualificationPositions: sprintQualificationSlots
      },
      drivers: []
    };

    try {
      if (editingRaceId) {
        await apiFetch(`/admin/races/${editingRaceId}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        setMessage("Race updated");
      } else {
        await apiFetch("/admin/races", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        setMessage("Race created with selected options");
      }
      await loadRaces();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function loadRaceEditor(raceId) {
    if (!raceId) {
      setEditingRaceId("");
      setRace((prev) => ({
        ...prev,
        applyToAllLeagues: true,
        leagueId: selectedLeagueId || "",
        leagueIds: selectedLeagueId ? [selectedLeagueId] : [],
        name: "",
        circuitName: "",
        externalRound: "",
        raceDate: "",
        deadlineAt: "",
        hasSprintWeekend: false
      }));
      return;
    }

    try {
      const detail = await apiFetch(`/races/${raceId}`);
      const assignedLeagueIds = (detail.available_leagues || []).map((league) => league.id);
      setEditingRaceId(raceId);
      setRace((prev) => ({
        ...prev,
        applyToAllLeagues: leagues.length > 0 && assignedLeagueIds.length === leagues.length,
        leagueId: assignedLeagueIds[0] || "",
        leagueIds: assignedLeagueIds,
        name: detail.name || "",
        circuitName: detail.circuit_name || "",
        externalRound: detail.external_round ? String(detail.external_round) : "",
        raceDate: formatDateTimeLocal(detail.race_date),
        deadlineAt: formatDateTimeLocal(detail.deadline_at),
        hasSprintWeekend: hasSprintCategories(detail.categories)
      }));
      setMessage("");
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function setRaceVisibility(raceId, isVisible) {
    try {
      await apiFetch(`/admin/races/${raceId}/visibility`, {
        method: "PATCH",
        body: JSON.stringify({ isVisible })
      });
      await loadRaces();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function refreshFromJolpica() {
    setSyncMessage("");
    if (!race.applyToAllLeagues && !race.leagueId) {
      setSyncMessage("Select a league or enable all-league sync.");
      return;
    }

    try {
      const res = await apiFetch("/admin/sync/jolpica", {
        method: "POST",
        body: JSON.stringify({
          leagueId: race.applyToAllLeagues ? null : race.leagueId,
          season: Number(syncSeason)
        })
      });
      const skippedNote = res.skippedDriverRefresh
        ? `, preserved historical driver snapshots for ${res.skippedDriverRefresh} race(s)`
        : "";
      setSyncMessage(
        `Race sync done: created ${res.created}, updated ${res.updated}, drivers/race ${res.driversPerRace}${skippedNote}`
      );
      await loadRaces();
      await loadPredictionRaceDetail(predictionRaceId);
      await loadSyncStatus();
    } catch (err) {
      setSyncMessage(err.message);
    }
  }

  async function syncLatestResults() {
    setSyncMessage("");
    if (!race.leagueId) {
      setSyncMessage("Select a league first.");
      return;
    }

    try {
      const res = await apiFetch("/admin/sync/jolpica/latest-results", {
        method: "POST",
        body: JSON.stringify({
          leagueId: race.leagueId,
          season: Number(syncSeason)
        })
      });
      if (res.updated) {
        setSyncMessage(`Latest race synced to ${res.raceName}. Categories mapped: ${res.mappedCount}.`);
      } else {
        setSyncMessage(res.reason || "No updates were applied.");
      }
      await loadSyncStatus();
    } catch (err) {
      setSyncMessage(err.message);
    }
  }

  async function syncCompletedResults() {
    setSyncMessage("");

    try {
      const res = await apiFetch("/admin/sync/jolpica/completed-results", {
        method: "POST",
        body: JSON.stringify({ season: Number(syncSeason) })
      });
      setSyncMessage(
        `Completed-result sync done: updated ${res.updatedRaces} race(s), applied ${res.updatedResults} result entries, skipped ${res.skipped?.length || 0}.`
      );
      await loadSyncStatus();
    } catch (err) {
      setSyncMessage(err.message);
    }
  }

  function updateDriverRow(index, field, value) {
    setDriverRows((current) => current.map((row, idx) => (idx === index ? { ...row, [field]: value } : row)));
  }

  function addDriverRow() {
    setDriverRows((current) => [...current, { name: "", teamName: "" }]);
  }

  function removeDriverRow(index) {
    setDriverRows((current) => current.filter((_, idx) => idx !== index));
  }

  async function saveRaceDrivers() {
    setDriverMessage("");
    try {
      const payload = normalizeDriverRows(driverRows);
      if (payload.length === 0) {
        setDriverMessage("Add at least one driver before saving.");
        return;
      }

      const res = await apiFetch(`/admin/races/${selectedDriverRaceId}/drivers`, {
        method: "PUT",
        body: JSON.stringify({ drivers: payload })
      });
      setDriverMessage(`${res.message}. Count: ${res.count}.`);
      await loadRaces();
      await loadDriversForRace(selectedDriverRaceId);
    } catch (err) {
      setDriverMessage(err.message);
    }
  }

  async function savePickLockMinutes(e) {
    e.preventDefault();
    setLockMessage("");

    const parsed = Number(lockMinutesInput);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 180) {
      setLockMessage("Value must be a whole number between 0 and 180.");
      return;
    }

    try {
      const data = await apiFetch("/admin/settings/pick-lock-minutes", {
        method: "PUT",
        body: JSON.stringify({ value: parsed })
      });
      setLockMinutesInput(String(data.setting.value));
      setLockMessage(`Saved: ${data.setting.value} minutes before deadline.`);
    } catch (err) {
      setLockMessage(err.message);
    }
  }

  async function savePredictionOptionsForRace() {
    setPredictionMessage("");
    if (!predictionRaceId) {
      setPredictionMessage("Select a race first.");
      return;
    }

    const raceSlots = parseCsvLikeList(racePositionSlotsInput)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    const sprintSlots = parseCsvLikeList(sprintPositionSlotsInput)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    const raceQualificationSlots = parseCsvLikeList(raceQualificationSlotsInput)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    const sprintQualificationSlots = parseCsvLikeList(sprintQualificationSlotsInput)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
    const fixedTeamOfWeekend = String(predictionPreview.teamOfWeekend || "").trim();
    const fixedDriverOfWeekend = String(predictionPreview.driverOfWeekend || "").trim();

    if (selectedOptions.includes("teamOfWeekend") && !fixedTeamOfWeekend) {
      setPredictionMessage("Select the fixed team for Team of the Weekend.");
      return;
    }

    if (selectedOptions.includes("driverOfWeekend") && !fixedDriverOfWeekend) {
      setPredictionMessage("Select the fixed driver for Driver of the Weekend.");
      return;
    }

    const driverOfWeekendScopes = [
      selectedOptions.includes("racePositions") ? "race-result" : null,
      selectedOptions.includes("sprintPositions") ? "sprint-result" : null,
      selectedOptions.includes("raceQualificationPositions") ? "race-qualification" : null,
      selectedOptions.includes("sprintQualificationPositions") ? "sprint-qualification" : null
    ].filter(Boolean);

    if (selectedOptions.includes("driverOfWeekend") && driverOfWeekendScopes.length === 0) {
      setPredictionMessage("Driver of the Weekend needs at least one selected position group to inherit from.");
      return;
    }

    const categories = [];
    let displayOrder = 1;
    [...new Set(selectedOptions)].forEach((optionKey) => {
      const option = PREDICTION_OPTIONS.find((item) => item.key === optionKey);
      if (!option) return;
      if (option.sprintOnly && !race.hasSprintWeekend) return;

      const exactPoints = Number(optionPoints[optionKey]?.exactPoints ?? option.defaultExactPoints);
      const partialPoints = Number(optionPoints[optionKey]?.partialPoints ?? option.defaultPartialPoints);

      if (optionKey === "racePositions") {
        const slots = raceSlots.length > 0 ? raceSlots : [1, 2, 3];
        slots.forEach((slot) => {
          categories.push({
            name: `Race Result P${slot}`,
            displayOrder: displayOrder++,
            isPositionBased: true,
            exactPoints,
            partialPoints
          });
        });
        return;
      }

      if (optionKey === "sprintPositions") {
        const slots = sprintSlots.length > 0 ? sprintSlots : [1, 2, 3];
        slots.forEach((slot) => {
          categories.push({
            name: `Sprint Result P${slot}`,
            displayOrder: displayOrder++,
            isPositionBased: true,
            exactPoints,
            partialPoints
          });
        });
        return;
      }

      if (optionKey === "raceQualificationPositions") {
        const slots = raceQualificationSlots.length > 0 ? raceQualificationSlots : [1, 2, 3];
        slots.forEach((slot) => {
          categories.push({
            name: `Race Qualification P${slot}`,
            displayOrder: displayOrder++,
            isPositionBased: true,
            exactPoints,
            partialPoints
          });
        });
        return;
      }

      if (optionKey === "sprintQualificationPositions") {
        const slots = sprintQualificationSlots.length > 0 ? sprintQualificationSlots : [1, 2, 3];
        slots.forEach((slot) => {
          categories.push({
            name: `Sprint Qualification P${slot}`,
            displayOrder: displayOrder++,
            isPositionBased: true,
            exactPoints,
            partialPoints
          });
        });
        return;
      }

      if (optionKey === "teamOfWeekend") {
        categories.push({
          name: "Team Battle Winner (Driver)",
          displayOrder: displayOrder++,
          isPositionBased: false,
          metadata: { fixedTeam: fixedTeamOfWeekend },
          exactPoints,
          partialPoints
        });
        categories.push({
          name: "Team Battle Winning Margin",
          displayOrder: displayOrder++,
          isPositionBased: false,
          metadata: { fixedTeam: fixedTeamOfWeekend },
          exactPoints,
          partialPoints
        });
        return;
      }

      if (optionKey === "driverOfWeekend") {
        driverOfWeekendScopes.forEach((scope) => {
          categories.push({
            name: `Driver of the Weekend ${getDriverOfWeekendScopeLabel(scope)} Position`,
            displayOrder: displayOrder++,
            isPositionBased: false,
            metadata: {
              fixedDriver: fixedDriverOfWeekend,
              driverOfWeekendScope: scope
            },
            exactPoints,
            partialPoints
          });
        });
        return;
      }

      const categoryName = OPTION_CATEGORY_NAMES[optionKey];
      if (!categoryName) return;
      categories.push({
        name: categoryName,
        displayOrder: displayOrder++,
        isPositionBased: ["sprintResult"].includes(optionKey),
        exactPoints,
        partialPoints
      });
    });

    try {
      await apiFetch(`/admin/races/${predictionRaceId}/categories`, {
        method: "POST",
        body: JSON.stringify({ categories })
      });
      setPredictionMessage("Prediction options saved for selected race.");
      await loadRaces();
    } catch (err) {
      setPredictionMessage(err.message);
    }
  }

  async function handleBulkFile(type, file) {
    setBulkMessage("");
    if (!file) return;

    try {
      const text = await readFileText(file);
      const isCsv = file.name.toLowerCase().endsWith(".csv");
      const parsed = isCsv ? parseCsvBulkPayload(type, text) : JSON.parse(text);

      if (!parsed) {
        setBulkMessage("Unsupported bulk file format.");
        return;
      }

      if (type === "races") {
        const response = await apiFetch("/admin/bulk/races", {
          method: "POST",
          body: JSON.stringify({ races: parsed.races || parsed })
        });
        setBulkMessage(`Races bulk upload: created ${response.created}, failed ${response.failed}.`);
      }

      if (type === "drivers") {
        const response = await apiFetch("/admin/bulk/race-drivers", {
          method: "POST",
          body: JSON.stringify({ uploads: parsed.uploads || parsed })
        });
        setBulkMessage(`Drivers bulk upload: updated ${response.updated}, failed ${response.failed}.`);
      }

      if (type === "results") {
        const response = await apiFetch("/admin/bulk/results", {
          method: "POST",
          body: JSON.stringify({ uploads: parsed.uploads || parsed })
        });
        setBulkMessage(`Results bulk upload: updated ${response.updated}, failed ${response.failed}.`);
      }

      await loadRaces();
    } catch (err) {
      setBulkMessage(err.message || "Bulk upload failed.");
    }
  }

  return (
    <div className="space-y-4 pb-24">
      <Header title="Admin Dashboard" subtitle="League, race, driver and results operations" />

      <section className="card p-2">
        <div className="flex gap-2 overflow-x-auto px-2 py-1">
          {ADMIN_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`tap whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold ${
                activeTab === tab.key
                  ? "bg-accent-cyan text-track-900"
                  : "border border-white/20 bg-white/5 text-slate-200"
              }`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {activeTab === "leagues" ? (
        <section className="card space-y-4 p-4 text-sm text-slate-200">
          <h2 className="font-display text-2xl text-accent-cyan">Leagues</h2>

          <form onSubmit={createLeague} className="space-y-2 rounded-xl border border-white/20 bg-white/5 p-3">
            <p className="font-semibold text-slate-100">Create League</p>
            <input
              className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
              placeholder="League name"
              value={createLeagueForm.name}
              onChange={(e) => setCreateLeagueForm((prev) => ({ ...prev, name: e.target.value }))}
              required
            />
            <input
              className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
              placeholder="Invite code (optional, auto-generated if blank)"
              value={createLeagueForm.inviteCode}
              onChange={(e) => setCreateLeagueForm((prev) => ({ ...prev, inviteCode: e.target.value }))}
            />
            <button className="tap rounded-xl bg-accent-red px-4 py-2 font-bold text-white">Create League</button>
          </form>

          <label className="block">
            <span className="mb-1 block font-semibold text-slate-100">Select League</span>
            <select
              className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
              value={selectedLeagueId}
              onChange={(e) => setSelectedLeagueId(e.target.value)}
            >
              <option value="" className="bg-track-900 text-slate-300">
                Select league
              </option>
              {leagues.map((league) => (
                <option key={league.id} value={league.id} className="bg-track-900 text-white">
                  {league.name} ({league.member_count} members)
                </option>
              ))}
            </select>
          </label>

          {selectedLeague ? (
            <div className="space-y-3 rounded-xl border border-white/20 bg-white/5 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-100">League Details</p>
                {editingLeagueId === selectedLeague.id ? null : (
                  <button
                    type="button"
                    className="tap rounded-xl border border-white/30 px-3 py-2 text-xs font-semibold text-slate-100"
                    onClick={() => {
                      setEditingLeagueId(selectedLeague.id);
                      setEditingLeagueForm({ name: selectedLeague.name, inviteCode: selectedLeague.invite_code });
                    }}
                  >
                    Edit League
                  </button>
                )}
              </div>

              {editingLeagueId === selectedLeague.id ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
                  <input
                    className="tap rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                    value={editingLeagueForm.name}
                    onChange={(e) => setEditingLeagueForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="League name"
                  />
                  <input
                    className="tap rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                    value={editingLeagueForm.inviteCode}
                    onChange={(e) => setEditingLeagueForm((prev) => ({ ...prev, inviteCode: e.target.value.toUpperCase() }))}
                    placeholder="Invite code"
                  />
                  <div className="flex gap-2">
                    <button type="button" className="tap rounded-xl bg-accent-cyan px-4 py-2 font-bold text-track-900" onClick={saveLeagueEdits}>
                      Save
                    </button>
                    <button
                      type="button"
                      className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-slate-100"
                      onClick={() => {
                        setEditingLeagueId(null);
                        setEditingLeagueForm({ name: "", inviteCode: "" });
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="font-semibold text-slate-100">Invite Code: {selectedLeague.invite_code}</p>
                  <p className="text-xs text-slate-400">Share this code with users so they can join the league.</p>
                </>
              )}
            </div>
          ) : null}

          <div className="space-y-2 rounded-xl border border-white/20 bg-white/5 p-3">
            <p className="font-semibold text-slate-100">League Members</p>
            {leagueMembers.length === 0 ? (
              <p className="text-slate-400">No members found.</p>
            ) : (
              leagueMembers.map((member) => (
                <div key={member.id} className="rounded-xl border border-white/20 px-3 py-2">
                  <p className="font-semibold text-slate-100">{member.name}</p>
                  <p className="text-xs text-slate-300">{member.email} | {member.role}</p>
                </div>
              ))
            )}
          </div>

          {leagueMessage ? <p className="text-accent-gold">{leagueMessage}</p> : null}
        </section>
      ) : null}

      {activeTab === "predictionOptions" ? (
        <section className="card space-y-3 p-4 text-sm text-slate-200">
          <h2 className="font-display text-2xl text-accent-cyan">Prediction Options</h2>
          <p>Choose prediction categories and points for a specific upcoming race.</p>

          <div className="rounded-xl border border-white/20 bg-white/5 p-3">
            <p className="font-semibold text-slate-100">Applied To Race (Year Scoped)</p>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
              <label className="text-xs text-slate-300">
                Year
                <select
                  className="mt-1 w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  value={predictionYear}
                  onChange={(e) => setPredictionYear(e.target.value)}
                >
                  {predictionYearOptions.map((year) => (
                    <option key={year} value={year} className="bg-track-900 text-white">
                      {year}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-slate-300">
                Future / Incomplete Race
                <select
                  className="mt-1 w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  value={predictionRaceId}
                  onChange={(e) => setPredictionRaceId(e.target.value)}
                >
                  {selectablePredictionRaces.length === 0 ? (
                    <option value="" className="bg-track-900 text-slate-300">No upcoming races for selected year</option>
                  ) : null}
                  {selectablePredictionRaces.map((raceRow) => (
                    <option key={raceRow.id} value={raceRow.id} className="bg-track-900 text-white">
                      {raceRow.name} - {new Date(raceRow.race_date).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={race.hasSprintWeekend}
              onChange={(e) => setRace({ ...race, hasSprintWeekend: e.target.checked })}
            />
            Sprint weekend
          </label>

          <div className="rounded-xl border border-white/20 bg-white/5 p-3">
            <div className="space-y-2">
              {PREDICTION_OPTIONS.map((option) => {
                const disabled = option.sprintOnly && !race.hasSprintWeekend;
                return (
                  <div key={option.key} className={`rounded-lg border border-white/10 p-2 ${disabled ? "opacity-60" : ""}`}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <label className={`flex items-start gap-2 text-sm ${disabled ? "text-slate-500" : "text-slate-200"}`}>
                        <input
                          type="checkbox"
                          checked={selectedOptions.includes(option.key)}
                          disabled={disabled}
                          onChange={() => toggleOption(option.key)}
                        />
                        {option.label}
                      </label>

                      {selectedOptions.includes(option.key) && option.key === "driverOfWeekend" ? (
                        <div className="w-full md:w-[320px]">
                          <select
                            className="w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-xs text-white"
                            value={predictionPreview.driverOfWeekend}
                            onChange={(e) =>
                              setPredictionPreview((prev) => ({ ...prev, driverOfWeekend: e.target.value }))
                            }
                          >
                            <option value="" className="bg-track-900 text-slate-300">Select fixed driver</option>
                            {availableRaceDrivers.map((driver) => (
                              <option key={`dow-${driver.name}`} value={driver.name} className="bg-track-900 text-white">
                                {driver.teamName ? `${driver.name} (${driver.teamName})` : driver.name}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-[11px] text-slate-400">Players will predict this driver's finishing position for each enabled position group.</p>
                        </div>
                      ) : null}

                      {selectedOptions.includes(option.key) && option.key === "teamOfWeekend" ? (
                        <div className="w-full md:w-[320px]">
                          <select
                            className="w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-xs text-white"
                            value={predictionPreview.teamOfWeekend}
                            onChange={(e) =>
                              setPredictionPreview((prev) => ({ ...prev, teamOfWeekend: e.target.value }))
                            }
                          >
                            <option value="" className="bg-track-900 text-slate-300">Select fixed team</option>
                            {availableRaceTeams.map((team) => (
                              <option key={`tow-${team}`} value={team} className="bg-track-900 text-white">
                                {team}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-[11px] text-slate-400">Players will only pick the team driver and the gap for this team.</p>
                        </div>
                      ) : null}

                      {selectedOptions.includes(option.key) && option.key === "racePositions" ? (
                        <input
                          className="w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-xs text-white md:w-[320px]"
                          placeholder="Race slots (example: 6,7,8)"
                          value={racePositionSlotsInput}
                          onChange={(e) => setRacePositionSlotsInput(e.target.value)}
                        />
                      ) : null}

                      {selectedOptions.includes(option.key) && option.key === "sprintPositions" ? (
                        <input
                          className="w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-xs text-white md:w-[320px]"
                          placeholder="Sprint slots (example: 1,2,3)"
                          value={sprintPositionSlotsInput}
                          onChange={(e) => setSprintPositionSlotsInput(e.target.value)}
                        />
                      ) : null}

                      {selectedOptions.includes(option.key) && option.key === "raceQualificationPositions" ? (
                        <input
                          className="w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-xs text-white md:w-[320px]"
                          placeholder="Race qualification slots (example: 1,2,3)"
                          value={raceQualificationSlotsInput}
                          onChange={(e) => setRaceQualificationSlotsInput(e.target.value)}
                        />
                      ) : null}

                      {selectedOptions.includes(option.key) && option.key === "sprintQualificationPositions" ? (
                        <input
                          className="w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-xs text-white md:w-[320px]"
                          placeholder="Sprint qualification slots (example: 1,2,3)"
                          value={sprintQualificationSlotsInput}
                          onChange={(e) => setSprintQualificationSlotsInput(e.target.value)}
                        />
                      ) : null}
                    </div>

                    {selectedOptions.includes(option.key) ? (
                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                        <label className="text-xs text-slate-300">
                          Exact points
                          <input
                            type="number"
                            min="0"
                            step="1"
                            className="mt-1 w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-white"
                            value={optionPoints[option.key]?.exactPoints ?? option.defaultExactPoints}
                            onChange={(e) => updateOptionPoints(option.key, "exactPoints", e.target.value)}
                          />
                        </label>
                        <label className="text-xs text-slate-300">
                          {[
                            "racePositions",
                            "sprintPositions",
                            "raceQualificationPositions",
                            "sprintQualificationPositions"
                          ].includes(option.key)
                            ? "Distance step (points deducted per position away)"
                            : "Partial points"}
                          <input
                            type="number"
                            min="0"
                            step="1"
                            className="mt-1 w-full rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-white"
                            value={optionPoints[option.key]?.partialPoints ?? option.defaultPartialPoints}
                            onChange={(e) => updateOptionPoints(option.key, "partialPoints", e.target.value)}
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="tap rounded-xl bg-accent-red px-4 py-2 font-bold text-white"
              onClick={savePredictionOptionsForRace}
              disabled={!predictionRaceId}
            >
              Save Prediction Options To Race
            </button>
            {predictionMessage ? <p className="text-accent-gold">{predictionMessage}</p> : null}
          </div>
        </section>
      ) : null}

      {activeTab === "createRace" ? (
        <form onSubmit={createRace} className="card space-y-3 p-4">
          <h2 className="font-display text-2xl text-accent-cyan">{editingRaceId ? "Edit Race Weekend" : "Create Race Weekend (Manual)"}</h2>
          <p className="text-xs text-slate-400">
            Prediction categories are configured in the <span className="font-semibold text-slate-200">Prediction Options</span> tab.
          </p>

          <label className="block text-sm text-slate-200">
            <span className="mb-1 block font-semibold text-accent-cyan">Manage Existing Race</span>
            <select
              className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
              value={editingRaceId}
              onChange={(e) => loadRaceEditor(e.target.value)}
            >
              <option value="" className="bg-track-900 text-slate-300">Create new race</option>
              {allRaces.map((raceRow) => (
                <option key={raceRow.id} value={raceRow.id} className="bg-track-900 text-white">
                  {raceRow.name} - {new Date(raceRow.race_date).toLocaleDateString()}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-xl border border-white/20 bg-white/5 p-3">
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={race.applyToAllLeagues}
                onChange={(e) => setRace((prev) => ({ ...prev, applyToAllLeagues: e.target.checked }))}
              />
              Add race to all leagues by default
            </label>

            {!race.applyToAllLeagues ? (
              <label className="mt-3 block text-sm text-slate-200">
                <span className="mb-1 block font-semibold text-accent-cyan">Choose Leagues</span>
                <select
                  multiple
                  className="tap min-h-[120px] w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  value={race.leagueIds}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions).map((option) => option.value);
                    setRace((prev) => ({ ...prev, leagueIds: selected, leagueId: selected[0] || "" }));
                  }}
                >
                  {leagues.map((league) => (
                    <option key={league.id} value={league.id} className="bg-track-900 text-white">
                      {league.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          <input
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            placeholder="Race Name"
            value={race.name}
            onChange={(e) => setRace({ ...race, name: e.target.value })}
            required
          />
          <input
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            placeholder="Circuit Name"
            value={race.circuitName}
            onChange={(e) => setRace({ ...race, circuitName: e.target.value })}
            required
          />
          <input
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            placeholder="External Round (optional, 1-30)"
            value={race.externalRound}
            onChange={(e) => setRace({ ...race, externalRound: e.target.value })}
          />
          <input
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            type="datetime-local"
            value={race.raceDate}
            onChange={(e) => setRace({ ...race, raceDate: e.target.value })}
            required
          />
          <input
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            type="datetime-local"
            value={race.deadlineAt}
            onChange={(e) => setRace({ ...race, deadlineAt: e.target.value })}
            required
          />

          <p className="text-xs text-slate-400">
            Drivers are managed after race creation in the <span className="font-semibold text-slate-200">Drivers</span> tab.
          </p>

          <div className="flex gap-2">
            <button className="tap rounded-xl bg-accent-red px-4 py-2 font-bold text-white">
              {editingRaceId ? "Save Race Changes" : "Create Race"}
            </button>
            {editingRaceId ? (
              <button
                type="button"
                className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-slate-100"
                onClick={() => loadRaceEditor("")}
              >
                New Race
              </button>
            ) : null}
          </div>

          <div className="space-y-2 rounded-xl border border-white/20 bg-white/5 p-3 text-sm text-slate-200">
            <p className="font-semibold text-slate-100">Bulk Races Upload (JSON or CSV)</p>
            <input
              type="file"
              accept="application/json,.csv,text/csv"
              onChange={(e) => handleBulkFile("races", e.target.files?.[0])}
            />
            <pre className="overflow-x-auto rounded bg-track-900/70 p-2 text-xs text-slate-300">{`# races.csv
leagueId,leagueIds,applyToAllLeagues,name,circuitName,externalRound,raceDate,deadlineAt,hasSprintWeekend,predictionOptions,racePositionSlots,sprintPositionSlots,raceQualificationSlots,sprintQualificationSlots,drivers
,"",true,Australian Grand Prix,Albert Park,1,2026-03-15T04:00:00Z,2026-03-14T03:00:00Z,true,"raceQualificationPositions;racePositions;sprintPositions;fastestLapDriver","6;7;8","1;2;3","1;2;3","1;2;3","Lando Norris|McLaren;Charles Leclerc|Ferrari"`}</pre>
          </div>

          {message ? <p className="text-accent-gold">{message}</p> : null}
          {bulkMessage ? <p className="text-accent-gold">{bulkMessage}</p> : null}
        </form>
      ) : null}

      {activeTab === "drivers" ? (
        <section className="card space-y-3 p-4 text-sm text-slate-200">
          <h2 className="font-display text-2xl text-accent-cyan">Manage Drivers</h2>
          <label className="block text-sm text-slate-200">
            <span className="mb-1 block font-semibold text-accent-cyan">Year</span>
            <select
              className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
              value={driverYear}
              onChange={(e) => setDriverYear(e.target.value)}
            >
              {predictionYearOptions.map((year) => (
                <option key={`driver-year-${year}`} value={String(year)} className="bg-track-900 text-white">
                  {year}
                </option>
              ))}
            </select>
          </label>
          <select
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            value={selectedDriverRaceId}
            onChange={(e) => setSelectedDriverRaceId(e.target.value)}
          >
            {selectableDriverRaces.map((raceRow) => (
              <option key={raceRow.id} value={raceRow.id} className="bg-track-900 text-white">
                {raceRow.name} - {new Date(raceRow.race_date).toLocaleDateString()}
              </option>
            ))}
          </select>
          {selectableDriverRaces.length === 0 ? <p className="text-xs text-slate-400">No races found for the selected year.</p> : null}

          <div className="space-y-2">
            {driverRows.map((driver, index) => (
              <div key={`${index}-${driver.name}`} className="grid grid-cols-1 gap-2 rounded-xl border border-white/20 p-3 md:grid-cols-[1fr_1fr_auto]">
                <input
                  className="tap rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  placeholder="Driver name"
                  value={driver.name}
                  onChange={(e) => updateDriverRow(index, "name", e.target.value)}
                />
                <input
                  className="tap rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
                  placeholder="Team"
                  value={driver.teamName}
                  onChange={(e) => updateDriverRow(index, "teamName", e.target.value)}
                />
                <button
                  type="button"
                  className="tap rounded-xl border border-red-400/60 px-3 py-2 text-red-200"
                  onClick={() => removeDriverRow(index)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button type="button" className="tap rounded-xl border border-white/30 px-3 py-2" onClick={addDriverRow}>
              Add Driver
            </button>
            <button type="button" className="tap rounded-xl bg-accent-cyan px-4 py-2 font-bold text-track-900" onClick={saveRaceDrivers}>
              Save Drivers
            </button>
          </div>

          <div className="space-y-2 rounded-xl border border-white/20 bg-white/5 p-3">
            <p className="font-semibold text-slate-100">Bulk Drivers Upload (JSON or CSV)</p>
            <input
              type="file"
              accept="application/json,.csv,text/csv"
              onChange={(e) => handleBulkFile("drivers", e.target.files?.[0])}
            />
            <pre className="overflow-x-auto rounded bg-track-900/70 p-2 text-xs text-slate-300">{`# drivers.csv
raceId,driverName,teamName
<race-uuid>,Max Verstappen,Red Bull
<race-uuid>,Charles Leclerc,Ferrari`}</pre>
          </div>

          {driverMessage ? <p className="text-accent-gold">{driverMessage}</p> : null}
          {bulkMessage ? <p className="text-accent-gold">{bulkMessage}</p> : null}
        </section>
      ) : null}

      {activeTab === "sync" ? (
        <section className="card space-y-3 p-4 text-sm text-slate-200">
          <h2 className="font-display text-2xl text-accent-cyan">Sync From Jolpica API</h2>
          <p>Race calendar and drivers can be pulled automatically by season.</p>
          {syncStatus ? (
            <div className="rounded-xl border border-white/20 bg-white/5 p-3 text-xs text-slate-300">
              <p className="font-semibold text-slate-100">Scheduled Sync Status</p>
              <p className="mt-1">Enabled: {syncStatus.runtime?.enabled ? "Yes" : "No"}</p>
              <p>Running: {syncStatus.runtime?.isRunning || syncStatus.persisted?.isRunning ? "Yes" : "No"}</p>
              <p>Interval: {Math.round((syncStatus.runtime?.intervalMs || 0) / 60000)} minutes</p>
              <p>Configured season: {syncStatus.runtime?.configuredSeason || "-"}</p>
              <p className="mt-2">Last mode: {syncStatus.persisted?.lastMode || "-"}</p>
              <p>Last started: {syncStatus.persisted?.lastRunStartedAt ? new Date(syncStatus.persisted.lastRunStartedAt).toLocaleString() : "-"}</p>
              <p>Last finished: {syncStatus.persisted?.lastRunFinishedAt ? new Date(syncStatus.persisted.lastRunFinishedAt).toLocaleString() : "-"}</p>
              <p>Last success: {syncStatus.persisted?.lastSuccessAt ? new Date(syncStatus.persisted.lastSuccessAt).toLocaleString() : "-"}</p>
              <p>Last error: {syncStatus.persisted?.lastErrorAt ? new Date(syncStatus.persisted.lastErrorAt).toLocaleString() : "-"}</p>
              {syncStatus.persisted?.lastErrorMessage ? (
                <p className="mt-1 text-red-300">Error: {syncStatus.persisted.lastErrorMessage}</p>
              ) : null}
              {syncStatus.persisted?.summary ? (
                <pre className="mt-2 overflow-x-auto rounded bg-track-900/70 p-2 text-[11px] text-slate-300">{JSON.stringify(syncStatus.persisted.summary, null, 2)}</pre>
              ) : null}
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={race.applyToAllLeagues}
              onChange={(e) => setRace((prev) => ({ ...prev, applyToAllLeagues: e.target.checked }))}
            />
            Sync races to all leagues
          </label>
          <select
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            value={race.leagueId}
            disabled={race.applyToAllLeagues}
            onChange={(e) => setRace((prev) => ({ ...prev, leagueId: e.target.value }))}
          >
            <option value="" className="bg-track-900 text-slate-300">Select league</option>
            {leagues.map((league) => (
              <option key={league.id} value={league.id} className="bg-track-900 text-white">{league.name}</option>
            ))}
          </select>
          <input
            className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white"
            placeholder="Season (example: 2026)"
            value={syncSeason}
            onChange={(e) => setSyncSeason(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="tap rounded-xl bg-accent-cyan px-4 py-2 font-bold text-track-900" onClick={refreshFromJolpica}>
              Sync Races + Drivers
            </button>
            <button type="button" className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-slate-100" onClick={syncLatestResults}>
              Sync Latest Results
            </button>
            <button type="button" className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-slate-100" onClick={syncCompletedResults}>
              Sync Completed Results
            </button>
            <button type="button" className="tap rounded-xl border border-white/30 px-4 py-2 font-bold text-slate-100" onClick={loadSyncStatus}>
              Refresh Status
            </button>
          </div>
          {syncMessage ? <p className="text-accent-gold">{syncMessage}</p> : null}
        </section>
      ) : null}

      {activeTab === "results" ? (
        <section className="card space-y-3 p-4 text-sm text-slate-200">
          <h2 className="font-display text-2xl text-accent-cyan">Results</h2>
          <p className="mt-2">API can pull latest results. You can always override manually race-by-race.</p>
          <Link
            href="/admin/results"
            className="tap mt-3 inline-block rounded-xl bg-accent-cyan px-4 py-2 font-bold text-track-900"
          >
            Open Manual Results Editor
          </Link>

          <div className="space-y-2 rounded-xl border border-white/20 bg-white/5 p-3">
            <p className="font-semibold text-slate-100">Bulk Results Upload (JSON or CSV)</p>
            <input
              type="file"
              accept="application/json,.csv,text/csv"
              onChange={(e) => handleBulkFile("results", e.target.files?.[0])}
            />
            <pre className="overflow-x-auto rounded bg-track-900/70 p-2 text-xs text-slate-300">{`# results.csv
raceId,tieBreakerValue,categoryName,valueText,valueNumber
<race-uuid>,1:31:44.000,Race Result P1,Lando Norris,
<race-uuid>,1:31:44.000,Fastest Lap Driver,Charles Leclerc,`}</pre>
          </div>

          {bulkMessage ? <p className="text-accent-gold">{bulkMessage}</p> : null}
        </section>
      ) : null}

      {activeTab === "visibility" ? (
        <section className="card p-4 text-sm text-slate-200">
          <h2 className="font-display text-2xl text-accent-cyan">Race Visibility</h2>
          <p className="mt-2 text-slate-300">Hide or show races for players. Hidden races remain visible to admins.</p>
          <div className="mt-3 space-y-2">
            {allRaces.map((raceRow) => (
              <div key={raceRow.id} className="flex items-center justify-between rounded-xl border border-white/20 px-3 py-2">
                <div>
                  <p className="font-semibold text-slate-100">{raceRow.name}</p>
                  <p className="text-xs text-slate-400">{new Date(raceRow.deadline_at).toLocaleString()}</p>
                </div>
                <button
                  type="button"
                  className={`tap rounded-xl px-3 py-1 text-xs font-bold ${
                    raceRow.is_visible ? "bg-accent-cyan text-track-900" : "bg-slate-600 text-white"
                  }`}
                  onClick={() => setRaceVisibility(raceRow.id, !raceRow.is_visible)}
                >
                  {raceRow.is_visible ? "Hide" : "Show"}
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "settings" ? (
        <section className="card space-y-3 p-4 text-sm text-slate-200">
          <h2 className="font-display text-2xl text-accent-cyan">Settings</h2>
          <form onSubmit={savePickLockMinutes} className="space-y-3 rounded-xl border border-white/20 bg-white/5 p-3">
            <p className="font-semibold text-slate-100">Pick Lock Window (minutes before deadline)</p>
            <input
              type="number"
              min="0"
              max="180"
              step="1"
              className="tap w-full rounded-xl border border-white/30 bg-white/10 px-3 py-2 text-white"
              value={lockMinutesInput}
              onChange={(e) => setLockMinutesInput(e.target.value)}
              required
            />
            <button type="submit" className="tap rounded-xl bg-accent-cyan px-4 py-2 font-bold text-track-900">
              Save Lock Window
            </button>
            {lockMessage ? <p className="text-accent-gold">{lockMessage}</p> : null}
          </form>
        </section>
      ) : null}

      {activeTab === "users" ? (
        <section className="card p-4 text-sm text-slate-200">
          <h2 className="font-display text-2xl text-accent-cyan">Users</h2>
          <p className="mt-2 text-slate-300">List of registered users. Click edit to change name or email.</p>
          {message && <p className="text-accent-gold">{message}</p>}
          <div className="mt-3 overflow-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Email</th>
                  <th className="pb-2">Role</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="py-2">{editingUserId === u.id ? (
                      <input className="border p-1 w-48" value={editingUserForm.name} onChange={(e) => setEditingUserForm((s) => ({ ...s, name: e.target.value }))} />
                    ) : u.name}</td>
                    <td className="py-2">{editingUserId === u.id ? (
                      <input className="border p-1 w-64" value={editingUserForm.email} onChange={(e) => setEditingUserForm((s) => ({ ...s, email: e.target.value }))} />
                    ) : u.email}</td>
                    <td className="py-2">{u.role}</td>
                    <td className="py-2">
                      {editingUserId === u.id ? (
                        <>
                          <button type="button" className="mr-2 tap rounded bg-accent-cyan px-2 py-1 text-sm" onClick={async () => {
                            try {
                              const payload = { name: editingUserForm.name, email: editingUserForm.email };
                              const updated = await apiFetch(`/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify(payload) });
                              setUsers((prev) => prev.map((row) => (row.id === u.id ? updated : row)));
                              setEditingUserId(null);
                              setEditingUserForm({ name: "", email: "" });
                              setMessage("User updated");
                            } catch (err) {
                              setMessage(String(err.message || err));
                            }
                          }}>Save</button>
                          <button type="button" className="tap rounded px-2 py-1 text-sm" onClick={() => { setEditingUserId(null); setEditingUserForm({ name: "", email: "" }); }}>Cancel</button>
                        </>
                      ) : (
                        <button type="button" className="tap rounded px-2 py-1 text-sm" onClick={() => { setEditingUserId(u.id); setEditingUserForm({ name: u.name, email: u.email }); }}>Edit</button>
                      )}
                      <select
                        className="ml-2 rounded border border-white/30 bg-white/10 px-2 py-1 text-sm text-white"
                        value={u.role}
                        onChange={(e) => updateUserRole(u.id, e.target.value)}
                      >
                        <option value="player" className="bg-track-900 text-white">player</option>
                        <option value="admin" className="bg-track-900 text-white">admin</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <BottomNav />
    </div>
  );
}
