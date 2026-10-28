import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { users, type UserRow } from "./db.js";
import type { GoogleProfile } from "./google.js";

interface TokenPayload {
  sub: string;
  typ?: undefined;
}
interface SignupPayload {
  typ: "google_signup";
  g: GoogleProfile;
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

/** Short-lived token carrying a verified Google profile while the user picks a speaker ID. */
export const signSignupToken = (g: GoogleProfile) =>
  jwt.sign({ typ: "google_signup", g } satisfies SignupPayload, config.JWT_SECRET, { expiresIn: "20m" });

export function verifySignupToken(token: string): GoogleProfile | null {
  try {
    const p = jwt.verify(token, config.JWT_SECRET) as SignupPayload;
    return p.typ === "google_signup" ? p.g : null;
  } catch {
    return null;
  }
}

/** Returns the user for a valid session token, or null for missing/invalid/expired tokens. */
export function userFromToken(token: string | undefined | null): UserRow | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as TokenPayload & { typ?: string };
    if (payload.typ) return null; // signup tokens can't be used as sessions
    return users.byId(payload.sub) ?? null;
  } catch {
    return null;
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

const bearer = (req: Request) => {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
};

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = userFromToken(bearer(req));
  if (!user) return res.status(401).json({ error: "Authentication required" });
  req.user = user;
  next();
}
