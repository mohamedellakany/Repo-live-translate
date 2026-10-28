import { API_URL } from "./config";

export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
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
}
export interface SessionSummary extends SessionInfo {
  segmentCount: number;
  hasSummary: boolean;
}
export interface TranscriptSegment {
  seq: number;
  original: string;
  translations: Record<string, string>;
  createdAt: string;
}
export interface ServerConfig {
  appName: string;
  features: { googleSignIn: boolean; email: boolean; summaries: boolean };
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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
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
  updateMe: (displayName: string) => request<{ user: User }>("PATCH", "/api/auth/me", { displayName }),
  deleteAccount: (confirm: { password?: string; confirmUsername?: string }) => request<void>("DELETE", "/api/auth/me", confirm),

  speaker: (username: string) => request<SpeakerInfo>("GET", `/api/speakers/${enc(username.replace(/^@/, "").trim())}`),
  sessions: () => request<{ sessions: SessionSummary[] }>("GET", "/api/sessions"),
  session: (id: string) =>
    request<{ session: SessionInfo & { summary: Summary | null }; segments: TranscriptSegment[] }>("GET", `/api/sessions/${enc(id)}`),
  summarize: (id: string, lang: string) => request<{ summary: Summary }>("POST", `/api/sessions/${enc(id)}/summary`, { lang }),
  deleteSession: (id: string) => request<void>("DELETE", `/api/sessions/${enc(id)}`),
};
