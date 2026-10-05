// ─────────────────────────────────────────────
// Provider adapter contract — real providers only.
// No mocks, no synthetic numbers. If no provider
// can serve, throw NO_PROVIDER_AVAILABLE.
// ─────────────────────────────────────────────

export interface ProviderHealthResult {
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

export interface ProviderNumber {
  providerNumberId: string;
  number: string;
  countryCode: string;
}

export interface ActivationResult {
  activationId: string;
  number: string;
  expiresAt: Date;
}

export type SMSPollStatus = "PENDING" | "RECEIVED" | "CANCELLED" | "EXPIRED";

export interface SMSPollResult {
  status: SMSPollStatus;
  code?: string;
  rawMessage?: string;
}

export interface ProviderPrice {
  priceUsd: number;
  currency: string;
}

export interface ProviderAdapter {
  name: string;

  healthCheck(): Promise<ProviderHealthResult>;

  getAvailableNumbers(
    countryCode: string,
    serviceSlug: string
  ): Promise<ProviderNumber[]>;

  activateNumber(
    providerNumberId: string,
    serviceSlug: string,
    countryCode: string
  ): Promise<ActivationResult>;

  pollSMS(activationId: string): Promise<SMSPollResult>;

  cancelActivation(activationId: string): Promise<void>;

  getPricing(countryCode: string, serviceSlug: string): Promise<ProviderPrice>;
}
