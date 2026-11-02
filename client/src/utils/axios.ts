import axios from "axios";
import { useAuthStore } from "../store/authStore";

const api = axios.create({
  // Must include the /api prefix — every route is mounted under it server-side
  // (e.g. /api/auth), and callers pass paths like "/auth/me".
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api",
  withCredentials: true,
  timeout: 300000, // 5 minutes (increased for long AI generation requests)
});

api.interceptors.request.use(
  (config) => {
    const token = useAuthStore.getState().accessToken;

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// ── Variables for managing the refresh queue ──
let isRefreshing = false;
let failedQueue: any[] = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If error is 401 and we haven't retried yet, and it's not the refresh or logout endpoint
    if (
      error.response?.status === 401 && 
      !originalRequest._retry && 
      originalRequest.url !== '/auth/refreshToken' &&
      originalRequest.url !== '/auth/logout'
    ) {
      
      if (isRefreshing) {
        // If already refreshing, put this request in a queue to wait
        return new Promise(function(resolve, reject) {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers['Authorization'] = 'Bearer ' + token;
          return api(originalRequest);
        }).catch(err => {
          return Promise.reject(err);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const hasRefreshed = await useAuthStore.getState().refreshAccessToken();
        
        if (!hasRefreshed) {
          // Refresh failed, logout user
          useAuthStore.getState().logout();
          processQueue(new Error("Refresh token failed"), null);
          return Promise.reject(error);
        }

        const newToken = useAuthStore.getState().accessToken;
        processQueue(null, newToken);
        originalRequest.headers['Authorization'] = 'Bearer ' + newToken;
        return api(originalRequest);
      } catch (err) {
        processQueue(err, null);
        useAuthStore.getState().logout();
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default api;
