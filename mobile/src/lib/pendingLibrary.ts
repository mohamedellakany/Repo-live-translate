import { api } from "./api";
import { storage } from "./storage";

/**
 * Sessions followed without an account. After the listener signs in they're added to
 * "My sessions" (signed-in listeners are recorded by the server automatically).
 */
interface PendingSession {
  sessionId: string;
  lang: string;
}
const KEY = "lt.pendingLibrary";
const MAX = 20;

export const pendingLibrary = {
  async add(entry: PendingSession) {
    const list = (await storage.getJSON<PendingSession[]>(KEY, [])).filter((x) => x.sessionId !== entry.sessionId);
    await storage.setJSON(KEY, [entry, ...list].slice(0, MAX));
  },
  /** Add every pending session to the signed-in user's library. Entries that fail offline are kept for next time. */
  async claim() {
    const list = await storage.getJSON<PendingSession[]>(KEY, []);
    if (!list.length) return;
    const results = await Promise.allSettled(list.map((p) => api.claimLibrarySession(p.sessionId, p.lang)));
    const keep = list.filter((_, i) => {
      const r = results[i];
      return r.status === "rejected" && (r.reason as { status?: number }).status === 0;
    });
    await storage.setJSON(KEY, keep);
  },
};
