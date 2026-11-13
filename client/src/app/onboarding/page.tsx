"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GraduationCap, BookOpen, Loader2 } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { onboardService, switchRoleService } from "@/app/auth/auth.service";
import { cn } from "@/lib/utils";

const choices = [
  { role: "student" as const, title: "I am a student", desc: "Take exams and assignments.", icon: GraduationCap },
  { role: "teacher" as const, title: "I am a teacher", desc: "Create exams and assignments.", icon: BookOpen },
];

// Where everyone lands after signing in: they choose the student side or the teacher side. For a brand-new account this
// is also the first-time question (saved once); for everyone else it is a switch. Signing in itself is handled by Clerk.
// They can switch between the two at any time from the sidebar too.
export default function OnboardingPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const setUser = useAuthStore((state) => state.setUser);
  const [saving, setSaving] = useState<"student" | "teacher" | null>(null);

  useEffect(() => {
    if (isInitialized && !user) router.replace("/auth/login");
  }, [user, isInitialized, router]);

  const choose = async (role: "student" | "teacher") => {
    // Already on that side: nothing to save, just go.
    if (user?.onboarded && user.role === role) {
      router.replace(`/${role}`);
      return;
    }
    setSaving(role);
    try {
      const response = user?.onboarded ? await switchRoleService(role) : await onboardService(role);
      setUser(response.data);
      router.replace(`/${role}`);
    } catch (error: any) {
      toast.error(error.message || "Could not save your choice");
      setSaving(null);
    }
  };

  if (!isInitialized || !user) return null;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#050505] px-4 py-10 font-sans text-white">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Abhyas</h1>
          <p className="text-sm text-gray-400">Choose how you want to use Abhyas. You can switch between student and teacher any time from the sidebar.</p>
        </div>

        <div className="space-y-3">
          {choices.map(({ role, title, desc, icon: Icon }) => (
            <button
              key={role}
              type="button"
              disabled={saving !== null}
              onClick={() => choose(role)}
              className={cn(
                "flex w-full items-center gap-4 rounded-2xl border bg-[#0f0f11] px-5 py-4 text-left transition-colors",
                "hover:border-orange-500/60 hover:bg-white/[0.03] disabled:opacity-60",
                user.onboarded && user.role === role ? "border-orange-500/40" : "border-white/10"
              )}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-600/15 text-orange-400">
                {saving === role ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-semibold">{title}</span>
                <span className="block text-sm text-gray-400">{desc}</span>
              </span>
              {user.onboarded && user.role === role && (
                <span className="shrink-0 rounded-full bg-orange-600/15 px-2.5 py-1 text-[11px] font-medium text-orange-300">Last used</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
