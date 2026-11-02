"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { Camera, Mail, User, Shield, KeyRound, Loader2, ArrowLeft } from 'lucide-react';

import { useAuthStore } from '@/store/authStore';
import { updateProfileService, forgotPasswordService, getMe } from '@/app/auth/auth.service';

export default function ProfileView() {
  const router = useRouter();
  const { user, setUser } = useAuthStore();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState<string>(user?.name || '');
  const [previewUrl, setPreviewUrl] = useState<string | null>(user?.avatarUrl || null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      const updatedUser = await getMe(useAuthStore.setState);
      if (updatedUser) {
        setPreviewUrl(updatedUser.avatarUrl || null);
      }
    };
    fetchUser();
  }, []);

  useEffect(() => {
    if (user?.name) {
      setName(user.name);
    }
  }, [user?.name]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#14151f] border-white/15 text-white placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30 text-white">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setPreviewUrl(URL.createObjectURL(selectedFile));
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file && name === user?.name) return;
    setIsUpdating(true);

    try {
      const formData = new FormData();
      if (file) formData.append('avatar', file);
      if (name !== user?.name) formData.append('name', name);

      const response = await updateProfileService(formData);
      setUser(response.data, useAuthStore.getState().accessToken);
      toast.success("Profile updated successfully");
      setFile(null);
    } catch (error: any) {
      toast.error(error.message || "Failed to update profile");
    } finally {
      setIsUpdating(false);
    }
  };

  const handlePasswordReset = async () => {
    setIsResetting(true);
    try {
      await forgotPasswordService(user.email);
      toast.success("OTP sent to your email!");
      router.push(`/auth/forgot-password?step=2&email=${encodeURIComponent(user.email)}`);
    } catch (error: any) {
      toast.error(error.message || "Failed to initiate password reset");
    } finally {
      setIsResetting(false);
    }
  };

  const roleColors: Record<string, string> = {
    superadmin: 'bg-red-500/10 text-red-500 border-red-500/20',
    admin: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    teacher: 'bg-orange-500/10 text-orange-500 border-orange-500/30',
    student: 'bg-[#18181b]merald-500/10 text-emerald-500 border-emerald-500/20',
  };

  return (
    <div className="min-h-full bg-[#050505] text-white p-6 md:p-12 overflow-y-auto">
      <div className="max-w-3xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex items-center space-x-4">
          <button 
            onClick={() => router.back()} 
            className="p-2 bg-white/5 hover:bg-white/10 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Account Settings</h1>
            <p className="text-gray-400 text-sm mt-1">Manage your profile, preferences, and security.</p>
          </div>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-8"
        >
          {/* Profile Sidebar */}
          <div className="md:col-span-1 space-y-6">
            <div className="bg-[#0f0f11] border border-white/10 rounded-2xl p-6 flex flex-col items-center text-center space-y-4">
              <div className="relative group">
                <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-[#09090b] bg-[#14151f] border-white/15 text-white placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30 shadow-xl relative">
                  {previewUrl ? (
                    <img src={previewUrl} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500">
                      <User className="w-12 h-12" />
                    </div>
                  )}
                  
                  <label htmlFor="avatar-upload" className="absolute inset-0 bg-[#14151f] border-white/15 text-white placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                    <Camera className="w-6 h-6 text-white mb-1" />
                    <span className="text-xs font-medium">Change</span>
                  </label>
                  <input 
                    id="avatar-upload" 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={handleFileChange}
                  />
                </div>
              </div>

              <div>
                <h3 className="text-xl font-bold">{user.name}</h3>
                <div className={`mt-2 inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${roleColors[user.role] || 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                  <Shield className="w-3 h-3 mr-1.5" />
                  {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
                </div>
              </div>
            </div>
          </div>

          {/* Settings Form */}
          <div className="md:col-span-2 space-y-6">
            <form onSubmit={handleUpdateProfile} className="bg-[#0f0f11] border border-white/10 rounded-2xl p-6 space-y-6">
              <h3 className="text-lg font-semibold border-b border-white/10 pb-4">Personal Information</h3>
              
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-400 ml-1">Full Name</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                      <input 
                        type="text" 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={isUpdating}
                        className="w-full pl-10 pr-4 py-2.5 text-white transition-all disabled:opacity-50 rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-gray-400 ml-1">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                      <input 
                        type="email" 
                        value={user.email}
                        disabled
                        className="w-full pl-10 pr-4 py-2.5 text-gray-400 cursor-not-allowed rounded-none border-0 border-b border-white/20 bg-transparent px-0 transition-colors placeholder:text-zinc-500 focus:border-orange-500 focus:outline-none focus:ring-0"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-white/10 flex justify-end">
                <button 
                  type="submit" 
                  disabled={isUpdating || (!file && name === user?.name)}
                  className="bg-white text-black hover:bg-gray-200 font-semibold rounded-xl px-6 py-2.5 transition-all active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 flex items-center gap-2"
                >
                  {isUpdating && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </form>

            {/* Security Section */}
            <div className="bg-[#0f0f11] border border-white/10 rounded-2xl p-6 space-y-6">
              <h3 className="text-lg font-semibold border-b border-white/10 pb-4">Security Settings</h3>
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h4 className="font-medium text-white flex items-center">
                    <KeyRound className="w-4 h-4 mr-2 text-gray-400" />
                    Password
                  </h4>
                  <p className="text-sm text-gray-400 mt-1">Change your password by receiving a secure OTP.</p>
                </div>
                <button 
                  onClick={handlePasswordReset}
                  disabled={isResetting}
                  className="bg-white/5 hover:bg-white/10 border border-white/10 text-white font-medium rounded-xl px-5 py-2.5 transition-all active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 whitespace-nowrap flex items-center gap-2"
                >
                  {isResetting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Reset Password
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
