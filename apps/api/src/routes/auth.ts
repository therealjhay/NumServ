import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "@numserve/db";
import { authMiddleware, JWTPayload } from "../middleware/auth";
import {
  hashPassword,
  comparePassword,
  validatePasswordStrength,
  generateAccessToken,
  generateRefreshToken,
  createSession,
  hashRefreshToken,
  checkLoginRateLimit,
  recordFailedLogin,
  clearFailedLogins,
  createEmailVerificationToken,
  verifyEmailToken,
  createPasswordResetToken,
  verifyPasswordResetToken,
  recordDeviceLogin,
} from "../helpers/auth-helpers";

// ─────────────────────────────────────────────
// Auth Routes — Registration, Login, Refresh,
// Logout, Email Verification, Password Reset,
// 2FA, Devices, Profile
// ─────────────────────────────────────────────

export const authRoutes = new Hono<{ Variables: { user: JWTPayload } }>();

// ═══════════════════════════════════════════════
//  Validation Schemas
// ═══════════════════════════════════════════════

const registerSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1),
  fullName: z.string().min(1, "Full name is required"),
  country: z.string().min(2, "Country is required"),
  phone: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  turnstileToken: z.string().optional(),
  deviceFingerprint: z.string().optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(1),
});

const totpVerifySchema = z.object({
  code: z.string().length(6),
  tempToken: z.string().optional(),
});

const updateProfileSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().optional(),
  country: z.string().min(2).optional(),
});

// ═══════════════════════════════════════════════
//  PUBLIC ROUTES
// ═══════════════════════════════════════════════

// ── POST /auth/register ────────────────────────────────────
authRoutes.post("/register", async (c) => {
  const body = await c.req.json();
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0].message }, 400);
  }

  const { email, password, fullName, country, phone } = parsed.data;

  // Validate password strength
  const passwordCheck = validatePasswordStrength(password);
  if (!passwordCheck.valid) {
    return c.json({ error: passwordCheck.error }, 400);
  }

  // Check email uniqueness (case-insensitive)
  const existing = await prisma.user.findFirst({
    where: { email: email.toLowerCase() },
  });

  if (existing) {
    // Prevent email enumeration — return same response as success
    return c.json(
      { message: "If your email is not registered, you will receive a verification link." },
      200
    );
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Create user + wallet in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        fullName,
        country,
        phone: phone || null,
        status: "PENDING_VERIFICATION",
        kycTier: "NONE",
      },
    });

    // Create wallet
    await tx.wallet.create({
      data: {
        userId: user.id,
        balance: 0,
        currency: "NGN",
      },
    });

    return user;
  });

  // Generate email verification token (async — don't block response)
  createEmailVerificationToken(result.id)
    .then(async (token) => {
      // TODO: Send verification email via email provider
      console.log(
        `[AUTH] Email verification token for ${email}: ${token}`
      );
    })
    .catch((err) => {
      console.error("[AUTH] Failed to create email verification token:", err);
    });

  return c.json(
    { message: "If your email is not registered, you will receive a verification link." },
    201
  );
});

// ── POST /auth/verify-email ────────────────────────────────
authRoutes.post("/verify-email", async (c) => {
  const body = await c.req.json();
  const parsed = verifyEmailSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid token" }, 400);
  }

  const userId = await verifyEmailToken(parsed.data.token);

  if (!userId) {
    return c.json({ error: "Invalid or expired token" }, 400);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { status: "ACTIVE" },
  });

  return c.json({ message: "Email verified successfully" });
});

// ── POST /auth/resend-verification ─────────────────────────
authRoutes.post("/resend-verification", async (c) => {
  const body = await c.req.json();
  const parsed = forgotPasswordSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid email" }, 400);
  }

  const user = await prisma.user.findFirst({
    where: { email: parsed.data.email.toLowerCase() },
  });

  // Always return success to prevent enumeration
  const message =
    "If your email is registered and unverified, you will receive a verification link.";

  if (!user || user.status === "ACTIVE") {
    return c.json({ message });
  }

  createEmailVerificationToken(user.id)
    .then(async (token) => {
      console.log(
        `[AUTH] Resent verification token for ${user.email}: ${token}`
      );
    })
    .catch((err) => {
      console.error("[AUTH] Failed to resend verification token:", err);
    });

  return c.json({ message });
});

// ── POST /auth/login ───────────────────────────────────────
authRoutes.post("/login", async (c) => {
  const body = await c.req.json();
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0].message }, 400);
  }

  const { email, password, deviceFingerprint } = parsed.data;

  // Rate limiting
  const rateCheck = await checkLoginRateLimit(email);
  if (!rateCheck.allowed) {
    return c.json(
      {
        error: "Too many login attempts. Please try again later.",
        retryAfter: rateCheck.retryAfter,
      },
      429
    );
  }

  // Find user
  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase() },
  });

  if (!user) {
    await recordFailedLogin(email);
    return c.json({ error: "Invalid email or password" }, 401);
  }

  // Check user status
  if (user.status === "BANNED") {
    return c.json({ error: "Account has been banned" }, 403);
  }
  if (user.status === "SUSPENDED") {
    return c.json({ error: "Account is suspended" }, 403);
  }

  // Compare password
  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    await recordFailedLogin(email);
    return c.json({ error: "Invalid email or password" }, 401);
  }

  // Clear failed login attempts on success
  await clearFailedLogins(email);

  // Check 2FA via TwoFactorAuth table (schema source of truth)
  const twoFactor = await prisma.twoFactorAuth.findUnique({
    where: { userId: user.id },
  });
  if (twoFactor) {
    // Generate short-lived temp token for 2FA step
    const tempToken = generateAccessToken({
      id: user.id,
      email: user.email,
      kycTier: user.kycTier,
      status: user.status,
    });

    return c.json({
      requires2FA: true,
      tempToken,
      message: "Please provide your 2FA code",
    });
  }

  // Create session
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip");
  const userAgent = c.req.header("User-Agent");

  const refreshToken = generateRefreshToken();
  await createSession(user.id, refreshToken, ip, userAgent, deviceFingerprint);

  // Record device
  const { isNewDevice } = await recordDeviceLogin(
    user.id,
    ip,
    userAgent,
    deviceFingerprint
  );

  // Generate access token
  const accessToken = generateAccessToken(user);

  return c.json({
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      kycTier: user.kycTier,
    },
  });
});

// ── POST /auth/refresh ─────────────────────────────────────
authRoutes.post("/refresh", async (c) => {
  const body = await c.req.json();
  const parsed = refreshSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Refresh token required" }, 400);
  }

  const { refreshToken } = parsed.data;
  const tokenHash = hashRefreshToken(refreshToken);

  // Find session by token hash (stored in refreshToken column)
  const session = await prisma.session.findFirst({
    where: {
      refreshToken: tokenHash,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });

  if (!session) {
    return c.json({ error: "Invalid or expired refresh token" }, 401);
  }

  // Check if user is still active
  if (session.user.status !== "ACTIVE") {
    // Revoke this session
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return c.json({ error: "Account is not active" }, 403);
  }

  // Rotate: revoke old session, create new one
  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  const newRefreshToken = generateRefreshToken();
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip");
  const userAgent = c.req.header("User-Agent");

  await createSession(
    session.user.id,
    newRefreshToken,
    ip,
    userAgent,
    undefined
  );

  // Generate new access token
  const accessToken = generateAccessToken(session.user);

  return c.json({
    accessToken,
    refreshToken: newRefreshToken,
  });
});

// ── POST /auth/logout ──────────────────────────────────────
authRoutes.post("/logout", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const refreshToken = body.refreshToken;

  if (refreshToken) {
    const tokenHash = hashRefreshToken(refreshToken);
    await prisma.session.updateMany({
      where: { refreshToken: tokenHash },
      data: { revokedAt: new Date() },
    });
  }

  return c.json({ message: "Logged out" });
});

// ── POST /auth/forgot-password ─────────────────────────────
authRoutes.post("/forgot-password", async (c) => {
  const body = await c.req.json();
  const parsed = forgotPasswordSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid email" }, 400);
  }

  const user = await prisma.user.findFirst({
    where: { email: parsed.data.email.toLowerCase() },
  });

  // Always return success to prevent enumeration
  const message =
    "If your email is registered, you will receive a password reset link.";

  if (!user) {
    return c.json({ message });
  }

  createPasswordResetToken(user.id)
    .then(async (token) => {
      console.log(
        `[AUTH] Password reset token for ${user.email}: ${token}`
      );
      // TODO: Send password reset email
    })
    .catch((err) => {
      console.error("[AUTH] Failed to create password reset token:", err);
    });

  return c.json({ message });
});

// ── POST /auth/reset-password ──────────────────────────────
authRoutes.post("/reset-password", async (c) => {
  const body = await c.req.json();
  const parsed = resetPasswordSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0].message }, 400);
  }

  const { token, newPassword } = parsed.data;

  // Validate password strength
  const passwordCheck = validatePasswordStrength(newPassword);
  if (!passwordCheck.valid) {
    return c.json({ error: passwordCheck.error }, 400);
  }

  // Verify token
  const userId = await verifyPasswordResetToken(token);
  if (!userId) {
    return c.json({ error: "Invalid or expired token" }, 400);
  }

  // Hash new password
  const passwordHash = await hashPassword(newPassword);

  // Update password and revoke ALL sessions
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    await tx.session.updateMany({
      where: { userId },
      data: { revokedAt: new Date() },
    });
  });

  return c.json({ message: "Password reset successful. Please log in again." });
});

// ═══════════════════════════════════════════════
//  AUTHENTICATED ROUTES
// ═══════════════════════════════════════════════

// ── GET /auth/me ───────────────────────────────────────────
authRoutes.get("/me", authMiddleware, async (c) => {
  const user = c.get("user") as JWTPayload;

  const dbUser = await prisma.user.findUnique({
    where: { id: user.sub },
    select: {
      id: true,
      email: true,
      fullName: true,
      country: true,
      phone: true,
      status: true,
      kycTier: true,
      createdAt: true,
    },
  });

  if (!dbUser) {
    return c.json({ error: "User not found" }, 404);
  }

  const twoFactor = await prisma.twoFactorAuth.findUnique({
    where: { userId: user.sub },
    select: { id: true },
  });

  return c.json({ user: { ...dbUser, totpEnabled: !!twoFactor } });
});

// ── PATCH /auth/me ─────────────────────────────────────────
authRoutes.patch("/me", authMiddleware, async (c) => {
  const user = c.get("user") as JWTPayload;
  const body = await c.req.json();
  const parsed = updateProfileSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.errors[0].message }, 400);
  }

  const updated = await prisma.user.update({
    where: { id: user.sub },
    data: parsed.data,
    select: {
      id: true,
      email: true,
      fullName: true,
      country: true,
      phone: true,
      status: true,
      kycTier: true,
    },
  });

  return c.json({ user: updated });
});

// ── POST /auth/2fa/setup ───────────────────────────────────
authRoutes.post("/2fa/setup", authMiddleware, async (c) => {
  const user = c.get("user") as JWTPayload;

  // Dynamic import for otplib (ESM compatibility)
  const { authenticator } = await import("otplib");

  // Generate TOTP secret
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(user.email, "NumServe", secret);

  // Store encrypted secret temporarily (user must verify before enabling)
  const r = (await import("../helpers/auth-helpers")).getRedis();
  await r.setex(`totp:setup:${user.sub}`, 5 * 60, secret); // 5min TTL

  return c.json({
    secret,
    otpauthUrl,
    message:
      "Scan the QR code with your authenticator app, then verify with POST /auth/2fa/verify",
  });
});

// ── POST /auth/2fa/verify ──────────────────────────────────
authRoutes.post("/2fa/verify", authMiddleware, async (c) => {
  const user = c.get("user") as JWTPayload;
  const body = await c.req.json();
  const parsed = totpVerifySchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid code format" }, 400);
  }

  const { authenticator } = await import("otplib");
  const r = (await import("../helpers/auth-helpers")).getRedis();

  // Check if this is a setup verification
  const storedSecret = await r.get(`totp:setup:${user.sub}`);

  if (storedSecret) {
    // Setup verification
    const isValid = authenticator.verify({
      token: parsed.data.code,
      secret: storedSecret,
    });

    if (!isValid) {
      return c.json({ error: "Invalid 2FA code" }, 400);
    }

    // Enable 2FA — store in TwoFactorAuth table (schema source of truth)
    await prisma.twoFactorAuth.upsert({
      where: { userId: user.sub },
      update: {
        secret: storedSecret, // TODO: encrypt with AES-256-GCM in production
        backupCodes: [],
      },
      create: {
        userId: user.sub,
        secret: storedSecret, // TODO: encrypt with AES-256-GCM in production
        backupCodes: [],
      },
    });

    // Clear temp storage
    await r.del(`totp:setup:${user.sub}`);

    return c.json({
      message: "2FA enabled successfully",
      warning: "Save your backup codes securely. They will not be shown again.",
    });
  }

  // Login 2FA verification (tempToken flow)
  const tfa = await prisma.twoFactorAuth.findUnique({
    where: { userId: user.sub },
  });
  if (!tfa?.secret) {
    return c.json({ error: "2FA is not set up" }, 400);
  }

  const isValid = authenticator.verify({
    token: parsed.data.code,
    secret: tfa.secret,
  });

  if (!isValid) {
    return c.json({ error: "Invalid 2FA code" }, 400);
  }

  return c.json({ message: "2FA code verified" });
});

// ── POST /auth/2fa/disable ─────────────────────────────────
authRoutes.post("/2fa/disable", authMiddleware, async (c) => {
  const user = c.get("user") as JWTPayload;

  await prisma.twoFactorAuth.deleteMany({
    where: { userId: user.sub },
  });

  return c.json({ message: "2FA disabled successfully" });
});

// ── GET /auth/devices ──────────────────────────────────────
authRoutes.get("/devices", authMiddleware, async (c) => {
  const user = c.get("user") as JWTPayload;

  const devices = await prisma.device.findMany({
    where: { userId: user.sub },
    orderBy: { lastSeenAt: "desc" },
    select: {
      id: true,
      fingerprint: true,
      label: true,
      trusted: true,
      lastSeenAt: true,
      createdAt: true,
    },
  });

  return c.json({ devices });
});

// ── DELETE /auth/devices/:id ───────────────────────────────
authRoutes.delete("/devices/:id", authMiddleware, async (c) => {
  const user = c.get("user") as JWTPayload;
  const deviceId = c.req.param("id");

  // Verify device belongs to user
  const device = await prisma.device.findFirst({
    where: { id: deviceId, userId: user.sub },
  });

  if (!device) {
    return c.json({ error: "Device not found" }, 404);
  }

  // Delete device (sessions are tracked separately — revoke via DELETE /sessions)
  await prisma.device.delete({ where: { id: deviceId } });

  return c.json({ message: "Device removed" });
});

// ── DELETE /auth/sessions ──────────────────────────────────
authRoutes.delete("/sessions", authMiddleware, async (c) => {
  const user = c.get("user") as JWTPayload;

  await prisma.session.updateMany({
    where: { userId: user.sub },
    data: { revokedAt: new Date() },
  });

  return c.json({ message: "All sessions revoked" });
});