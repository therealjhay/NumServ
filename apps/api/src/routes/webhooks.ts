import { Hono } from "hono";
import { Prisma } from "@prisma/client";
import { prisma } from "@numserve/db";
import { env } from "@numserve/config";
import { creditWallet } from "../helpers/wallet-helpers";
import { verifyPaystackSignature, getNgnToUsdRate } from "../helpers/payments-paystack";
import { getStripe } from "../helpers/payments-stripe";

export const webhookRoutes = new Hono();

// ── POST /webhooks/paystack ──
webhookRoutes.post("/paystack", async (c) => {
  if (!env().PAYSTACK_SECRET_KEY) {
    return c.json({ error: "PAYSTACK_NOT_CONFIGURED" }, 503);
  }
  const rawBody = await c.req.text();
  const signature = c.req.header("x-paystack-signature");

  if (!verifyPaystackSignature(rawBody, signature)) {
    console.error("[WEBHOOK] Invalid Paystack signature");
    return c.json({ error: "Invalid signature" }, 400);
  }

  let event: { event?: string; data?: { reference?: string; status?: string; amount?: number } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (event.event !== "charge.success") return c.json({ received: true });

  const reference = event.data?.reference;
  if (!reference) return c.json({ error: "Missing reference" }, 400);

  const order = await prisma.fundingOrder.findUnique({
    where: { providerRef: reference },
    include: { wallet: true },
  });
  if (!order) return c.json({ error: "Order not found" }, 404);
  if (order.status === "COMPLETED") return c.json({ received: true });

  const amountKobo = event.data?.amount ?? Number(order.amountFiat) * 100;
  const amountNgn = amountKobo / 100;
  const rate = await getNgnToUsdRate();
  const amountUsd = new Prisma.Decimal(amountNgn).div(rate);

  await prisma.$transaction(async (tx) => {
    await tx.fundingOrder.update({
      where: { id: order.id },
      data: {
        status: "COMPLETED",
        amountCredited: amountUsd,
        webhookPayload: event as object,
      },
    });
    await creditWallet(
      tx,
      order.wallet.userId,
      amountUsd.toString(),
      "CREDIT",
      `Wallet funding via Paystack (${reference})`,
      `fund:paystack:${reference}`,
      reference
    );
  });

  return c.json({ received: true });
});

// ── POST /webhooks/stripe ──
webhookRoutes.post("/stripe", async (c) => {
  const secret = env().STRIPE_WEBHOOK_SECRET;
  if (!env().STRIPE_SECRET_KEY || !secret) {
    return c.json({ error: "STRIPE_NOT_CONFIGURED" }, 503);
  }
  const stripe = getStripe();

  const rawBody = await c.req.text();
  const sig = c.req.header("stripe-signature") ?? "";
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch {
    return c.json({ error: "Invalid signature" }, 400);
  }

  if (event.type !== "payment_intent.succeeded") return c.json({ received: true });
  const pi = event.data.object as { id: string; amount: number; metadata?: { userId?: string; fundingOrderId?: string } };
  const fundingOrderId = pi.metadata?.fundingOrderId;
  if (!fundingOrderId) return c.json({ error: "Missing fundingOrderId" }, 400);

  const order = await prisma.fundingOrder.findUnique({
    where: { id: fundingOrderId },
    include: { wallet: true },
  });
  if (!order) return c.json({ error: "Order not found" }, 404);
  if (order.status === "COMPLETED") return c.json({ received: true });

  const amountUsd = new Prisma.Decimal(pi.amount).div(100);
  await prisma.$transaction(async (tx) => {
    await tx.fundingOrder.update({
      where: { id: order.id },
      data: { status: "COMPLETED", amountCredited: amountUsd, webhookPayload: event as object },
    });
    await creditWallet(
      tx,
      order.wallet.userId,
      amountUsd.toString(),
      "CREDIT",
      `Wallet funding via Stripe (${pi.id})`,
      `fund:stripe:${pi.id}`,
      pi.id
    );
  });

  return c.json({ received: true });
});
