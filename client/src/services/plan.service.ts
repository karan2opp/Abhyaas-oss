import api from "@/utils/axios";

export interface Plan {
  id: string;
  name: string;
  description: string;
  // In paise (₹149 is 14900). 0 for the free plan, null when there is no fixed price.
  pricePaise: number | null;
  currency: string;
  // How long a purchase lasts; null means it doesn't expire.
  durationDays: number | null;
  questionGenerationLimit: number | null;
  aiGradingLimit: number | null;
  features: string[];
  isContactOnly: boolean;
  isPublic: boolean;
  sortOrder: number;
}

export interface UsageOfLimit {
  used: number;
  // The plan's limit; null means no fixed limit, 0 means not included.
  limit: number | null;
}

export interface CurrentPlan {
  plan: Plan | null;
  usage: { question_generation: UsageOfLimit; ai_grading: UsageOfLimit };
  startsAt: string | null;
  expiresAt: string | null;
  // True when the person has bought nothing and is simply on the free plan.
  isDefault: boolean;
}

export const listPlansService = async (): Promise<Plan[]> => {
  const res = await api.get("/plans");
  return res.data.data;
};

export const getMyPlanService = async (): Promise<CurrentPlan> => {
  const res = await api.get("/plans/me");
  return res.data.data;
};

/**
 * Starts buying a plan: asks our server to create the order, then opens Cashfree's payment page in this tab. When the
 * person finishes (or gives up) Cashfree sends them to /payment/status, which waits for the server to confirm the payment.
 * Nothing is granted here: the plan only appears once Cashfree has told our server the payment went through.
 *
 * `phone` is only needed when the account has no phone number saved (Cashfree requires one for the payer).
 */
export const startCheckout = async (planId: string, phone?: string): Promise<void> => {
  const res = await api.post("/payments/orders", { planId, ...(phone ? { phone } : {}) });
  const { paymentSessionId, environment } = res.data.data as { orderId: string; paymentSessionId: string; environment: "sandbox" | "production" };

  // Loaded only when someone actually buys, so it isn't part of every page.
  const { load } = await import("@cashfreepayments/cashfree-js");
  const cashfree = await load({ mode: environment === "production" ? "production" : "sandbox" });
  if (!cashfree) throw new Error("Could not load the payment page. Check your connection and try again.");
  await cashfree.checkout({ paymentSessionId, redirectTarget: "_self" });
};

export interface PaymentOrderStatus {
  orderId: string;
  // "created" = still waiting for the payment to be confirmed.
  status: "created" | "paid" | "failed";
  planId: string;
}

export const getOrderStatusService = async (orderId: string): Promise<PaymentOrderStatus> => {
  const res = await api.get(`/payments/orders/${encodeURIComponent(orderId)}`);
  return res.data.data;
};
