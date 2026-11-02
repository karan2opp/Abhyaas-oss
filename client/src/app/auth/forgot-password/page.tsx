"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

import { forgotPasswordService, resetPasswordService } from '../auth.service';

const emailSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

const resetSchema = z.object({
  otp: z.string().length(6, "OTP must be exactly 6 digits").regex(/^\d+$/, "OTP must contain only numbers"),
  password: z.string().min(8, "Password must be at least 8 characters").regex(/(?=.*[A-Z])/, "Password must contain at least one uppercase letter").regex(/(?=.*\d)/, "Password must contain at least one number"),
});

type EmailFormValues = z.infer<typeof emailSchema>;
type ResetFormValues = z.infer<typeof resetSchema>;

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('step') === '2') {
      setStep(2);
      setEmail(params.get('email') || "");
    }
  }, []);

  const {
    register: registerEmail,
    handleSubmit: handleEmailSubmit,
    formState: { errors: emailErrors },
  } = useForm<EmailFormValues>({
    resolver: zodResolver(emailSchema),
  });

  const {
    register: registerReset,
    handleSubmit: handleResetSubmit,
    formState: { errors: resetErrors },
  } = useForm<ResetFormValues>({
    resolver: zodResolver(resetSchema),
  });

  const onEmailSubmit = async (data: EmailFormValues) => {
    setIsLoading(true);
    try {
      await forgotPasswordService(data.email);
      setEmail(data.email);
      setStep(2);
      toast.success("OTP sent to your email");
    } catch (error: any) {
      toast.error(error.message || "Failed to send reset email");
    } finally {
      setIsLoading(false);
    }
  };

  const onResetSubmit = async (data: ResetFormValues) => {
    setIsLoading(true);
    try {
      await resetPasswordService(email, data.otp, data.password);
      toast.success("Password reset successfully. Please log in.");
      router.push("/auth/login");
    } catch (error: any) {
      toast.error(error.message || "Failed to reset password");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col space-y-6">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white">Reset Password</h2>
        <p className="text-sm text-gray-400 mt-1">
          {step === 1 ? "Enter your email to receive a reset OTP" : "Enter the OTP sent to your email and your new password"}
        </p>
      </div>

      <AnimatePresence mode="wait">
        {step === 1 ? (
          <motion.form 
            key="step1"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            onSubmit={handleEmailSubmit(onEmailSubmit)} 
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-medium text-gray-300 ml-1">Institutional Email</label>
              <input 
                id="email" 
                type="email" 
                placeholder="name@university.edu" 
                className="w-full py-3 text-white placeholder:text-zinc-400 transition-all rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:border-b-2 focus:outline-none focus:ring-0"
                {...registerEmail('email')}
              />
              {emailErrors.email && (
                <p className="text-xs text-red-400 ml-1">{emailErrors.email.message}</p>
              )}
            </div>
            
            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl px-4 py-3 transition-all active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100 mt-2"
            >
              {isLoading ? "Sending OTP..." : "Send OTP"}
            </button>
          </motion.form>
        ) : (
          <motion.form 
            key="step2"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            onSubmit={handleResetSubmit(onResetSubmit)} 
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <label htmlFor="otp" className="text-xs font-medium text-gray-300 ml-1">6-Digit OTP</label>
              <input 
                id="otp" 
                type="text" 
                placeholder="123456" 
                maxLength={6}
                className="w-full py-3 text-white placeholder:text-zinc-400 transition-all text-center tracking-[0.5em] text-lg font-semibold rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:border-b-2 focus:outline-none focus:ring-0"
                {...registerReset('otp')}
              />
              {resetErrors.otp && (
                <p className="text-xs text-red-400 ml-1">{resetErrors.otp.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-gray-300 ml-1">New Password</label>
              <input 
                id="password" 
                type="password" 
                placeholder="••••••••" 
                className="w-full py-3 text-white placeholder:text-zinc-400 transition-all rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:border-b-2 focus:outline-none focus:ring-0"
                {...registerReset('password')}
              />
              {resetErrors.password && (
                <p className="text-xs text-red-400 ml-1">{resetErrors.password.message}</p>
              )}
            </div>
            
            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl px-4 py-3 transition-all active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100 mt-2"
            >
              {isLoading ? "Resetting Password..." : "Reset Password"}
            </button>
            <button 
              type="button" 
              onClick={() => setStep(1)}
              disabled={isLoading}
              className="w-full bg-transparent text-gray-400 hover:text-orange-400 font-semibold rounded-xl px-4 py-3 transition-all text-sm mt-2"
            >
              Back to Email
            </button>
          </motion.form>
        )}
      </AnimatePresence>

      <div className="text-center text-sm text-gray-400">
        Remember your password?{' '}
        <Link href="/auth/login" className="text-orange-400 font-semibold hover:text-orange-300 hover:underline transition-colors">
          Sign In
        </Link>
      </div>
    </div>
  );
}
