// Server-side address configuration. Reading it never creates files or opens
// connections, so importing a route module during `next build` has no effect.

import type { TargetName } from "./master-key.ts";

export type AddressProvider = "off" | "fixture" | "geoapify";

/** Unknown or empty values fail closed to `off`. */
export function addressProvider(env: NodeJS.ProcessEnv = process.env): AddressProvider {
  const value = env.GROUPRIDE_ADDRESS_PROVIDER;
  return value === "fixture" || value === "geoapify" ? value : "off";
}

/** The designated local target, selected exactly as the app pool selects its database. */
export function currentTarget(env: NodeJS.ProcessEnv = process.env): TargetName {
  return env.GROUPRIDE_USE_TEST_DATABASE === "1" ? "test" : "demo";
}
