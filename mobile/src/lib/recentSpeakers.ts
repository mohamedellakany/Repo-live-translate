import { storage } from "./storage";

export interface RecentSpeaker {
  username: string;
  displayName: string;
}
const KEY = "lt.recentSpeakers";
const MAX = 6;

export const recentSpeakers = {
  list: () => storage.getJSON<RecentSpeaker[]>(KEY, []),
  async add(s: RecentSpeaker) {
    const list = (await recentSpeakers.list()).filter((x) => x.username !== s.username);
    await storage.setJSON(KEY, [s, ...list].slice(0, MAX));
  },
  async remove(username: string) {
    await storage.setJSON(KEY, (await recentSpeakers.list()).filter((x) => x.username !== username));
  },
};
