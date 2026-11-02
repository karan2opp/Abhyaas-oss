"use client";

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

export function UserAvatar({
  name,
  avatarUrl,
  size = "lg",
}: {
  name: string;
  avatarUrl?: string | null;
  size?: "default" | "sm" | "lg";
}) {
  const initial = name?.trim()?.[0]?.toUpperCase() || "?";
  return (
    <Avatar size={size} className="border border-white/10 bg-white/5 shrink-0">
      {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
      <AvatarFallback className="bg-orange-600/20 text-orange-400 font-semibold">{initial}</AvatarFallback>
    </Avatar>
  );
}
