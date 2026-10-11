import "server-only";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { requireEnv } from "./config";

export type SessionData = {
  userId?: string;
};

const THIRTY_MINUTES = 30 * 60;

function options(): SessionOptions {
  const password = requireEnv("SESSION_SECRET", 32);
  return {
    password,
    cookieName: "ipu_session",
    ttl: THIRTY_MINUTES, // signed out after 30 minutes without activity
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
  };
}

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), options());
}
