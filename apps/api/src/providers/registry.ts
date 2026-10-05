import type { ProviderAdapter } from "./types";
import { FiveSimAdapter } from "./adapters/fivesim";
import { SmspvaAdapter } from "./adapters/smspva";

// ─────────────────────────────────────────────
// Adapter registry — real providers only.
// 5sim (primary), smspva (backup).
// ─────────────────────────────────────────────

const adapters = new Map<string, ProviderAdapter>();

function allAdapters(): ProviderAdapter[] {
  return [new FiveSimAdapter(), new SmspvaAdapter()];
}

export function getAdapter(name: string): ProviderAdapter {
  const cached = adapters.get(name);
  if (cached) return cached;

  const found = allAdapters().find((a) => a.name === name);
  if (!found) throw new Error(`UNKNOWN_PROVIDER: ${name}`);

  adapters.set(name, found);
  return found;
}

export function listAdapters(): ProviderAdapter[] {
  return allAdapters();
}
