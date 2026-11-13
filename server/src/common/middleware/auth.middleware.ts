import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { ApiError } from "../utils/ApiError.js";
import { runAsAiUser } from "../agent/ai_context.js";
import { resolveLocalUser } from "../../module/auth/user_sync.service.js";

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

// Signing in is handled by Clerk. By the time a request gets here, clerkMiddleware (see app.ts) has checked the session
// token the website sent in the Authorization header. This turns that Clerk user into the user row in our own
// database, which is what every other table refers to, and puts it on the request.
async function attachUser(req: Request) {
  const { userId } = getAuth(req);
  if (!userId) throw ApiError.unauthorized("Not authenticated");

  const user = await resolveLocalUser(userId);
  req.user = { id: user.id, role: user.role, name: user.name, email: user.email };
  return user;
}

/** For every route that needs a signed-in user who has finished the first-time student-or-teacher question. */
export const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const user = await attachUser(req);
    if (!user.onboarded) throw ApiError.forbidden("Choose whether you are a student or a teacher to continue");
    // From here on, anything this request does with AI is billed to this person's own key (see common/agent/ai_context.ts).
    runAsAiUser(user.id, () => next());
  } catch (error) {
    next(error);
  }
};

/** Only for the routes a brand-new user needs before they have answered that question (see /auth/me and /auth/onboard). */
export const authenticateAllowingOnboarding = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    await attachUser(req);
    next();
  } catch (error) {
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
