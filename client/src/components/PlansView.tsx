"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useAuthStore } from "@/store/authStore";
import { CurrentPlan, Plan, UsageOfLimit, getMyPlanService, listPlansService, startCheckout } from "@/services/plan.service";

const PHONE = /^\d{10}$/;

const formatPrice = (plan: Plan) => {
  if (plan.isContactOnly || plan.pricePaise === null) return "Custom";
  if (plan.pricePaise === 0) return "Free";
  const rupees = plan.pricePaise / 100;
  return `₹${rupees.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
};

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

// One line of "42 of 300 used" with a bar. The bar turns amber when nearly used up and red when it has run out.
function UsageMeter({ label, usage }: { label: string; usage: UsageOfLimit }) {
  const { used, limit } = usage;
  const fraction = limit && limit > 0 ? Math.min(1, used / limit) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-gray-300">{label}</span>
        <span className="shrink-0 tabular-nums text-gray-400">
          {limit === null ? `${used} used, no fixed limit` : limit === 0 ? "Not included" : `${used} of ${limit} used`}
        </span>
      </div>
      {limit !== null && limit > 0 && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={cn("h-full rounded-full transition-all", fraction >= 1 ? "bg-red-500" : fraction >= 0.8 ? "bg-amber-400" : "bg-orange-500")}
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

// What the person has now, and the plans they can buy. The same page for students and teachers: a plan belongs to the
// account, not to the side they are using.
export default function PlansView() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [current, setCurrent] = useState<CurrentPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  // Cashfree needs a phone number for the payer. If the account has none, ask for it before opening the payment page.
  const user = useAuthStore((s) => s.user);
  const [phonePlan, setPhonePlan] = useState<Plan | null>(null);
  const [phone, setPhone] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([listPlansService(), getMyPlanService()])
      .then(([all, mine]) => {
        if (!active) return;
        setPlans(all);
        setCurrent(mine);
      })
      .catch((err: any) => active && setError(err?.response?.data?.message || "Could not load the plans"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const buy = async (plan: Plan, phoneNumber?: string) => {
    setBuying(plan.id);
    try {
      // Opens Cashfree's payment page in this tab; the person comes back to /payment/status afterwards.
      await startCheckout(plan.id, phoneNumber);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Could not start the purchase");
    } finally {
      setBuying(null);
    }
  };

  const choose = async (plan: Plan) => {
    if (plan.isContactOnly) {
      toast.info("Custom plans: contact details are coming soon.");
      return;
    }
    if (!PHONE.test((user?.phone ?? "").trim())) {
      setPhone("");
      setPhonePlan(plan);
      return;
    }
    await buy(plan);
  };

  const submitPhone = async () => {
    if (!phonePlan) return;
    if (!PHONE.test(phone)) {
      toast.error("Enter a 10-digit phone number");
      return;
    }
    const plan = phonePlan;
    setPhonePlan(null);
    await buy(plan, phone);
  };

  return (
    <>
      <PlansContent plans={plans} current={current} loading={loading} error={error} buying={buying} onChoose={choose} />

      <Dialog open={phonePlan !== null} onOpenChange={(open) => !open && setPhonePlan(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Phone number</DialogTitle>
            <DialogDescription>The payment provider needs a 10-digit phone number for the payment. We&apos;ll save it to your account.</DialogDescription>
          </DialogHeader>
          <Input
            type="tel"
            inputMode="numeric"
            autoFocus
            maxLength={10}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && void submitPhone()}
            placeholder="10-digit mobile number"
            className="text-white"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPhonePlan(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitPhone()} className="bg-orange-600 text-white hover:bg-orange-700">
              Continue to payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Only draws the page from the data it is given, so it can be looked at without signing in.
export function PlansContent({
  plans,
  current,
  loading,
  error,
  buying,
  onChoose,
}: {
  plans: Plan[];
  current: CurrentPlan | null;
  loading: boolean;
  error: string | null;
  buying: string | null;
  onChoose: (plan: Plan) => void;
}) {
  const currentPlan = current?.plan ?? null;

  return (
    <div className="min-h-full overflow-y-auto bg-[#050505] p-6 text-white md:p-12">
      <div className="mx-auto max-w-5xl space-y-10">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Plans</h1>
          <p className="mt-1 text-sm text-gray-400">See your current plan and choose a different one.</p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading plans...
          </div>
        ) : error ? (
          <p className="text-sm text-red-300">{error}</p>
        ) : (
          <>
            <section className="space-y-3">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-300">Your plan</h2>
              <div className="rounded-2xl border border-orange-500/30 bg-[#0f0f11] p-5 sm:p-6">
                {currentPlan ? (
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <p className="text-xl font-semibold">{currentPlan.name}</p>
                      <p className="text-sm text-gray-400">
                        {current?.isDefault
                          ? "You haven't bought a plan, so you are on the free plan."
                          : current?.expiresAt
                            ? `Active until ${formatDate(current.expiresAt)}`
                            : "Active, no expiry"}
                      </p>
                    </div>
                    <ul className="space-y-1.5 text-sm text-gray-300">
                      {currentPlan.features.map((line) => (
                        <li key={line} className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">You are on the free plan.</p>
                )}
                {current?.usage && (
                  <div className="mt-5 space-y-4 border-t border-white/10 pt-5">
                    <UsageMeter label="AI-written questions" usage={current.usage.question_generation} />
                    <UsageMeter label="AI-graded answers" usage={current.usage.ai_grading} />
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-300">Available plans</h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {plans.map((plan) => {
                  const isCurrent = currentPlan?.id === plan.id;
                  return (
                    <div
                      key={plan.id}
                      className={cn(
                        "flex flex-col rounded-2xl border bg-[#0f0f11] p-5 sm:p-6",
                        isCurrent ? "border-orange-500/40" : "border-white/10"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-lg font-semibold">{plan.name}</p>
                        {isCurrent && (
                          <span className="shrink-0 rounded-full bg-orange-600/15 px-2.5 py-1 text-[11px] font-medium text-orange-300">Current</span>
                        )}
                      </div>
                      <p className="mt-3 flex items-baseline gap-1.5">
                        <span className="text-3xl font-bold tracking-tight">{formatPrice(plan)}</span>
                        {plan.durationDays && !plan.isContactOnly && <span className="text-sm text-gray-400">for {plan.durationDays} days</span>}
                      </p>
                      <p className="mt-2 text-sm text-gray-400">{plan.description}</p>
                      <ul className="mt-4 flex-1 space-y-2 text-sm text-gray-300">
                        {plan.features.map((line) => (
                          <li key={line} className="flex items-start gap-2">
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
                            {line}
                          </li>
                        ))}
                      </ul>

                      {isCurrent ? (
                        <button type="button" disabled className="mt-5 w-full rounded-xl border border-white/10 py-2.5 text-sm font-semibold text-gray-400">
                          Your current plan
                        </button>
                      ) : plan.pricePaise === 0 ? null : (
                        <button
                          type="button"
                          onClick={() => onChoose(plan)}
                          disabled={buying !== null}
                          className={cn(
                            "mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors disabled:opacity-60",
                            plan.isContactOnly ? "border border-white/15 text-white hover:bg-white/5" : "bg-orange-600 text-white hover:bg-orange-700"
                          )}
                        >
                          {buying === plan.id && <Loader2 className="h-4 w-4 animate-spin" />}
                          {plan.isContactOnly ? "Contact us" : "Purchase"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
