"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { CheckCircle2, Loader2, XCircle, Clock } from "lucide-react";
import { getOrderStatusService } from "@/services/plan.service";
import { useAuthStore } from "@/store/authStore";

// Cashfree sends the person here after they pay (or give up), with ?order_id=... in the address. This page doesn't decide
// whether the payment worked: it asks our server, which only says "paid" once Cashfree has confirmed it (the webhook).
// The confirmation usually arrives within a few seconds, so the page checks every couple of seconds for a while.
const POLL_MS = 2500;
const MAX_CHECKS = 36; // about 90 seconds

type View = "checking" | "paid" | "failed" | "slow" | "error";

function PaymentStatus() {
  const orderId = useSearchParams().get("order_id");
  const { isLoaded, isSignedIn } = useAuth();
  const role = useAuthStore((s) => s.user?.role);
  const [view, setView] = useState<View>("checking");
  const [message, setMessage] = useState("");
  const cancelled = useRef(false);

  const plansHref = role === "teacher" ? "/teacher/plans" : role === "student" ? "/student/plans" : "/";

  const run = useCallback(async () => {
    if (!orderId) {
      setView("error");
      setMessage("This page needs an order. Go back to the plans page and try again.");
      return;
    }
    setView("checking");
    for (let i = 0; i < MAX_CHECKS; i++) {
      if (cancelled.current) return;
      try {
        const order = await getOrderStatusService(orderId);
        if (order.status === "paid") return setView("paid");
        if (order.status === "failed") return setView("failed");
      } catch (err: any) {
        if (cancelled.current) return;
        setView("error");
        setMessage(err?.response?.data?.message || "We couldn't check this payment. Please try again in a moment.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    if (!cancelled.current) setView("slow");
  }, [orderId]);

  useEffect(() => {
    // The sign-in session has to be ready before the server will answer.
    if (!isLoaded || !isSignedIn) return;
    cancelled.current = false;
    void run();
    return () => {
      cancelled.current = true;
    };
  }, [isLoaded, isSignedIn, run]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050505] px-4 text-white">
      <div className="w-full max-w-sm space-y-5 text-center">
        {isLoaded && !isSignedIn ? (
          <>
            <XCircle className="mx-auto h-12 w-12 text-red-400" />
            <h1 className="text-xl font-bold">Please sign in</h1>
            <p className="text-sm text-gray-400">Sign in to see the result of your payment.</p>
            <Link href="/auth/login" className="inline-block rounded-xl bg-orange-600 px-6 py-2.5 text-sm font-semibold hover:bg-orange-700">
              Sign in
            </Link>
          </>
        ) : view === "checking" ? (
          <>
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-orange-400" />
            <h1 className="text-xl font-bold">Confirming your payment</h1>
            <p className="text-sm text-gray-400">This usually takes a few seconds. Please don&apos;t close this page.</p>
          </>
        ) : view === "paid" ? (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
            <h1 className="text-xl font-bold">Payment successful</h1>
            <p className="text-sm text-gray-400">Your plan is active now.</p>
            <Link href={plansHref} className="inline-block rounded-xl bg-orange-600 px-6 py-2.5 text-sm font-semibold hover:bg-orange-700">
              View my plan
            </Link>
          </>
        ) : view === "failed" ? (
          <>
            <XCircle className="mx-auto h-12 w-12 text-red-400" />
            <h1 className="text-xl font-bold">Payment didn&apos;t go through</h1>
            <p className="text-sm text-gray-400">You haven&apos;t been charged for this plan. You can try again.</p>
            <Link href={plansHref} className="inline-block rounded-xl bg-orange-600 px-6 py-2.5 text-sm font-semibold hover:bg-orange-700">
              Back to plans
            </Link>
          </>
        ) : view === "slow" ? (
          <>
            <Clock className="mx-auto h-12 w-12 text-amber-400" />
            <h1 className="text-xl font-bold">Still waiting for confirmation</h1>
            <p className="text-sm text-gray-400">
              We haven&apos;t heard back from the payment provider yet. If money was taken, your plan will be activated as soon as it confirms.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button type="button" onClick={() => void run()} className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-semibold hover:bg-white/5">
                Check again
              </button>
              <Link href={plansHref} className="rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-semibold hover:bg-orange-700">
                Go to plans
              </Link>
            </div>
          </>
        ) : (
          <>
            <XCircle className="mx-auto h-12 w-12 text-red-400" />
            <h1 className="text-xl font-bold">Something went wrong</h1>
            <p className="text-sm text-gray-400">{message}</p>
            <Link href={plansHref} className="inline-block rounded-xl bg-orange-600 px-6 py-2.5 text-sm font-semibold hover:bg-orange-700">
              Back to plans
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function PaymentStatusPage() {
  return (
    <Suspense fallback={null}>
      <PaymentStatus />
    </Suspense>
  );
}
