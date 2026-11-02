"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';

import { loginService, verifyOtpService, resendOtpService } from '../auth.service';
import { useAuthStore } from '@/store/authStore';

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const setUser = useAuthStore(state => state.setUser);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Verification step state (for accounts that registered but never verified)
  const [step, setStep] = useState<'LOGIN' | 'VERIFY'>('LOGIN');
  const [pendingEmail, setPendingEmail] = useState('');
  const [verifyOtp, setVerifyOtp] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const startCooldown = () => setResendCooldown(30);

  const onSubmit = async (data: LoginFormValues) => {
    setIsLoading(true);
    try {
      const response = await loginService(data);

      const userData = response.data?.user || response.data;
      const token = response.data?.accessToken || response.accessToken;

      setUser(userData, token);
      toast.success("Successfully logged in");

      router.push(userData?.role === "teacher" ? '/teacher' : '/student');
    } catch (error: any) {
      const msg = error.message || "";
      if (/verify your email/i.test(msg)) {
        // Account exists but is not verified — take the user to OTP verification
        setPendingEmail(data.email);
        setStep('VERIFY');
        try {
          await resendOtpService(data.email);
          startCooldown();
          toast.info("We've sent a verification code to your email.");
        } catch (e: any) {
          toast.error(e.message || "Failed to send verification code");
        }
      } else {
        toast.error(error.message || "Failed to login. Please check your credentials.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const onVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verifyOtp.length !== 6) {
      toast.error("Please enter the 6-digit code");
      return;
    }
    setIsVerifying(true);
    try {
      await verifyOtpService({ email: pendingEmail, otp: verifyOtp });
      toast.success("Email verified! You can now sign in.");
      setStep('LOGIN');
      setVerifyOtp('');
    } catch (error: any) {
      toast.error(error.message || "Verification failed. Please check your code.");
    } finally {
      setIsVerifying(false);
    }
  };

  const onResend = async () => {
    if (resendCooldown > 0) return;
    setIsResending(true);
    try {
      await resendOtpService(pendingEmail);
      startCooldown();
      toast.success("A new verification code has been sent to your email.");
    } catch (error: any) {
      toast.error(error.message || "Failed to resend code");
    } finally {
      setIsResending(false);
    }
  };

  if (step === 'VERIFY') {
    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex flex-col space-y-6"
      >
        <div className="text-center">
          <h2 className="text-xl font-semibold text-white">Verify Your Email</h2>
          <p className="text-sm text-gray-400 mt-1">
            Your account needs to be verified. We sent a 6-digit code to{' '}
            <span className="text-white font-medium">{pendingEmail}</span>
          </p>
        </div>

        <form onSubmit={onVerify} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="otp" className="text-xs font-medium text-gray-300 ml-1">Verification Code</label>
            <input
              id="otp"
              type="text"
              maxLength={6}
              placeholder="123456"
              value={verifyOtp}
              onChange={(e) => setVerifyOtp(e.target.value.replace(/\D/g, ""))}
              className="w-full py-3 text-white placeholder:text-zinc-400 transition-all text-center text-2xl tracking-widest font-semibold rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:border-b-2 focus:outline-none focus:ring-0"
            />
          </div>

          <button
            type="submit"
            disabled={isVerifying}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl px-4 py-3 transition-all active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100 mt-2"
          >
            {isVerifying ? "Verifying..." : "Verify & Continue"}
          </button>
        </form>

        <div className="text-center text-sm text-gray-400">
          Didn't receive the code?{' '}
          <button
            onClick={onResend}
            disabled={isResending || resendCooldown > 0}
            className="text-orange-400 font-semibold hover:text-orange-300 hover:underline transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isResending
              ? "Sending..."
              : resendCooldown > 0
                ? `Resend in ${resendCooldown}s`
                : "Resend Code"}
          </button>
        </div>

        <div className="text-center text-sm text-gray-400">
          <button
            onClick={() => setStep('LOGIN')}
            className="inline-flex items-center gap-1.5 text-gray-400 hover:text-orange-400 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Sign In
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col space-y-6"
    >
      <div className="text-center">
        <h2 className="text-xl font-semibold text-white">Welcome Back</h2>
        <p className="text-sm text-gray-400 mt-1">Sign in to your account to continue</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-xs font-medium text-gray-300 ml-1">Institutional Email</label>
          <input
            id="email"
            type="email"
            placeholder="name@university.edu"
            className="w-full py-3 text-white placeholder:text-zinc-400 transition-all rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:border-b-2 focus:outline-none focus:ring-0"
            {...register('email')}
          />
          {errors.email && (
            <p className="text-xs text-red-400 ml-1">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between ml-1">
            <label htmlFor="password" className="text-xs font-medium text-gray-300">Password</label>
            <Link href="/auth/forgot-password" className="text-xs text-gray-400 hover:text-orange-400 hover:underline transition-colors">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              className="w-full py-3 text-white placeholder:text-zinc-400 transition-all pr-12 rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:border-b-2 focus:outline-none focus:ring-0"
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors flex items-center justify-center"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {errors.password && (
            <p className="text-xs text-red-400 ml-1">{errors.password.message}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl px-4 py-3 transition-all active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100 mt-2"
        >
          {isLoading ? (
            <div className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Signing in...
            </div>
          ) : "Sign In"}
        </button>
      </form>

      <div className="text-center text-sm text-gray-400">
        Don't have an account?{' '}
        <Link href="/auth/register" className="text-orange-400 font-semibold hover:text-orange-300 hover:underline transition-colors">
          Create one now
        </Link>
      </div>
    </motion.div>
  );
}