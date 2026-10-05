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
// SMSPVA (smspva.com) — backup provider. Real API only.
// API: GET https://smspva.com/priemnik.php
//   ?metod=get_number|get_sms|ban|denial
//   &country=XX&service=xxx&id=..&apikey=..
// ─────────────────────────────────────────────

const BASE = "https://smspva.com/priemnik.php";

const COUNTRY_MAP: Record<string, string> = {
  US: "US",
  UK: "UK",
  NG: "NG",
  CA: "CA",
  DE: "DE",
};

const SERVICE_MAP: Record<string, string> = {
  telegram: "tg",
  whatsapp: "wa",
  gmail: "go",
  instagram: "ig",
  twitter: "tw",
};

function apiKey(): string {
  const key = env().SMSPVA_API_KEY;
  if (!key) throw new Error("SMSPVA_API_KEY_MISSING");
  return key;
}

async function call<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ ...params, apikey: apiKey() });
  const res = await fetch(`${BASE}?${qs.toString()}`);
  if (!res.ok) throw new Error(`SMSPVA_API_ERROR: ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`SMSPVA_BAD_RESPONSE: ${text.slice(0, 200)}`);
  }
}

export class SmspvaAdapter implements ProviderAdapter {
  name = "smspva";

  async healthCheck(): Promise<ProviderHealthResult> {
    const start = Date.now();
    try {
      await call<{ balance?: string | number; response?: string }>({
        metod: "get_balance",
      });
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (e) {
      // get_balance may not exist on all accounts — fall back to a
      // cheap availability probe so health still reflects reachability.
      try {
        await call({ metod: "get_count", country: "US", service: "tg" });
        return { healthy: true, latencyMs: Date.now() - start };
      } catch (e2) {
        return {
          healthy: false,
          latencyMs: Date.now() - start,
          error: e2 instanceof Error ? e2.message : "healthcheck failed",
        };
      }
    }
  }

  async getAvailableNumbers(
    countryCode: string,
    serviceSlug: string
  ): Promise<ProviderNumber[]> {
    const country = COUNTRY_MAP[countryCode];
    const service = SERVICE_MAP[serviceSlug];
    if (!country || !service) return [];

    const data = await call<{ response?: string; count?: number; online?: number }>({
      metod: "get_count",
      country,
      service,
    }).catch(() => null);
    if (!data) return [];

    const count = Number(data.count ?? data.online ?? 0);
    if (!Number.isFinite(count) || count <= 0) return [];

    return Array.from({ length: Math.min(count, 20) }, (_, i) => ({
      providerNumberId: `smspva:${country}:${service}:${i}`,
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
    const service = SERVICE_MAP[serviceSlug];
    if (!country || !service) throw new Error("SMSPVA_UNSUPPORTED_ROUTE");

    const data = await call<{
      response?: string;
      id?: number | string;
      number?: string;
      Error?: string;
    }>({ metod: "get_number", country, service });

    if (!data?.id || !data?.number) {
      throw new Error(`SMSPVA_NO_NUMBERS: ${data?.Error ?? data?.response ?? "unknown"}`);
    }

    const number = data.number.startsWith("+") ? data.number : `+${data.number}`;
    // Encode country/service into the activation handle — SMSPVA's
    // get_sms/denial endpoints require them on every call.
    return {
      activationId: `${String(data.id)}|${country}|${service}`,
      number,
      expiresAt: new Date(Date.now() + 20 * 60 * 1000),
    };
  }

  private splitActivation(activationId: string): { id: string; country: string; service: string } {
    const [id, country = "", service = ""] = activationId.split("|");
    return { id, country, service };
  }

  async pollSMS(activationId: string): Promise<SMSPollResult> {
    const { id, country, service } = this.splitActivation(activationId);
    const data = await call<{
      response?: string;
      sms?: string | null;
      text?: string | null;
      code?: string | null;
    }>({ metod: "get_sms", id, ...(country ? { country } : {}), ...(service ? { service } : {}) });

    const code = data?.sms ?? data?.code ?? data?.text;
    if (code) return { status: "RECEIVED", code: String(code), rawMessage: String(code) };

    const r = (data?.response ?? "").toUpperCase();
    if (r.includes("BAN") || r.includes("DENIAL") || r.includes("CANCEL") || r.includes("EXPIRE")) {
      return { status: "CANCELLED" };
    }
    return { status: "PENDING" };
  }

  async cancelActivation(activationId: string): Promise<void> {
    const { id } = this.splitActivation(activationId);
    await call({ metod: "denial", id }).catch(() => null);
  }

  async getPricing(countryCode: string, serviceSlug: string): Promise<ProviderPrice> {
    const country = COUNTRY_MAP[countryCode];
    const service = SERVICE_MAP[serviceSlug];
    if (!country || !service) throw new Error("SMSPVA_UNSUPPORTED_ROUTE");

    const data = await call<{ price?: number | string; cost?: number | string }>({
      metod: "get_price",
      country,
      service,
    }).catch(() => null);

    const raw = data?.price ?? data?.cost;
    const price = Number(raw);
    if (!Number.isFinite(price) || price <= 0) throw new Error("SMSPVA_NO_PRICING");
    return { priceUsd: price, currency: "USD" };
  }
}
