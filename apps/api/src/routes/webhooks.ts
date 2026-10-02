import { Hono } from "hono";
import { Prisma } from "@prisma/client";
import { prisma } from "@numserve/db";
import { env } from "@numserve/config";
import { creditWallet } from "../helpers/wallet-helpers";
import { verifyPaystackSignature, getNgnToUsdRate } from "../helpers/payments-paystack";

export const webhookRoutes = new Hono();

// ── POST /webhooks/paystack ──
webhookRoutes.post("/paystack", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-paystack-signature");

  // In mock mode (no secret configured) skip verification for local testing.
  if (env().PAYSTACK_SECRET_KEY) {
    if (!verifyPaystackSignature(rawBody, signature)) {
      console.error("[WEBHOOK] Invalid Paystack signature");
      return c.json({ error: "Invalid signature" }, 400);
    }
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
