import { request, type User } from "./api";

/** An account as the admin pages see it. */
export interface ManagedSpeaker extends User {
  expiresAt: string | null;
  expired: boolean;
  createdByAdmin: boolean;
  speakRequestNote: string | null;
}

/** Admin-only calls. */
export const adminApi = {
  /** With `q` (2+ characters): search every account by username, email or name. */
  speakers: (q?: string) =>
    request<{ speakers: ManagedSpeaker[] }>("GET", `/api/admin/speakers${q && q.trim().length >= 2 ? `?q=${encodeURIComponent(q.trim())}` : ""}`),
  updateSpeaker: (id: string, patch: { canSpeak?: boolean; isAdmin?: boolean }) =>
    request<{ speaker: ManagedSpeaker }>("PATCH", `/api/admin/speakers/${encodeURIComponent(id)}`, patch),
  /** Permanently delete an account (not admins or yourself). */
  deleteSpeaker: (id: string) => request<void>("DELETE", `/api/admin/speakers/${encodeURIComponent(id)}`),
  /** Guest accounts: new password + a few hours of access; the previous user is signed out. */
  resetGuest: (id: string) =>
    request<{ speaker: ManagedSpeaker; password: string; expiresAt: string }>("POST", `/api/admin/speakers/${encodeURIComponent(id)}/reset`, {}),
};
