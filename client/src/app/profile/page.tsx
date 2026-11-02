"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { Loader2 } from 'lucide-react';

export default function ProfileRedirect() {
  const router = useRouter();
  const user = useAuthStore(state => state.user);

  useEffect(() => {
    if (user) {
      router.replace(`/${user.role}/profile`);
    } else {
      router.replace('/auth/login');
    }
  }, [user, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#14151f] border-white/15 text-white placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30 text-white">
      <Loader2 className="w-8 h-8 animate-spin" />
    </div>
  );
}
