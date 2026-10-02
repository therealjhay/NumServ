import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Redis from "ioredis";
import { env } from "@numserve/config";
import { prisma } from "@numserve/db";
import type { JWTPayload } from "../middleware/auth";

// ─────────────────────────────────────────────
// Auth Helpers — rate limiting, token generation,
// password hashing, session management
// ─────────────────────────────────────────────

// Redis client (singleton)
let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env().REDIS_URL || "redis://localhost:6379");
  }
  return redis;
}

// ── Password Hashing ───────────────────────────────────────

const BCRYPT_COST = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function comparePassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── Password Validation ────────────────────────────────────

export function validatePasswordStrength(password: string): {
  valid: boolean;
  error?: string;
} {
  if (password.length < 8) {
    return { valid: false, error: "Password must be at least 8 characters" };
  }
  if (!/[A-Z]/.test(password)) {
    return {
      valid: false,
      error: "Password must contain at least one uppercase letter",
    };
  }
  if (!/[0-9]/.test(password)) {
    return {
      valid: false,
      error: "Password must contain at least one number",
    };
  }
  return { valid: true };
}

// ── JWT Generation ─────────────────────────────────────────

export function generateAccessToken(user: {
  id: string;
  email: string;
  kycTier: string;
  status: string;
}): string {
  const privateKey = env().JWT_PRIVATE_KEY?.replace(/\\n/g, "\n") || "";

  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      kycTier: user.kycTier,
      status: user.status,
    },
    privateKey,
    {
      algorithm: "RS256",
      expiresIn: "15m",
    }
  );
}

// ── Refresh Token ──────────────────────────────────────────

export function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString("hex");
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ── Session Management ─────────────────────────────────────

export async function createSession(
  userId: string,
  refreshToken: string,
  ip: string | undefined,
  userAgent: string | undefined,
  _deviceFingerprint?: string | undefined
) {
  const tokenHash = hashRefreshToken(refreshToken);

  const session = await prisma.session.create({
    data: {
      userId,
      refreshToken: tokenHash,
      ipAddress: ip || "unknown",
      userAgent: userAgent || "unknown",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
  });

  return session;
}

// ── Rate Limiting ──────────────────────────────────────────

const LOGIN_RATE_LIMIT = 5;
const LOGIN_LOCKOUT_SECONDS = 30 * 60; // 30 minutes
const LOGIN_WINDOW_SECONDS = 15 * 60; // 15 minutes

export async function checkLoginRateLimit(
  email: string
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const r = getRedis();
  const key = `ratelimit:login:${email.toLowerCase()}`;

  // Check if locked
  const locked = await r.get(`${key}:locked`);
  if (locked) {
    const ttl = await r.ttl(`${key}:locked`);
    return { allowed: false, retryAfter: Math.max(ttl, 0) };
  }

  const attempts = await r.get(key);
  if (attempts && parseInt(attempts) >= LOGIN_RATE_LIMIT) {
    // Lock the account
    await r.setex(`${key}:locked`, LOGIN_LOCKOUT_SECONDS, "1");
    await r.del(key);
    return { allowed: false, retryAfter: LOGIN_LOCKOUT_SECONDS };
  }

  return { allowed: true };
}

export async function recordFailedLogin(email: string): Promise<void> {
  const r = getRedis();
  const key = `ratelimit:login:${email.toLowerCase()}`;

  const current = await r.incr(key);
  if (current === 1) {
    await r.expire(key, LOGIN_WINDOW_SECONDS);
  }
}

export async function clearFailedLogins(email: string): Promise<void> {
  const r = getRedis();
  const key = `ratelimit:login:${email.toLowerCase()}`;
  await r.del(key);
  await r.del(`${key}:locked`);
}

// ── Email Verification Token ───────────────────────────────

export async function createEmailVerificationToken(
  userId: string
): Promise<string> {
  const token = crypto.randomUUID();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  // Store hash in Redis with 24h expiry
  const r = getRedis();
  await r.setex(`emailverify:${tokenHash}`, 24 * 60 * 60, userId);

  return token;
}

export async function verifyEmailToken(
  token: string
): Promise<string | null> {
  const r = getRedis();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const userId = await r.get(`emailverify:${tokenHash}`);
  if (userId) {
    await r.del(`emailverify:${tokenHash}`);
  }
  return userId;
}

// ── Password Reset Token ───────────────────────────────────

export async function createPasswordResetToken(
  userId: string
): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const r = getRedis();
  await r.setex(`passwordreset:${tokenHash}`, 60 * 60, userId); // 1 hour

  return token;
}

export async function verifyPasswordResetToken(
  token: string
): Promise<string | null> {
  const r = getRedis();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const userId = await r.get(`passwordreset:${tokenHash}`);
  if (userId) {
    await r.del(`passwordreset:${tokenHash}`);
  }
  return userId;
}

// ── Device Tracking ────────────────────────────────────────

export async function recordDeviceLogin(
  userId: string,
  _ip: string | undefined,
  userAgent: string | undefined,
  deviceFingerprint: string | undefined
) {
  const fingerprint = deviceFingerprint || "unknown";
  // Check if device is known
  const existingDevice = await prisma.device.findFirst({
    where: {
      userId,
      fingerprint,
    },
  });

  const isNewDevice = !existingDevice;

  if (isNewDevice && deviceFingerprint) {
    await prisma.device.create({
      data: {
        userId,
        fingerprint: deviceFingerprint,
        label: userAgent || "unknown",
        lastSeenAt: new Date(),
      },
    });
  } else if (existingDevice) {
    await prisma.device.update({
      where: { id: existingDevice.id },
      data: { lastSeenAt: new Date() },
    });
  }

  return { isNewDevice };
}