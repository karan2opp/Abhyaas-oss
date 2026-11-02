"use client";

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore(state => state.user);
  const isInitialized = useAuthStore(state => state.isInitialized);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isInitialized && user && pathname !== '/auth/forgot-password') {
      router.replace(`/${user.role}`);
    }
  }, [isInitialized, user, router, pathname]);

  if (!mounted || (isInitialized && user && pathname !== '/auth/forgot-password')) return null;

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#050505] relative overflow-hidden font-sans">

      {/* Sleek Black Grid Background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#18181b_1px,transparent_1px),linear-gradient(to_bottom,#18181b_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_20%,transparent_100%)] opacity-30 pointer-events-none"></div>

      {/* Orange Spotlight Effects */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-orange-500/10 blur-[120px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-0 -left-20 w-[400px] h-[400px] bg-orange-600/10 blur-[120px] rounded-full pointer-events-none"></div>
      <div className="absolute top-1/3 -right-20 w-[350px] h-[350px] bg-amber-500/5 blur-[120px] rounded-full pointer-events-none"></div>

      <div className="relative z-10 w-full max-w-md p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="bg-[#0f0f11] border border-white/10 rounded-2xl p-5 sm:p-8 shadow-2xl shadow-black/60 relative overflow-hidden"
        >
          {/* Logo / Header inside the card */}
          <div className="flex flex-col items-center justify-center mb-8">
            <div className="w-14 h-14 bg-orange-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-orange-950/60 font-extrabold text-2xl text-white">
              A
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Abhyas</h1>
            <p className="text-sm text-gray-400 mt-1">Institutional Exam Platform</p>
          </div>

          {children}

        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center text-xs text-gray-600 mt-6"
        >
          &copy; {new Date().getFullYear()} Abhyas. All rights reserved.
        </motion.p>
      </div>
    </div>
  );
}