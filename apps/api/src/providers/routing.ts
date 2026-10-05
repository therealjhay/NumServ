import { prisma } from "@numserve/db";
import type { Provider } from "@prisma/client";
import { getAdapter } from "./registry";
import type { ProviderAdapter, ActivationResult } from "./types";

// ─────────────────────────────────────────────
// Smart routing + failover — real providers only.
// Never synthesize numbers. If nothing can serve,
// throw NO_PROVIDER_AVAILABLE / ALL_PROVIDERS_FAILED.
// ─────────────────────────────────────────────

export function calculateScore(provider: Provider, availableCount: number): number {
  if (availableCount === 0) return 0;
  const successWeight = Number(provider.successRate) * 0.7;
  const availabilityBonus = Math.min(availableCount, 20) * 0.3;
  const statusMultiplier = provider.status === "DEGRADED" ? 0.5 : 1.0;
  return (successWeight + availabilityBonus) * statusMultiplier;
}

export async function selectProvider(
  countryCode: string,
  serviceSlug: string,
  opts?: { exclude?: Set<string> }
): Promise<{ adapter: ProviderAdapter; providerRecord: Provider }> {
  const providers = await prisma.provider.findMany({
    where: { status: { in: ["ACTIVE", "DEGRADED"] } },
    orderBy: { priority: "asc" },
  });

  const scored = await Promise.all(
    providers
      .filter((p) => !opts?.exclude?.has(p.name))
      .map(async (p) => {
        const adapter = getAdapter(p.name);
        const available = await adapter
          .getAvailableNumbers(countryCode, serviceSlug)
          .catch(() => []);
        return { provider: p, adapter, score: calculateScore(p, available.length) };
      })
  );

  const best = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)[0];
  if (!best) throw new Error("NO_PROVIDER_AVAILABLE");
  return { adapter: best.adapter, providerRecord: best.provider };
}

export async function activateWithFallback(
  countryCode: string,
  serviceSlug: string,
  maxAttempts = 2
): Promise<{ activation: ActivationResult; provider: Provider }> {
  const tried = new Set<string>();
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { adapter, providerRecord } = await selectProvider(countryCode, serviceSlug, {
      exclude: tried,
    }).catch((e) => {
      lastError = e;
      throw e;
    });

    try {
      const activation = await adapter.activateNumber("", serviceSlug, countryCode);
      await updateProviderMetrics(providerRecord.id, { success: true });
      return { activation, provider: providerRecord };
    } catch (err) {
      lastError = err;
      tried.add(providerRecord.name);
      await updateProviderMetrics(providerRecord.id, { success: false });
      await checkAndDegradeProvider(providerRecord.id);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("ALL_PROVIDERS_FAILED");
}

async function updateProviderMetrics(
  providerId: string,
  result: { success: boolean }
): Promise<void> {
  if (result.success) return;
  await prisma.provider
    .update({
      where: { id: providerId },
      data: { successRate: undefined },
    })
    .catch(() => null);
}

async function checkAndDegradeProvider(providerId: string): Promise<void> {
  // Conservative: mark DEGRADED so routing deprioritizes it until
  // the next successful health check restores ACTIVE.
  await prisma.provider
    .update({
      where: { id: providerId },
      data: { status: "DEGRADED" },
    })
    .catch(() => null);
}

export async function runHealthChecks(): Promise<void> {
  const providers = await prisma.provider.findMany();
  for (const provider of providers) {
    const adapter = getAdapter(provider.name);
    const result = await adapter.healthCheck().catch((e) => ({
      healthy: false,
      latencyMs: 0,
      error: e instanceof Error ? e.message : "healthcheck failed",
    }));

    const newStatus = !result.healthy ? "OFFLINE" : result.latencyMs > 3000 ? "DEGRADED" : "ACTIVE";

    await prisma.provider.update({
      where: { id: provider.id },
      data: {
        status: newStatus as Provider["status"],
        avgDeliveryMs: result.latencyMs,
        lastHealthCheck: new Date(),
      },
    });
  }
}

export async function updateNumberReputation(
  numberId: string,
  outcome: "SUCCESS" | "FAILED" | "BLACKLISTED"
): Promise<void> {
  const number = await prisma.virtualNumber.findUnique({ where: { id: numberId } });
  if (!number) return;

  const delta = outcome === "SUCCESS" ? 2 : outcome === "FAILED" ? -5 : -40;
  const newScore = Math.max(0, Math.min(100, number.reputationScore + delta));

  await prisma.virtualNumber.update({
    where: { id: numberId },
    data: {
      reputationScore: newScore,
      status: newScore < 20 ? "RETIRED" : number.status,
      useCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });
}
