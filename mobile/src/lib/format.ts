export const formatDuration = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** SQLite returns "YYYY-MM-DD HH:MM:SS" in UTC. */
export const parseDbDate = (s: string) => new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);

export const formatDateTime = (s: string) =>
  parseDbDate(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Fallback name for an untitled session, e.g. "Tuesday, October 28, 2026". */
export const formatSessionDate = (s: string, locale?: string) =>
  parseDbDate(s).toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

export const formatTime = (s: string, locale?: string) => parseDbDate(s).toLocaleTimeString(locale, { timeStyle: "short" });

export const normalizeUsername = (s: string) => s.trim().replace(/^@/, "").toLowerCase();

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
