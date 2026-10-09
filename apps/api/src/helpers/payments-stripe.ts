import Stripe from "stripe";
import { env } from "@numserve/config";

export const MIN_STRIPE_USD = 1.0;

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  const secret = env().STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_NOT_CONFIGURED");
  if (!stripe) stripe = new Stripe(secret);
  return stripe;
}

export async function initStripePayment(
  userId: string,
  fundingOrderId: string,
  amountUsd: number
): Promise<{ clientSecret: string; paymentIntentId: string }> {
  const s = getStripe();

  const pi = await s.paymentIntents.create({
    amount: Math.round(amountUsd * 100),
    currency: "usd",
    metadata: { userId, fundingOrderId },
  });
  return {
    clientSecret: pi.client_secret ?? "",
    paymentIntentId: pi.id,
  };
}
