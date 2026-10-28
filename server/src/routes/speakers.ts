import { Router } from "express";
import rateLimit from "express-rate-limit";
import { users } from "../db.js";
import { liveInfo } from "../realtime.js";

export const speakersRouter = Router();
speakersRouter.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many attempts. Please try again later." } }));

/** Public lookup used by listeners before joining. */
speakersRouter.get("/:username", (req, res) => {
  const user = users.byUsername(req.params.username.replace(/^@/, ""));
  if (!user) return res.status(404).json({ error: "No speaker found with that ID" });
  res.json({ username: user.username, displayName: user.display_name, ...liveInfo(user.id) });
});
