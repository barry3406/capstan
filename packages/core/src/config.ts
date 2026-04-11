import type { CapstanConfig } from "./types.js";

/**
 * Define the app-level Capstan configuration.
 *
 * This is a pass-through identity function that provides type-checking and
 * editor auto-complete for the config object. The returned value is the
 * same object that was passed in.
 */
export function defineConfig(config: CapstanConfig): CapstanConfig {
  return config;
}

/**
 * Read an environment variable, returning an empty string if it is not set.
 */
export function env(key: string): string {
  if (typeof process === "undefined" || !process.env) {
    return "";
  }

  return process.env[key] ?? "";
}
