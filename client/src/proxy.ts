import { clerkMiddleware } from "@clerk/nextjs/server";

// Clerk needs this to work in Next.js. It does not block any page: who may open what is decided by the layouts and by the
// API, so every page is left open here.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Everything except Next.js internals and static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
