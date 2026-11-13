import api from "../../utils/axios";

/**
 * Fetch the app's record of the signed-in user (role, profile). Only called once Clerk says someone is signed in.
 */
export const getMe = async (set: any) => {
  try {
    set({ loading: true, error: null });

    // If the server did not answer at all (for example while it is restarting), try again a few times before giving up.
    // An answer with an error status is a real result and is not retried.
    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await api.get("/auth/me");
        break;
      } catch (err: any) {
        if (err.response || attempt >= 4) throw err;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
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
 * Sign out of Clerk (which ends the session) and clear the app's record of the user.
 */
export const logoutService = async (set: any) => {
  try {
    await (window as any).Clerk?.signOut();
  } catch (err: any) {
    console.error("Sign out failed:", err?.message);
  } finally {
    // still clear frontend state even if Clerk fails
    set({
      user: null,
      isLoggedIn: false,
      loading: false,
      error: null,
    });
  }
};

/**
 * A new user chooses whether they start as a student or a teacher. Allowed once.
 */
export const onboardService = async (role: "student" | "teacher") => {
  try {
    const res = await api.post("/auth/onboard", { role });
    return res.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.message || "Could not save your choice");
  }
};

/**
 * Switch between student and teacher. Allowed at any time.
 */
export const switchRoleService = async (role: "student" | "teacher") => {
  try {
    const res = await api.put("/auth/role", { role });
    return res.data;
  } catch (error: any) {
    throw new Error(error.response?.data?.message || "Could not switch role");
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
