"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound } from "lucide-react";
import { AI_KEY_CHANGED_EVENT, AiKeyStatus, getAiKeyStatusService } from "@/services/aiKey.service";

// A thin notice at the top of every teacher page while there is no working OpenAI key, so nobody finds out only when an
// AI feature fails. Hidden on the AI key page itself, and when the site pays for AI (no key needed).
export function AiKeyBanner() {
  const pathname = usePathname();
  const [status, setStatus] = useState<AiKeyStatus | null>(null);

  const load = useCallback(() => {
    getAiKeyStatusService()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(AI_KEY_CHANGED_EVENT, load);
    return () => window.removeEventListener(AI_KEY_CHANGED_EVENT, load);
  }, [load]);

  if (!status || status.mode !== "byok" || pathname === "/teacher/ai-key") return null;
  if (status.hasKey && status.status === "valid") return null;

  const rejected = status.hasKey && status.status === "invalid";
  return (
    <div className="shrink-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-orange-500/30 bg-orange-500/10 px-4 py-2.5 text-sm text-orange-100">
      <p className="flex min-w-0 items-center gap-2">
        <KeyRound className="h-4 w-4 shrink-0 text-orange-400" />
        {rejected ? "OpenAI rejected your API key, so AI features are paused." : "Add your OpenAI API key to use AI features."}
      </p>
      <Link href="/teacher/ai-key" className="shrink-0 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700">
        {rejected ? "Update key" : "Add key"}
      </Link>
    </div>
  );
}
