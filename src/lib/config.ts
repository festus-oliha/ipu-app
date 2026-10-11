import "server-only";

/**
 * Reads a required setting from .env and explains in plain words what to do
 * when it is missing — the message shows on screen during development.
 */
export class SetupError extends Error {
  constructor(message: string) {
    super(`Setup needed: ${message} See README step 4, then restart "npm run dev".`);
    this.name = "SetupError";
  }
}

export function requireEnv(name: "DATABASE_URL" | "SESSION_SECRET", minLength = 1): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new SetupError(`${name} is empty in your .env file.`);
  }
  if (value.length < minLength) {
    throw new SetupError(`${name} in .env must be at least ${minLength} characters long.`);
  }
  return value;
}
