import { API_URL } from "./config";

export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
  /** Speaking (broadcasting) is by approval; listening is open to everyone. */
  canSpeak: boolean;
  /** May open the admin pages (Usage, approvals, speakers). */
  isAdmin?: boolean;
  /** The main admin: the only one who can make or remove admins. */
  isOwner?: boolean;
  /** A shared guest account (reset by an admin for a few hours at a time). */
  isGuest?: boolean;
  /** When the account stops working, or null. */
  expiresAt?: string | null;
  /** When the user asked for speaking access; null if they haven't (or already have it). */
  speakRequestedAt: string | null;
  createdAt: string;
}
export interface SpeakerInfo {
  username: string;
  displayName: string;
  live: boolean;
  reconnecting: boolean;
  listeners: number;
  title: string | null;
  private: boolean;
}
export interface Summary {
  title: string;
  overview: string;
  key_points: string[];
  decisions: string[];
  action_items: { task: string; owner: string | null }[];
  language: string;
  createdAt: string;
}
export interface SessionInfo {
  id: string;
  title: string | null;
  sourceLang: string;
  startedAt: string;
  endedAt: string | null;
  peakListeners: number;
  isPrivate: boolean;
  translationMode: string;
  charsTranslated: number;
  /** Listeners who attended can reopen this session from "My sessions". */
  allowRevisit: boolean;
  /** The server is writing this session's AI summary right now (e.g. automatically after it ended). */
  summaryPending?: boolean;
  /** "reviewing" until the speaker publishes the final translation for readers. */
  reviewStatus?: "reviewing" | "published";
}
export interface SessionSummary extends SessionInfo {
  segmentCount: number;
  hasSummary: boolean;
}
/** A session in a listener's library ("My sessions"). */
export interface LibraryItem {
  id: string;
  title: string | null;
  sourceLang: string;
  startedAt: string;
  endedAt: string | null;
  /** The language this listener read the session in. */
  lang: string;
  speaker: { username: string; displayName: string };
  segmentCount: number;
  hasSummary: boolean;
  /** "reviewing": the speaker is still checking it; the transcript appears once published. */
  reviewStatus?: "reviewing" | "published";
}
export interface UsageReport {
  month: string;
  active: string | null;
  liveMode: boolean;
  listenLanguages: string;
  providers: { name: string; label: string; used: number; limit: number; allowance: number }[];
  history: { month: string; provider: string; chars: number; calls: number }[];
}
export interface LibrarySegment {
  seq: number;
  original: string;
  translation: string | null;
  translationLang: string;
  /** Token for the natural read-aloud voice (/api/tts); absent when the server has it turned off. */
  tts?: string;
}
export interface TranscriptSegment {
  seq: number;
  original: string;
  translations: Record<string, string>;
  createdAt: string;
}
export interface ServerConfig {
  appName: string;
  /** `liveMode: false` means the server has switched the "Live" translation mode off. */
  features: { googleSignIn: boolean; email: boolean; summaries: boolean; tts?: boolean; liveMode?: boolean };
  /** Languages the server offers; `target` is the listening languages that are currently switched on. */
  languages?: { target: { code: string }[]; defaultTarget: string };
}
export type AuthResult = { token: string; user: User };
export type GoogleResult =
  | AuthResult
  | { needsProfile: true; signupToken: string; profile: { email: string; displayName: string; suggestedUsername: string } };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

let authToken: string | null = null;
/** Called when the server rejects the saved sign-in (expired account, guest reset): the app signs out. */
let onSignedOut: (() => void) | null = null;
export const setSignedOutHandler = (fn: (() => void) | null) => {
  onSignedOut = fn;
};
export const setApiToken = (token: string | null) => {
  authToken = token;
};

/** UI language, sent as Accept-Language so the server returns error messages in it. */
let apiLanguage = "en";
export const setApiLanguage = (lang: string) => {
  apiLanguage = lang;
};
const OFFLINE: Record<string, string> = {
  en: "Can't reach the server. Check your connection and try again.",
  ar: "تعذّر الوصول إلى الخادم. تحقق من اتصالك وحاول مرة أخرى.",
};

const MAINTENANCE: Record<string, string> = {
  en: "LisanCast is under maintenance right now. Please try again in a little while.",
  ar: "لسان كاست قيد الصيانة الآن. يرجى المحاولة مرة أخرى بعد قليل.",
};

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        "Accept-Language": apiLanguage,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(OFFLINE[apiLanguage] ?? OFFLINE.en, 0);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  // Maintenance mode (deploy/maintenance.sh): the server answers 503 with { maintenance: true }.
  if (res.status === 503 && data.maintenance) throw new ApiError(MAINTENANCE[apiLanguage] ?? MAINTENANCE.en, 503);
  // A signed-in request rejected as "not signed in": the account expired or was reset; sign out everywhere in the app.
  if (res.status === 401 && authToken) onSignedOut?.();
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  config: () => request<ServerConfig>("GET", "/api/config"),

  register: (input: { username: string; email: string; displayName: string; password: string }) =>
    request<AuthResult>("POST", "/api/auth/register", input),
  login: (login: string, password: string) => request<AuthResult>("POST", "/api/auth/login", { login, password }),
  google: (idToken: string) => request<GoogleResult>("POST", "/api/auth/google", { idToken }),
  googleComplete: (input: { signupToken: string; username: string; displayName: string }) =>
    request<AuthResult>("POST", "/api/auth/google/complete", input),
  sendVerification: () => request<{ ok: true }>("POST", "/api/auth/verify-email/send", {}),
  verifyEmail: (code: string) => request<{ user: User }>("POST", "/api/auth/verify-email", { code }),
  forgotPassword: (email: string) => request<{ ok: true }>("POST", "/api/auth/password/forgot", { email }),
  resetPassword: (input: { email: string; code: string; password: string }) =>
    request<AuthResult>("POST", "/api/auth/password/reset", input),
  me: () => request<{ user: User }>("GET", "/api/auth/me"),
  requestSpeaking: (note: string) => request<{ user: User }>("POST", "/api/auth/speaking-request", { note }),
  updateMe: (displayName: string) => request<{ user: User }>("PATCH", "/api/auth/me", { displayName }),
  deleteAccount: (confirm: { password?: string; confirmUsername?: string }) => request<void>("DELETE", "/api/auth/me", confirm),

  speaker: (username: string) => request<SpeakerInfo>("GET", `/api/speakers/${enc(username.replace(/^@/, "").trim())}`),
  sessions: () => request<{ sessions: SessionSummary[] }>("GET", "/api/sessions"),
  session: (id: string) =>
    request<{ session: SessionInfo & { summary: Summary | null }; segments: TranscriptSegment[] }>("GET", `/api/sessions/${enc(id)}`),
  /** The speaker has finished reviewing: readers can see it, and signed-in readers are emailed. */
  publishSession: (id: string) =>
    request<{ session: SessionInfo & { summary: Summary | null }; notified: number }>("POST", `/api/sessions/${enc(id)}/publish`, {}),
  /** Translation usage for the private Usage page (account owner only). */
  usage: () => request<UsageReport>("GET", "/api/admin/usage"),
  summarize: (id: string, lang: string) => request<{ summary: Summary }>("POST", `/api/sessions/${enc(id)}/summary`, { lang }),
  /** Correct one line of a finished session (its original wording and/or its translation). */
  editSegment: (id: string, seq: number, edit: { original?: string; translation?: string; lang?: string }) =>
    request<{ segment: TranscriptSegment }>("PATCH", `/api/sessions/${enc(id)}/segments/${seq}`, edit),
  /** A fresh translation of corrected wording, for review before saving (nothing is saved). */
  retranslate: (id: string, text: string, lang?: string) =>
    request<{ translation: string }>("POST", `/api/sessions/${enc(id)}/retranslate`, { text, lang }),
  updateSession: (id: string, patch: { allowRevisit: boolean }) =>
    request<{ session: SessionInfo }>("PATCH", `/api/sessions/${enc(id)}`, patch),
  deleteSession: (id: string) => request<void>("DELETE", `/api/sessions/${enc(id)}`),

  library: () => request<{ sessions: LibraryItem[] }>("GET", "/api/library"),
  librarySession: (id: string) =>
    request<{ session: LibraryItem & { summary: Summary | null }; segments: LibrarySegment[] }>("GET", `/api/library/${enc(id)}`),
  /** Add a session followed before signing in. */
  claimLibrarySession: (sessionId: string, lang: string) => request<void>("POST", "/api/library", { sessionId, lang }),
  removeFromLibrary: (id: string) => request<void>("DELETE", `/api/library/${enc(id)}`),
};
