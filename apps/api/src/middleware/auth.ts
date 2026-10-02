import { Context, Next } from "hono";
import jwt from "jsonwebtoken";
import { env } from "@numserve/config";

// ─────────────────────────────────────────────
// JWT Auth Middleware for Hono
// Verifies RS256 access tokens and attaches
// the decoded payload to context variables.
// ─────────────────────────────────────────────

export interface JWTPayload {
  sub: string;
  email: string;
  kycTier: string;
  status: string;
  iat: number;
  exp: number;
}

/**
 * Protected route middleware — verifies the JWT access token.
 * Attaches decoded payload to c.var.user on success.
 */
export async function authMiddleware(
  c: Context<{ Variables: { user: JWTPayload } }>,
  next: Next
) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const publicKey = env().JWT_PUBLIC_KEY?.replace(/\\n/g, "\n") || "";
    const payload = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
    }) as JWTPayload;

    // Reject suspended/banned users mid-session
    if (payload.status !== "ACTIVE") {
      return c.json({ error: "Account suspended" }, 403);
    }

    // Attach user payload to context
    c.set("user", payload);

    return next();
  } catch (e: any) {
    if (e.name === "TokenExpiredError") {
      return c.json({ error: "Token expired" }, 401);
    }
    return c.json({ error: "Invalid token" }, 401);
  }
}