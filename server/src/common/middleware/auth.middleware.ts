import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt.utils.js";
import { ApiError } from "../utils/ApiError.js";
import db from "../db/index.js";
import { users } from "../../module/auth/user.schema.js";
import { eq } from "drizzle-orm";

// Tell TypeScript that Express Requests now have a 'user' property!
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
        name: string;
        email: string;
      };
    }
  }
}

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let token: string | undefined;

    // 1. Check Bearer token
    if (req.headers.authorization?.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1];
    }
    // 2. Check cookie fallback
    else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      throw ApiError.unauthorized("Not authenticated");
    }

    // Verify token and explicitly cast the payload
    const decoded = verifyAccessToken(token) as { id: string };

    // Fetch user using Drizzle (replacing Mongoose findById)
    const [user] = await db.select().from(users).where(eq(users.id, decoded.id));

    if (!user) {
      throw ApiError.unauthorized("User no longer exists");
    }

    // Attach user to the request object
    req.user = {
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
    };

    next();
  } catch (error) {
    // Pass errors to your global error handler (e.g. token expired errors)
    next(error);
  }
};

export const authorize = (...roles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw ApiError.unauthorized("Not authenticated");

    if (!roles.includes(req.user.role)) {
      throw ApiError.forbidden("You are not authorized to perform this action");
    }

    next();
  };
};
