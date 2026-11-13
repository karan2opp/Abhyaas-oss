"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BookOpen, GraduationCap, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { switchRoleService } from "@/app/auth/auth.service";

type Role = "student" | "teacher";

const sides: { role: Role; label: string; icon: typeof GraduationCap }[] = [
  { role: "student", label: "Student", icon: GraduationCap },
  { role: "teacher", label: "Teacher", icon: BookOpen },
];

// Lets anyone move between the student side and the teacher side at any time. The role is saved on the account, so it is
// remembered next time, and nothing made on either side is lost when switching.
export function RoleSwitch({ collapsed }: { collapsed: boolean }) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [switchingTo, setSwitchingTo] = useState<Role | null>(null);

  if (!user) return null;

  const switchTo = async (role: Role) => {
    if (role === user.role || switchingTo) return;
    setSwitchingTo(role);
    try {
      const response = await switchRoleService(role);
      setUser(response.data);
      router.push(`/${role}`);
    } catch (error: any) {
      toast.error(error.message || "Could not switch role");
    } finally {
      setSwitchingTo(null);
    }
  };

  // Narrow sidebar: one button that goes to the other side.
  if (collapsed) {
    const other = sides.find((side) => side.role !== user.role)!;
    const Icon = other.icon;
    return (
      <button
        type="button"
        onClick={() => switchTo(other.role)}
        disabled={switchingTo !== null}
        title={`Switch to ${other.label}`}
        aria-label={`Switch to ${other.label}`}
        className="flex w-full items-center justify-center rounded-lg border border-white/10 bg-zinc-900/60 py-2 text-white/70 transition-colors hover:text-white disabled:opacity-60"
      >
        {switchingTo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </button>
    );
  }

  return (
    <div role="group" aria-label="Switch between student and teacher" className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-zinc-900/60 p-1">
      {sides.map(({ role, label, icon: Icon }) => {
        const active = user.role === role;
        return (
          <button
            key={role}
            type="button"
            onClick={() => switchTo(role)}
            disabled={switchingTo !== null}
            aria-pressed={active}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors disabled:opacity-60",
              active ? "bg-orange-600 text-white shadow-md shadow-orange-950/40" : "text-white/60 hover:text-white"
            )}
          >
            {switchingTo === role ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
