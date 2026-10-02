import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "@numserve/config";
import { prisma } from "@numserve/db";
import { authRoutes } from "./routes/auth";
import { walletRoutes } from "./routes/wallet";
import { webhookRoutes } from "./routes/webhooks";

const app = new Hono();

// ── Global middleware ──────────────────────────────────────
app.use("*", logger());
const e = env();
app.use("*", cors({
  origin: e.CORS_ORIGINS?.split(",") || ["http://localhost:3000"],
  credentials: true,
}));

// ── Health check ───────────────────────────────────────────
app.get("/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));

// ── Mount routes ───────────────────────────────────────────
app.route("/auth", authRoutes);
app.route("/wallet", walletRoutes);
app.route("/webhooks", webhookRoutes);

// ── 404 fallback ───────────────────────────────────────────
app.notFound((c) => c.json({ error: "Not found" }, 404));

// ── Global error handler ───────────────────────────────────
app.onError((err, c) => {
  console.error("[API ERROR]", err);
  return c.json({ error: "Internal server error" }, 500);
});

// ── Start server ───────────────────────────────────────────
const port = e.PORT || 3001;

console.log(`[API] Starting on port ${port}`);

serve({
  fetch: app.fetch,
  port: Number(port),
});

console.log(`[API] Server running at http://localhost:${port}`);