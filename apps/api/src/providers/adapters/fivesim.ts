import { env } from "@numserve/config";
import type {
  ProviderAdapter,
  ProviderHealthResult,
  ProviderNumber,
  ActivationResult,
  SMSPollResult,
  ProviderPrice,
} from "../types";

// ─────────────────────────────────────────────
// 5sim — primary provider. Real API only.
// Docs: https://5sim.net/docs
// Auth: Authorization: Bearer API_KEY
// ─────────────────────────────────────────────

const BASE = "https://5sim.net/v1";

const COUNTRY_MAP: Record<string, string> = {
  US: "usa",
  UK: "england",
  NG: "nigeria",
  CA: "canada",
  DE: "germany",
};

const SERVICE_MAP: Record<string, string> = {
  telegram: "telegram",
  whatsapp: "whatsapp",
  gmail: "google",
  instagram: "instagram",
  twitter: "twitter",
};

function apiKey(): string {
  const key = env().FIVESIM_API_KEY;
  if (!key) throw new Error("FIVESIM_API_KEY_MISSING");
  return key;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey()}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`FIVESIM_API_ERROR: ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export class FiveSimAdapter implements ProviderAdapter {
  name = "5sim";

  async healthCheck(): Promise<ProviderHealthResult> {
    const start = Date.now();
    try {
      await apiGet<{ balance?: number }>("/user/profile");
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (e) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : "healthcheck failed",
      };
    }
  }

  async getAvailableNumbers(
    countryCode: string,
    serviceSlug: string
  ): Promise<ProviderNumber[]> {
    const country = COUNTRY_MAP[countryCode];
    const product = SERVICE_MAP[serviceSlug];
    if (!country || !product) return [];

    // 5sim prices endpoint doubles as availability signal.
    const prices = await apiGet<Record<string, Record<string, { cost: number; count: number }>>>(
      `/guest/prices?product=${product}`
    ).catch(() => null);
    if (!prices) return [];

    const entry = prices[country]?.[product] ?? prices[country]?.["any"];
    if (!entry || entry.count === 0) return [];

    // 5sim does not list individual numbers pre-activation — return
    // availability placeholders so routing can score by count.
    return Array.from({ length: Math.min(entry.count, 20) }, (_, i) => ({
      providerNumberId: `5sim:${country}:${product}:${i}`,
      number: "pending-activation",
      countryCode,
    }));
  }

  async activateNumber(
    _providerNumberId: string,
    serviceSlug: string,
    countryCode: string
  ): Promise<ActivationResult> {
    const country = COUNTRY_MAP[countryCode];
    const product = SERVICE_MAP[serviceSlug];
    if (!country || !product) throw new Error("FIVESIM_UNSUPPORTED_ROUTE");

    const data = await apiGet<{
      id: number | string;
      phone?: string;
      status?: string;
    }>(`/user/buy/activation/${country}/any/${product}`);

    if (!data?.id || !data?.phone) throw new Error("FIVESIM_NO_NUMBERS");

    return {
      activationId: String(data.id),
      number: data.phone.startsWith("+") ? data.phone : `+${data.phone}`,
      expiresAt: new Date(Date.now() + 20 * 60 * 1000),
    };
  }

  async pollSMS(activationId: string): Promise<SMSPollResult> {
    const data = await apiGet<{
      status?: string;
      sms?: Array<{ code?: string; text?: string }>;
    }>(`/user/check/${activationId}`);

    const status = (data.status ?? "").toUpperCase();
    if (status.includes("RECEIVED") || (data.sms && data.sms.length > 0)) {
      const first = data.sms?.[0];
      return { status: "RECEIVED", code: first?.code, rawMessage: first?.text };
    }
    if (status.includes("CANCEL") || status.includes("BAN") || status.includes("EXPIRE")) {
      return { status: "CANCELLED" };
    }
    return { status: "PENDING" };
  }

  async cancelActivation(activationId: string): Promise<void> {
    await apiGet(`/user/cancel/${activationId}`).catch(async () => {
      await apiGet(`/user/ban/${activationId}`);
    });
  }

  async getPricing(countryCode: string, serviceSlug: string): Promise<ProviderPrice> {
    const country = COUNTRY_MAP[countryCode];
    const product = SERVICE_MAP[serviceSlug];
    if (!country || !product) throw new Error("FIVESIM_UNSUPPORTED_ROUTE");

    const prices = await apiGet<Record<string, Record<string, { cost: number }>>>(
      `/guest/prices?product=${product}`
    );
    const cost = prices[country]?.[product]?.cost ?? prices[country]?.["any"]?.cost;
    if (cost == null) throw new Error("FIVESIM_NO_PRICING");
    return { priceUsd: cost, currency: "USD" };
  }
}
