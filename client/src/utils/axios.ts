import axios from "axios";
import { apiBaseUrl } from "@/lib/apiUrl";

const api = axios.create({
  // Must include the /api prefix — every route is mounted under it server-side
  // (e.g. /api/auth), and callers pass paths like "/auth/me".
  baseURL: apiBaseUrl(),
  withCredentials: true,
  timeout: 300000, // 5 minutes (increased for long AI generation requests)
});

// Signing in is handled by Clerk, which keeps a session token fresh in the browser. Every request asks it for the
// current token and sends it, so there is nothing to refresh here. The server checks it with Clerk.
api.interceptors.request.use(
  async (config) => {
    const token = await (window as any).Clerk?.session?.getToken();

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

export default api;
