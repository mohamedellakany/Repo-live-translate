import { request, type User } from "./api";

/** A speaker account as the admin page sees it. */
export interface ManagedSpeaker extends User {
  expiresAt: string | null;
  expired: boolean;
  createdByAdmin: boolean;
  speakRequestNote: string | null;
}

/** Admin-only calls (ADMIN_USERNAMES on the server). */
export const adminApi = {
  speakers: () => request<{ speakers: ManagedSpeaker[] }>("GET", "/api/admin/speakers"),
  createSpeaker: (input: { username: string; displayName: string; email: string; password?: string; expiresAt: string | null }) =>
    request<{ speaker: ManagedSpeaker; password: string }>("POST", "/api/admin/speakers", input),
  updateSpeaker: (id: string, patch: { canSpeak?: boolean; expiresAt?: string | null }) =>
    request<{ speaker: ManagedSpeaker }>("PATCH", `/api/admin/speakers/${encodeURIComponent(id)}`, patch),
};
