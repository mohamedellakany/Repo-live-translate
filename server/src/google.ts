import { OAuth2Client } from "google-auth-library";
import { config } from "./config.js";

const client = new OAuth2Client();

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/** Verifies a Google ID token (from web or native sign-in) and returns the profile, or throws. */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  if (!config.googleClientIds.length) throw new Error("Google sign-in is not configured");
  const ticket = await client.verifyIdToken({ idToken, audience: config.googleClientIds });
  const p = ticket.getPayload();
  if (!p?.sub || !p.email) throw new Error("Google account has no email");
  return { sub: p.sub, email: p.email.toLowerCase(), emailVerified: !!p.email_verified, name: p.name ?? p.email.split("@")[0] };
}
