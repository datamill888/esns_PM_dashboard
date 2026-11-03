/**
 * Incorta sign-in — LOCKED on appkit (replace with the template copy at create
 * time). Local stand-in: when INCORTA_URL is not configured the gate is off and
 * getServerSession returns null, so the app runs in demo mode.
 */
import { createIncortaAuth, type AuthSession } from "@incorta/auth";

export const auth = process.env.INCORTA_URL ? createIncortaAuth() : null;

export async function getServerSession(request: Request): Promise<AuthSession | null> {
  return auth ? auth.getSession(request) : null;
}
