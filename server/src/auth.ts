import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { isExpired, users, type UserRow } from "./db.js";
import type { AppleProfile } from "./apple.js";
import type { GoogleProfile } from "./google.js";

interface TokenPayload {
  sub: string;
  typ?: undefined;
}
interface SignupPayload {
  typ: "google_signup" | "apple_signup";
  g: GoogleProfile | AppleProfile;
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

/** Short-lived token carrying a verified Google profile while the user picks a speaker ID. */
export const signSignupToken = (g: GoogleProfile) =>
  jwt.sign({ typ: "google_signup", g } satisfies SignupPayload, config.JWT_SECRET, { expiresIn: "20m" });

function readSignupToken(token: string, typ: SignupPayload["typ"]): SignupPayload["g"] | null {
  try {
    const p = jwt.verify(token, config.JWT_SECRET) as SignupPayload;
    return p.typ === typ ? p.g : null;
  } catch {
    return null;
  }
}

export const verifySignupToken = (token: string) => readSignupToken(token, "google_signup") as GoogleProfile | null;

/** Same, for a verified Apple profile. */
export const signAppleSignupToken = (a: AppleProfile) =>
  jwt.sign({ typ: "apple_signup", g: a } satisfies SignupPayload, config.JWT_SECRET, { expiresIn: "20m" });

export const verifyAppleSignupToken = (token: string) => readSignupToken(token, "apple_signup") as AppleProfile | null;

/** Link token in the "speaking access request" email that lets the admin approve with one click. */
export const signApproveToken = (userId: string) =>
  jwt.sign({ typ: "approve_speaker", uid: userId }, config.JWT_SECRET, { expiresIn: "30d" });

export function verifyApproveToken(token: string): string | null {
  try {
    const p = jwt.verify(token, config.JWT_SECRET) as { typ?: string; uid?: string };
    return p.typ === "approve_speaker" && p.uid ? p.uid : null;
  } catch {
    return null;
  }
}

/** Returns the user for a valid session token, or null for missing/invalid/expired tokens. */
export async function userFromToken(token: string | undefined | null): Promise<UserRow | null> {
  if (!token) return null;
  let payload: TokenPayload & { typ?: string };
  try {
    payload = jwt.verify(token, config.JWT_SECRET) as TokenPayload & { typ?: string };
  } catch {
    return null;
  }
  if (payload.typ) return null; // signup tokens can't be used as sessions
  const user = (await users.byId(payload.sub)) ?? null;
  // An admin-set expiry date has passed: the account no longer works (it's signed out everywhere).
  return user && !isExpired(user) ? user : null;
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

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await userFromToken(bearer(req));
  if (!user) return res.status(401).json({ error: "Authentication required" });
  req.user = user;
  next();
}
