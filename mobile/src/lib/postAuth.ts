import { router, type Href } from "expo-router";
import type { User } from "./api";

/**
 * Where to go after signing in: email verification first, then the requested page.
 * Accounts without speaking access go to Home instead of Speak; Home shows how to request it.
 */
export function routeAfterAuth(user: User, next?: string) {
  const target = !next || (next === "/speak" && !user.canSpeak) ? "/" : next;
  if (!user.emailVerified) {
    router.replace({ pathname: "/verify-email", params: { next: target } });
  } else {
    router.replace(target as Href);
  }
}
