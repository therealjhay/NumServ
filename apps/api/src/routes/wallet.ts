import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@numserve/db";
import { env } from "@numserve/config";
import { authMiddleware, JWTPayload } from "../middleware/auth";
import { debitWallet, creditWallet, issueRefund } from "../helpers/wallet-helpers";
import { initPaystackTransaction, MIN_PAYSTACK_NGN } from "../helpers/payments-paystack";
import { initStripePayment, MIN_STRIPE_USD } from "../helpers/payments-stripe";

export const walletRoutes = new Hono<{ Variables: { user: JWTPayload } }>();

function checkInternalSecret(c: { req: { header: (n: string) => string | undefined } }) {
  const secret = env().INTERNAL_SERVICE_SECRET;
  if (!secret) return false;
  const got = c.req.header("x-internal-secret");
  return got === secret;
}

const internalMutationSchema = z.object({
  userId: z.string().min(1),
  amount: z.union([z.string(), z.number()]),
  description: z.string().min(1),
  idempotencyKey: z.string().min(1),
  referenceId: z.string().optional(),
  type: z.enum(["CREDIT", "REFUND", "BONUS"]).optional(),
});

// ── GET /wallet/balance ──
walletRoutes.get("/balance", authMiddleware, async (c) => {
  const user = c.get("user") as JWTPayload;
  const wallet = await prisma.wallet.findUnique({ where: { userId: user.sub } });
  if (!wallet) return c.json({ error: "Wallet not found" }, 404);
  return c.json({ balance: wallet.balance.toString(), currency: wallet.currency });
});

// ── GET /wallet/transactions ──
walletRoutes.get("/transactions", authMiddleware, async (c) => {
  const user = c.get("user") as JWTPayload;
  const page = Math.max(1, Number(c.req.query("page") || 1));
  const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") || 20)));
  const wallet = await prisma.wallet.findUnique({ where: { userId: user.sub } });
  if (!wallet) return c.json({ error: "Wallet not found" }, 404);

  const [total, rows] = await Promise.all([
    prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
    prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return c.json({
    data: rows.map((t) => ({
      id: t.id,
      type: t.type,
      status: t.status,
      amount: t.amount.toString(),
      balanceBefore: t.balanceBefore.toString(),
      balanceAfter: t.balanceAfter.toString(),
      description: t.description,
      referenceId: t.referenceId,
      createdAt: t.createdAt,
    })),
    pagination: { page, limit, total },
  });
});

// ── POST /wallet/fund/paystack ──
const fundPaystackSchema = z.object({
  amount: z.number().min(MIN_PAYSTACK_NGN),
  currency: z.string().default("NGN"),
  callbackUrl: z.string().url().optional(),
});

walletRoutes.post("/fund/paystack", authMiddleware, async (c) => {
  const user = c.get("user") as JWTPayload;
  const body = await c.req.json();
  const parsed = fundPaystackSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

  const wallet = await prisma.wallet.findUnique({ where: { userId: user.sub } });
  if (!wallet) return c.json({ error: "Wallet not found" }, 404);
  const dbUser = await prisma.user.findUnique({ where: { id: user.sub } });
  if (!dbUser) return c.json({ error: "User not found" }, 404);

  const order = await prisma.fundingOrder.create({
    data: {
      walletId: wallet.id,
      provider: "PAYSTACK",
      amountFiat: parsed.data.amount,
      currency: parsed.data.currency,
      status: "PENDING",
    },
  });

  const reference = `ps_${order.id.replace(/-/g, "").slice(0, 20)}`;
  const init = await initPaystackTransaction(
    dbUser.email,
    parsed.data.amount,
    reference,
    parsed.data.callbackUrl
  );

  await prisma.fundingOrder.update({
    where: { id: order.id },
    data: { providerRef: init.reference },
  });

  return c.json({
    orderId: order.id,
    authorizationUrl: init.authorizationUrl,
    reference: init.reference,
  });
});

// ── POST /wallet/fund/stripe ──
const fundStripeSchema = z.object({
  amount: z.number().min(MIN_STRIPE_USD),
});

walletRoutes.post("/fund/stripe", authMiddleware, async (c) => {
  const user = c.get("user") as JWTPayload;
  const body = await c.req.json();
  const parsed = fundStripeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);

  const wallet = await prisma.wallet.findUnique({ where: { userId: user.sub } });
  if (!wallet) return c.json({ error: "Wallet not found" }, 404);

  const order = await prisma.fundingOrder.create({
    data: {
      walletId: wallet.id,
      provider: "STRIPE",
      amountFiat: parsed.data.amount,
      currency: "USD",
      status: "PENDING",
    },
  });

  const init = await initStripePayment(user.sub, order.id, parsed.data.amount);

  await prisma.fundingOrder.update({
    where: { id: order.id },
    data: { providerRef: init.paymentIntentId },
  });

  return c.json({
    orderId: order.id,
    clientSecret: init.clientSecret,
    paymentIntentId: init.paymentIntentId,
  });
});

// ── POST /wallet/internal/refund ──
walletRoutes.post("/internal/refund", async (c) => {
  if (!checkInternalSecret(c)) return c.json({ error: "Forbidden" }, 403);
  const body = await c.req.json();
  const parsed = z.object({ assignmentId: z.string().min(1) }).safeParse(body);
  if (!parsed.success) return c.json({ error: "assignmentId required" }, 400);

  try {
    const result = await issueRefund(parsed.data.assignmentId);
    if (!result) return c.json({ refunded: false });
    return c.json({ refunded: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Refund failed";
    if (msg === "ASSIGNMENT_NOT_FOUND") return c.json({ error: msg }, 404);
    throw e;
  }
});

// ── POST /wallet/internal/debit ──
walletRoutes.post("/internal/debit", async (c) => {
  if (!checkInternalSecret(c)) return c.json({ error: "Forbidden" }, 403);
  const body = await c.req.json();
  const parsed = internalMutationSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);
  const { userId, amount, description, idempotencyKey, referenceId } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) =>
      debitWallet(tx, userId, amount, description, idempotencyKey, referenceId)
    );
    return c.json({ transactionId: result.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Debit failed";
    if (msg === "INSUFFICIENT_BALANCE") return c.json({ error: msg }, 402);
    if (msg === "WALLET_NOT_FOUND") return c.json({ error: msg }, 404);
    throw e;
  }
});

// ── POST /wallet/internal/credit ──
walletRoutes.post("/internal/credit", async (c) => {
  if (!checkInternalSecret(c)) return c.json({ error: "Forbidden" }, 403);
  const body = await c.req.json();
  const parsed = internalMutationSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.errors[0].message }, 400);
  const { userId, amount, description, idempotencyKey, referenceId, type } = parsed.data;

  const result = await prisma.$transaction(async (tx) =>
    creditWallet(tx, userId, amount, type ?? "CREDIT", description, idempotencyKey, referenceId)
  );
  return c.json({ transactionId: result.id });
});
