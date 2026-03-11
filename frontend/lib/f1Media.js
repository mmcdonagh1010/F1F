function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function initials(value) {
  const parts = String(value || "")
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "F1";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

const DEFAULT_VISUAL = {
  primary: "#0f172a",
  secondary: "#1e293b",
  accent: "#22d3ee",
  line: "rgba(255,255,255,0.12)",
  glow: "rgba(34,211,238,0.32)"
};

const TEAM_VISUALS = {
  alpine: { primary: "#0f172a", secondary: "#1d4ed8", accent: "#38bdf8", line: "rgba(56,189,248,0.25)", glow: "rgba(56,189,248,0.28)" },
  aston_martin: { primary: "#052e2b", secondary: "#0f766e", accent: "#5eead4", line: "rgba(94,234,212,0.2)", glow: "rgba(94,234,212,0.24)" },
  audi: { primary: "#111827", secondary: "#991b1b", accent: "#f87171", line: "rgba(248,113,113,0.22)", glow: "rgba(248,113,113,0.28)" },
  cadillac: { primary: "#172554", secondary: "#1d4ed8", accent: "#fde68a", line: "rgba(253,230,138,0.22)", glow: "rgba(253,230,138,0.26)" },
  ferrari: { primary: "#450a0a", secondary: "#dc2626", accent: "#fbbf24", line: "rgba(251,191,36,0.2)", glow: "rgba(251,191,36,0.24)" },
  haas: { primary: "#111827", secondary: "#6b7280", accent: "#ef4444", line: "rgba(239,68,68,0.2)", glow: "rgba(239,68,68,0.24)" },
  mclaren: { primary: "#431407", secondary: "#f97316", accent: "#fdba74", line: "rgba(253,186,116,0.22)", glow: "rgba(253,186,116,0.28)" },
  mercedes: { primary: "#0f172a", secondary: "#134e4a", accent: "#2dd4bf", line: "rgba(45,212,191,0.22)", glow: "rgba(45,212,191,0.28)" },
  rb: { primary: "#172554", secondary: "#1d4ed8", accent: "#93c5fd", line: "rgba(147,197,253,0.22)", glow: "rgba(147,197,253,0.26)" },
  red_bull: { primary: "#1e1b4b", secondary: "#1d4ed8", accent: "#f59e0b", line: "rgba(245,158,11,0.24)", glow: "rgba(245,158,11,0.3)" },
  sauber: { primary: "#14532d", secondary: "#65a30d", accent: "#bef264", line: "rgba(190,242,100,0.22)", glow: "rgba(190,242,100,0.28)" },
  williams: { primary: "#082f49", secondary: "#0284c7", accent: "#7dd3fc", line: "rgba(125,211,252,0.22)", glow: "rgba(125,211,252,0.28)" }
};

const CIRCUIT_VISUALS = {
  albert_park: { primary: "#0c4a6e", secondary: "#164e63", accent: "#67e8f9" },
  bahrain: { primary: "#451a03", secondary: "#92400e", accent: "#fbbf24" },
  catalunya: { primary: "#7f1d1d", secondary: "#1d4ed8", accent: "#fde68a" },
  hungaroring: { primary: "#7c2d12", secondary: "#ea580c", accent: "#fdba74" },
  imola: { primary: "#14532d", secondary: "#1d4ed8", accent: "#86efac" },
  interlagos: { primary: "#14532d", secondary: "#ca8a04", accent: "#86efac" },
  jeddah: { primary: "#0f172a", secondary: "#0369a1", accent: "#22d3ee" },
  las_vegas: { primary: "#3b0764", secondary: "#7e22ce", accent: "#f0abfc" },
  marina_bay: { primary: "#312e81", secondary: "#7c3aed", accent: "#c4b5fd" },
  miami: { primary: "#0f766e", secondary: "#0891b2", accent: "#67e8f9" },
  monaco: { primary: "#7f1d1d", secondary: "#b91c1c", accent: "#fca5a5" },
  monza: { primary: "#14532d", secondary: "#b91c1c", accent: "#fef08a" },
  red_bull_ring: { primary: "#1e1b4b", secondary: "#1d4ed8", accent: "#f59e0b" },
  shanghai: { primary: "#0f172a", secondary: "#1d4ed8", accent: "#22d3ee" },
  silverstone: { primary: "#111827", secondary: "#1d4ed8", accent: "#ef4444" },
  spa: { primary: "#1f2937", secondary: "#0f766e", accent: "#f97316" },
  suzuka: { primary: "#1f2937", secondary: "#be123c", accent: "#fda4af" },
  villeneuve: { primary: "#1e3a8a", secondary: "#dc2626", accent: "#fef08a" },
  yas_marina: { primary: "#0f172a", secondary: "#0f766e", accent: "#5eead4" }
};

const NATIONALITY_VISUALS = {
  american: { primary: "#1e3a8a", secondary: "#b91c1c", accent: "#f8fafc" },
  argentine: { primary: "#0c4a6e", secondary: "#38bdf8", accent: "#f8fafc" },
  australian: { primary: "#052e16", secondary: "#1d4ed8", accent: "#fbbf24" },
  austrian: { primary: "#7f1d1d", secondary: "#dc2626", accent: "#f8fafc" },
  brazilian: { primary: "#14532d", secondary: "#ca8a04", accent: "#f8fafc" },
  british: { primary: "#1e3a8a", secondary: "#7f1d1d", accent: "#f8fafc" },
  canadian: { primary: "#7f1d1d", secondary: "#dc2626", accent: "#f8fafc" },
  dutch: { primary: "#7c2d12", secondary: "#f97316", accent: "#f8fafc" },
  finnish: { primary: "#0c4a6e", secondary: "#1d4ed8", accent: "#f8fafc" },
  french: { primary: "#1d4ed8", secondary: "#7f1d1d", accent: "#f8fafc" },
  german: { primary: "#111827", secondary: "#b91c1c", accent: "#fbbf24" },
  italian: { primary: "#14532d", secondary: "#b91c1c", accent: "#f8fafc" },
  japanese: { primary: "#f8fafc", secondary: "#b91c1c", accent: "#111827", line: "rgba(15,23,42,0.12)", glow: "rgba(185,28,28,0.18)" },
  monegasque: { primary: "#b91c1c", secondary: "#f8fafc", accent: "#111827", line: "rgba(15,23,42,0.12)", glow: "rgba(185,28,28,0.18)" },
  new_zealander: { primary: "#111827", secondary: "#1d4ed8", accent: "#ef4444" },
  spanish: { primary: "#7f1d1d", secondary: "#ca8a04", accent: "#fef08a" },
  thai: { primary: "#1d4ed8", secondary: "#b91c1c", accent: "#f8fafc" }
};

function getPalette(sourceMap, key) {
  return sourceMap[key] || DEFAULT_VISUAL;
}

function buildVisualDataUri({ title, subtitle, mark, palette }) {
  const colors = { ...DEFAULT_VISUAL, ...(palette || {}) };
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" role="img" aria-label="${escapeXml(title)}">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="${colors.primary}" />
          <stop offset="100%" stop-color="${colors.secondary}" />
        </linearGradient>
        <radialGradient id="glow" cx="85%" cy="20%" r="60%">
          <stop offset="0%" stop-color="${colors.glow}" />
          <stop offset="100%" stop-color="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      <rect width="1200" height="675" fill="url(#bg)" rx="40" />
      <rect width="1200" height="675" fill="url(#glow)" rx="40" />
      <g opacity="0.55">
        <path d="M0 520 L1200 180" stroke="${colors.line}" stroke-width="16" />
        <path d="M0 610 L1200 270" stroke="${colors.line}" stroke-width="8" />
        <path d="M140 0 L820 675" stroke="${colors.line}" stroke-width="10" />
      </g>
      <circle cx="1020" cy="120" r="110" fill="${colors.accent}" opacity="0.12" />
      <text x="84" y="132" font-size="40" font-family="ui-sans-serif, system-ui, sans-serif" fill="rgba(255,255,255,0.78)" letter-spacing="8">TURN1CARNAGE</text>
      <text x="80" y="420" font-size="110" font-weight="800" font-family="ui-sans-serif, system-ui, sans-serif" fill="white">${escapeXml(title)}</text>
      <text x="84" y="490" font-size="42" font-family="ui-sans-serif, system-ui, sans-serif" fill="rgba(255,255,255,0.84)">${escapeXml(subtitle)}</text>
      <text x="1110" y="610" text-anchor="end" font-size="220" font-weight="800" font-family="ui-sans-serif, system-ui, sans-serif" fill="rgba(255,255,255,0.14)">${escapeXml(mark)}</text>
      <rect x="82" y="560" width="200" height="12" rx="6" fill="${colors.accent}" />
    </svg>`;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function teamIdentity(team) {
  if (!team) return { id: "", name: "Unknown Team" };
  if (typeof team === "string") return { id: slugify(team), name: team };

  return {
    id: team.id || team.constructorId || slugify(team.name),
    name: team.name || team.constructorName || "Unknown Team"
  };
}

function circuitIdentity(circuit) {
  if (!circuit) return { id: "", name: "Unknown Circuit", subtitle: "Circuit" };
  if (typeof circuit === "string") return { id: slugify(circuit), name: circuit, subtitle: "Circuit" };

  const locality = circuit.locality || circuit.Location?.locality;
  const country = circuit.country || circuit.Location?.country;

  return {
    id: circuit.circuitId || slugify(circuit.circuitName || circuit.name),
    name: circuit.circuitName || circuit.name || "Unknown Circuit",
    subtitle: [locality, country].filter(Boolean).join(", ") || "Circuit"
  };
}

export function getRaceVisualKey(race) {
  if (!race || typeof race !== "object") return "";
  const season = String(race.season || "").trim();
  const round = String(race.round || "").trim();
  if (season && round) return `${season}_${round}`;
  return slugify(`${race.name || ""} ${race.circuitName || ""}`);
}

function driverIdentity(driver) {
  if (!driver) return { id: "", name: "Unknown Driver", code: "F1", nationality: "" };
  if (typeof driver === "string") return { id: slugify(driver), name: driver, code: initials(driver), nationality: "" };

  const fullName = driver.fullName || `${driver.givenName || ""} ${driver.familyName || ""}`.trim() || driver.name || "Unknown Driver";

  return {
    id: driver.id || driver.driverId || slugify(fullName),
    name: fullName,
    code: driver.code || initials(fullName),
    nationality: driver.nationality || ""
  };
}

export function getTeamVisual(team) {
  const identity = teamIdentity(team);
  const palette = getPalette(TEAM_VISUALS, identity.id);

  return {
    src: buildVisualDataUri({
      title: identity.name,
      subtitle: "Constructor",
      mark: initials(identity.name),
      palette
    }),
    alt: `${identity.name} visual`,
    palette
  };
}

export function getCircuitVisual(circuit) {
  const identity = circuitIdentity(circuit);
  const palette = getPalette(CIRCUIT_VISUALS, identity.id);

  return {
    src: buildVisualDataUri({
      title: identity.name,
      subtitle: identity.subtitle,
      mark: initials(identity.name),
      palette
    }),
    alt: `${identity.name} circuit visual`,
    palette
  };
}

export function getDriverVisual(driver, team) {
  const identity = driverIdentity(driver);
  const teamInfo = teamIdentity(team);
  const nationalityKey = slugify(identity.nationality);
  const palette = teamInfo.id ? getPalette(TEAM_VISUALS, teamInfo.id) : getPalette(NATIONALITY_VISUALS, nationalityKey);

  return {
    src: buildVisualDataUri({
      title: identity.name,
      subtitle: teamInfo.id ? teamInfo.name : identity.nationality || "Driver",
      mark: identity.code,
      palette
    }),
    alt: `${identity.name} visual`,
    palette
  };
}

export function resolveVisualOverride(visual, overrideEntry) {
  if (!overrideEntry?.imageUrl) return visual;

  return {
    ...visual,
    src: overrideEntry.imageUrl,
    alt: overrideEntry.alt || overrideEntry.label || visual.alt
  };
}