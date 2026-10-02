import crypto from "node:crypto";
import { env } from "@numserve/config";
import { getRedis } from "./auth-helpers";

// ─────────────────────────────────────────────
// Paystack helpers — init + signature verify +
// NGN→USD rate (Redis-cached, 1h TTL)
// ─────────────────────────────────────────────

export const MIN_PAYSTACK_NGN = 500;

export function verifyPaystackSignature(rawBody: string, signature: string | undefined): boolean {
  const secret = env().PAYSTACK_SECRET_KEY;
  if (!secret || !signature) return false;
  const hmac = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
}

export async function getNgnToUsdRate(): Promise<number> {
  const r = getRedis();
  const cached = await r.get("fx:NGNUSD").catch(() => null);
  if (cached) {
    const n = Number(cached);
    if (Number.isFinite(n) && n > 0) return n;
  }
  // TODO: fetch live rate from ExchangeRate-API on a schedule.
  const fallback = 1500; // NGN per USD
  await r.setex("fx:NGNUSD", 3600, String(fallback)).catch(() => {});
  return fallback;
}

export async function initPaystackTransaction(
  email: string,
  amountNgn: number,
  reference: string,
  callbackUrl?: string
): Promise<{ authorizationUrl: string; reference: string; mocked: boolean }> {
  const secret = env().PAYSTACK_SECRET_KEY;
  if (!secret) {
    return {
      authorizationUrl: `https://paystack.mock/checkout/${reference}`,
      reference,
      mocked: true,
    };
  }

  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      amount: Math.round(amountNgn * 100), // kobo
      reference,
      ...(callbackUrl ? { callback_url: callbackUrl } : {}),
    }),
  });

  if (!res.ok) throw new Error("PAYSTACK_INIT_FAILED");
  const data = (await res.json()) as {
    status: boolean;
    data?: { authorization_url: string; reference: string };
  };
  if (!data.status || !data.data) throw new Error("PAYSTACK_INIT_FAILED");
  return {
    authorizationUrl: data.data.authorization_url,
    reference: data.data.reference,
    mocked: false,
  };
}
