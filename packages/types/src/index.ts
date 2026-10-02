// ─────────────────────────────────────────────
// Shared TypeScript types for the NumServ monorepo
// ─────────────────────────────────────────────

// ─── API Responses ────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: PaginationMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ─── Auth Types ───────────────────────────────

export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
  phone?: string;
  country: string;
  referralCode?: string;
  turnstileToken: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  deviceFingerprint: string;
  turnstileToken: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  country: string;
  status: string;
  kycTier: string;
}

export interface SessionInfo {
  id: string;
  deviceLabel?: string;
  ipAddress: string;
  lastSeenAt: string;
  createdAt: string;
}

// ─── Wallet Types ─────────────────────────────

export interface WalletBalance {
  balance: number;
  currency: string;
}

export interface FundWalletRequest {
  amount: number;
  currency: string;
  provider: "PAYSTACK" | "STRIPE";
  callbackUrl?: string;
}

export interface FundingOrderResponse {
  orderId: string;
  authorizationUrl: string;
  reference: string;
}

export interface WalletTransaction {
  id: string;
  type: "CREDIT" | "DEBIT" | "REFUND" | "BONUS";
  status: "PENDING" | "COMPLETED" | "FAILED" | "REVERSED";
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description: string;
  referenceId?: string;
  createdAt: string;
}

// ─── Number Types ─────────────────────────────

export interface NumberListingRequest {
  countryCode: string;
  service: string;
}

export interface NumberListing {
  numberId: string;
  number: string;
  countryCode: string;
  provider: string;
  type: "TEMPORARY" | "LONG_TERM";
  priceUsd: number;
  successRate: number;
  estimatedDeliveryMs: number;
}

export interface PurchaseNumberRequest {
  numberId: string;
}

export interface PurchaseNumberResponse {
  assignmentId: string;
  number: string;
  expiresAt: string;
  serviceSlug: string;
}

export interface AssignmentDetail {
  assignmentId: string;
  number: string;
  serviceSlug: string;
  status: "ACTIVE" | "OTP_RECEIVED" | "EXPIRED" | "CANCELLED";
  otpCode?: string;
  otpReceivedAt?: string;
  expiresAt: string;
  createdAt: string;
}

// ─── Admin Types ──────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  country: string;
  status: string;
  kycTier: string;
  createdAt: string;
  walletBalance: number;
  totalAssignments: number;
}

export interface AdminDashboardStats {
  totalUsers: number;
  activeUsers: number;
  totalRevenue: number;
  totalAssignments: number;
  pendingKYC: number;
  flaggedUsers: number;
}

// ─── Fraud Types ──────────────────────────────

export interface FraudEvent {
  id: string;
  userId: string;
  eventType: string;
  score: number;
  metadata: Record<string, unknown>;
  action?: string;
  createdAt: string;
}

// ─── Provider Types ───────────────────────────

export interface ProviderHealth {
  providerId: string;
  name: string;
  status: "ACTIVE" | "DEGRADED" | "OFFLINE";
  successRate: number;
  avgDeliveryMs: number | null;
  lastHealthCheck: string | null;
}