import { z } from "zod";

// ─────────────────────────────────────────────
// Environment variable schemas with validation
// ─────────────────────────────────────────────

const serverEnvSchema = z.object({
  // Database
  DATABASE_URL: z.string().url().or(z.string().startsWith("postgresql://")),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Auth
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_EXPIRES_IN: z.string().default("15m"),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default("7d"),

  // Encryption
  OTP_ENCRYPTION_KEY: z.string().min(32, "OTP_ENCRYPTION_KEY must be at least 32 characters"),
  API_KEY_HASH_SALT: z.string().min(8),

  // Payment Providers
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_PUBLIC_KEY: z.string().optional(),
  PAYSTACK_WEBHOOK_SECRET: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLIC_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // SMS Providers
  SMSACTIVATE_API_KEY: z.string().optional(),
  FIVESIM_API_KEY: z.string().optional(),
  TEXTVERIFIED_API_KEY: z.string().optional(),

  // Security
  TURNSTILE_SECRET_KEY: z.string().optional(),
  TURNSTILE_SITE_KEY: z.string().optional(),

  // Email
  SENDGRID_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().default("noreply@numserve.io"),

  // KYC (Phase 2)
  SMILE_IDENTITY_API_KEY: z.string().optional(),
  SMILE_IDENTITY_PARTNER_ID: z.string().optional(),

  // App
  NODE_ENV: z.enum(["development", "staging", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Parse and validate server environment variables.
 * Throws a descriptive error on first call if any required vars are missing.
 */
export function loadServerEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const formatted = parsed.error.format();
    console.error("❌ Invalid environment variables:");
    console.error(JSON.stringify(formatted, null, 2));
    throw new Error("Environment validation failed");
  }

  return parsed.data;
}

// ─── Client-safe (public) env vars ────────────

const clientEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:3001"),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

export function loadClientEnv(): ClientEnv {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  });

  if (!parsed.success) {
    throw new Error("Client environment validation failed");
  }

  return parsed.data;
}