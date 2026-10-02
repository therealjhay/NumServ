import { Prisma } from "@prisma/client";
import { prisma } from "@numserve/db";
import type { WalletTransactionType } from "@prisma/client";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// ─────────────────────────────────────────────
// Wallet ledger — atomic debit/credit with
// idempotency + row-level locking.
// Must always run inside prisma.$transaction.
// ─────────────────────────────────────────────

async function getLockedWallet(tx: Tx, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; balance: unknown }>>`
    SELECT id, balance FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function debitWallet(
  tx: Tx,
  userId: string,
  amount: string | number,
  description: string,
  idempotencyKey: string,
  referenceId?: string
) {
  const existing = await tx.walletTransaction.findUnique({
    where: { idempotencyKey },
  });
  if (existing) return existing;

  const wallet = await getLockedWallet(tx, userId);
  if (!wallet) throw new Error("WALLET_NOT_FOUND");

  const balance = new Prisma.Decimal(wallet.balance as string | number);
  const debit = new Prisma.Decimal(amount);
  const newBalance = balance.minus(debit);
  if (newBalance.lessThan(0)) throw new Error("INSUFFICIENT_BALANCE");

  await tx.wallet.update({
    where: { userId },
    data: { balance: newBalance },
  });

  return tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: "DEBIT",
      status: "COMPLETED",
      amount: debit,
      balanceBefore: balance,
      balanceAfter: newBalance,
      description,
      idempotencyKey,
      referenceId,
    },
  });
}

export async function creditWallet(
  tx: Tx,
  userId: string,
  amount: string | number,
  type: WalletTransactionType,
  description: string,
  idempotencyKey: string,
  referenceId?: string
) {
  const existing = await tx.walletTransaction.findUnique({
    where: { idempotencyKey },
  });
  if (existing) return existing;

  const wallet = await getLockedWallet(tx, userId);
  if (!wallet) throw new Error("WALLET_NOT_FOUND");

  const balance = new Prisma.Decimal(wallet.balance as string | number);
  const credit = new Prisma.Decimal(amount);
  const newBalance = balance.plus(credit);

  await tx.wallet.update({
    where: { userId },
    data: { balance: newBalance },
  });

  return tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type,
      status: "COMPLETED",
      amount: credit,
      balanceBefore: balance,
      balanceAfter: newBalance,
      description,
      idempotencyKey,
      referenceId,
    },
  });
}

export async function issueRefund(assignmentId: string) {
  const assignment = await prisma.numberAssignment.findUnique({
    where: { id: assignmentId },
  });
  if (!assignment) throw new Error("ASSIGNMENT_NOT_FOUND");
  if (assignment.refundedAt) return null;
  if (assignment.status !== "EXPIRED") return null;

  const idempotencyKey = `refund:${assignmentId}`;

  return prisma.$transaction(async (tx) => {
    await creditWallet(
      tx,
      assignment.userId,
      assignment.pricePaid.toString(),
      "REFUND",
      "Auto-refund: OTP not received",
      idempotencyKey,
      assignmentId
    );
    await tx.numberAssignment.update({
      where: { id: assignmentId },
      data: { refundedAt: new Date() },
    });
  });
}
