-- Ensure wallet balance never goes negative
ALTER TABLE "Wallet"
ADD CONSTRAINT "wallet_balance_non_negative"
CHECK (balance >= 0);