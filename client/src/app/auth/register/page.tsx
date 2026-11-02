"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';

import { registerService, verifyOtpService, resendOtpService, loginService } from '../auth.service';
import { useAuthStore } from '@/store/authStore';

const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["student", "teacher"]),
});

const verifySchema = z.object({
  otp: z.string().length(6, "OTP must be exactly 6 digits").regex(/^\d+$/, "OTP must contain only numbers"),
});

type RegisterFormValues = z.infer<typeof registerSchema>;
type VerifyFormValues = z.infer<typeof verifySchema>;

export default function RegisterPage() {
  const router = useRouter();
  const setUser = useAuthStore(state => state.setUser);
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<'REGISTER' | 'VERIFY'>('REGISTER');
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [registeredPassword, setRegisteredPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setIsResending(true);
    try {
      await resendOtpService(registeredEmail);
      setResendCooldown(30);
      toast.success("A new verification code has been sent to your email.");
    } catch (error: any) {
      toast.error(error.message || "Failed to resend code");
    } finally {
      setIsResending(false);
    }
  };

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { role: "student" },
  });

  const {
    register: registerVerify,
    handleSubmit: handleVerifySubmit,
    formState: { errors: verifyErrors },
  } = useForm<VerifyFormValues>({
    resolver: zodResolver(verifySchema),
  });

  const onSubmit = async (data: RegisterFormValues) => {
    setIsLoading(true);
    try {
      await registerService(data);
      setRegisteredEmail(data.email);
      setRegisteredPassword(data.password);
      setStep('VERIFY');
      toast.success("Registration successful! We've sent a 6-digit code to your email.", { duration: 5000 });
    } catch (error: any) {
      toast.error(error.message || "Registration failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const onVerify = async (data: VerifyFormValues) => {
    setIsLoading(true);
    try {
      await verifyOtpService({ email: registeredEmail, otp: data.otp });

      // Verification just confirmed this is really their email/password —
      // sign them in immediately with the credentials from step 1 instead of
      // sending them back to the login page to retype what they just entered.
      const response = await loginService({ email: registeredEmail, password: registeredPassword });
      const userData = response.data?.user || response.data;
      const token = response.data?.accessToken || response.accessToken;
      setUser(userData, token);

      toast.success("Email verified — you're all set!");
      router.push(userData?.role === 'teacher' ? '/teacher' : '/student');
    } catch (error: any) {
      toast.error(error.message || "Verification failed. Please check your code.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence mode="wait">
      {step === 'REGISTER' ? (
        <motion.div 
          key="register"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          className="flex flex-col space-y-6"
        >
          <div className="text-center">
            <h2 className="text-xl font-semibold text-white">Create an Account</h2>
            <p className="text-sm text-gray-400 mt-1">Get started by setting up your profile</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="role" className="text-xs font-medium text-gray-300 ml-1">I am a</label>
              <select
                id="role"
                className="w-full py-3 text-white transition-all rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:border-b-2 focus:outline-none focus:ring-0"
                {...register('role')}
              >
                <option value="student">Student — take exams and assignments</option>
                <option value="teacher">Teacher — create exams and assignments</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="name" className="text-xs font-medium text-gray-300 ml-1">Full Name</label>
              <input 
                id="name" 
                type="text" 
                placeholder="John Doe" 
                className="w-full py-3 text-white placeholder:text-zinc-400 transition-all rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:border-b-2 focus:outline-none focus:ring-0"
                {...register('name')}
              />
              {errors.name && (
                <p className="text-xs text-red-400 ml-1">{errors.name.message}</p>
              )}
            </div>
            
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
              <label htmlFor="password" className="text-xs font-medium text-gray-300 ml-1">Password</label>
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
                  Signing up...
                </div>
              ) : "Sign Up"}
            </button>
          </form>

          <div className="text-center text-sm text-gray-400">
            Already have an account?{' '}
            <Link href="/auth/login" className="text-orange-400 font-semibold hover:text-orange-300 hover:underline transition-colors">
              Sign In
            </Link>
          </div>
        </motion.div>
      ) : (
        <motion.div 
          key="verify"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="flex flex-col space-y-6"
        >
          <div className="text-center">
            <h2 className="text-xl font-semibold text-white">Check Your Email</h2>
            <p className="text-sm text-gray-400 mt-1">We've sent a 6-digit verification code to <span className="text-white font-medium">{registeredEmail}</span></p>
          </div>

          <form onSubmit={handleVerifySubmit(onVerify)} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="otp" className="text-xs font-medium text-gray-300 ml-1">Verification Code</label>
              <input 
                id="otp" 
                type="text" 
                maxLength={6}
                placeholder="123456" 
                className="w-full py-3 text-white placeholder:text-zinc-400 transition-all text-center text-2xl tracking-widest font-semibold rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:border-b-2 focus:outline-none focus:ring-0"
                {...registerVerify('otp')}
              />
              {verifyErrors.otp && (
                <p className="text-xs text-red-400 ml-1 text-center">{verifyErrors.otp.message}</p>
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
                  Verifying...
                </div>
              ) : "Verify Email"}
            </button>
          </form>

          <div className="text-center text-sm text-gray-400">
            Didn't receive the code?{' '}
            <button
              onClick={handleResend}
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
        </motion.div>
      )}
    </AnimatePresence>
  );
}
