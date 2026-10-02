import Stripe from "stripe";
import { env } from "@numserve/config";

export const MIN_STRIPE_USD = 1.0;

let stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  const secret = env().STRIPE_SECRET_KEY;
  if (!secret) return null;
  if (!stripe) stripe = new Stripe(secret);
  return stripe;
}

export async function initStripePayment(
  userId: string,
  fundingOrderId: string,
  amountUsd: number
): Promise<{ clientSecret: string; paymentIntentId: string; mocked: boolean }> {
  const s = getStripe();
  if (!s) {
    return {
      clientSecret: `pi_mock_${fundingOrderId}_secret_mock`,
      paymentIntentId: `pi_mock_${fundingOrderId}`,
      mocked: true,
    };
  }

  const pi = await s.paymentIntents.create({
    amount: Math.round(amountUsd * 100),
    currency: "usd",
    metadata: { userId, fundingOrderId },
  });
  return {
    clientSecret: pi.client_secret ?? "",
    paymentIntentId: pi.id,
    mocked: false,
  };
}
