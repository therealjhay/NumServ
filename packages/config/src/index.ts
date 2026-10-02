import { loadServerEnv } from "./env";
export type { ServerEnv, ClientEnv } from "./env";

/**
 * Lazily-loaded environment config singleton.
 * First access parses & validates .env; subsequent reads return cached value.
 */
let _env: ReturnType<typeof loadServerEnv> | null = null;

export function env(): ReturnType<typeof loadServerEnv> {
  if (!_env) {
    _env = loadServerEnv();
  }
  return _env;
}
