import api from "../../utils/axios";

/**
 * Fetch current user
 */
export const getMe = async (set: any) => {
  try {
    set({ loading: true, error: null });

    const res = await api.get("/auth/me");
    const userData = res.data?.data;

    set({
      user: userData,
      isLoggedIn: true,
      loading: false,
      error: null, // Clear any previous error
    });

    return userData;
  } catch (error: any) {
    set({
      user: null,
      isLoggedIn: false,
      loading: false,
      error: error.response?.data?.message || "Failed to fetch user",
    });
    return null;
  }
};

/**
 * Refresh access token — preserve user data
 */
export const refreshToken = async (set: any) => {
  try {
    const res = await api.post("/auth/refreshToken");
    const newToken = res.data?.data?.accessToken;

    if (!newToken) throw new Error("No access token received");

    // ✅ Only update token — keep user/isLoggedIn unchanged
    set({ accessToken: newToken });
    return true;
  } catch (error: any) {
    // ❌ Don't clear user on refresh failure — let getMe handle auth
    set({
      accessToken: null,
      error: error.response?.data?.message || "Failed to refresh token",
    });
    return false;
  }
};

export const logoutService = async (set: any) => {
  try {
    await api.post("/auth/logout", {}, { withCredentials: true }); // clears httpOnly cookie
  } catch (err: any) {
    if (err.response?.status !== 401) {
      console.error("Logout failed:", err.message);
    }
    // still clear frontend state even if backend fails
  } finally {
    set({
      user: null,
      accessToken: null,
      isLoggedIn: false,
      loading: false,
      error: null,
    });
  }
};

export const forgotPasswordService = async (email: string) => {
  try {
    await api.post("/auth/forgotPassword", { email });
    return { success: true };
  } catch (error: any) {
    throw new Error(error.response?.data?.message || "Failed to send reset email");
  }
};

export const resetPasswordService = async (email: string, otp: string, password: string) => {
  try {
    await api.put(`/auth/resetPassword`, { email, otp, password });
    return { success: true };
  } catch (error: any) {
    throw new Error(error.response?.data?.message || "Failed to reset password");
  }
};

export const loginService = async (credentials: any) => {
  try {
    const res = await api.post("/auth/login", credentials);
    return res.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.message || "Failed to login");
  }
};

export const registerService = async (userData: any) => {
  try {
    // userData.role is "teacher" or "student", chosen on the register form.
    const res = await api.post("/auth/register", userData);
    return res.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.message || "Failed to register");
  }
};

export const verifyOtpService = async (data: { email: string; otp: string }) => {
  try {
    const res = await api.post("/auth/verify-otp", data);
    return res.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.message || "Failed to verify OTP");
  }
};

export const resendOtpService = async (email: string) => {
  try {
    const res = await api.post("/auth/resend-otp", { email });
    return res.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.message || "Failed to resend code");
  }
};

export const updateProfileService = async (formData: FormData) => {
  try {
    const res = await api.put("/auth/me", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
    return res.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.message || "Failed to update profile");
  }
};
