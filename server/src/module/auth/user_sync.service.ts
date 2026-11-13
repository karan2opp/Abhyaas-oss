import { and, eq, isNull } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import db from "../../common/db/index.js";
import { users } from "../../common/db/schema.js";
import { ApiError } from "../../common/utils/ApiError.js";

type LocalUser = typeof users.$inferSelect;

// The parts of a Clerk user that are used here.
export interface ClerkUserInfo {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  imageUrl: string;
  primaryEmailAddressId: string | null;
  emailAddresses: { id: string; emailAddress: string; verification?: { status?: string | null } | null }[];
}

const fetchFromClerk = (clerkId: string): Promise<ClerkUserInfo> => clerkClient.users.getUser(clerkId);

const byClerkId = async (clerkId: string): Promise<LocalUser | undefined> =>
  (await db.select().from(users).where(eq(users.clerkId, clerkId)))[0];

/**
 * The user row in our database for someone signed in through Clerk.
 *
 * The first time a Clerk user is seen, their name, email and photo are copied from Clerk into a new row. If an account
 * from before Clerk already has that email, it is linked instead, so the exams and results already attached to it
 * stay with the person. Linking only happens when Clerk has verified the email, otherwise anyone could sign up with
 * someone else's address and take over their account.
 */
// `fetchClerkUser` is only replaced in tests.
export async function resolveLocalUser(clerkId: string, fetchClerkUser: (id: string) => Promise<ClerkUserInfo> = fetchFromClerk): Promise<LocalUser> {
  const existing = await byClerkId(clerkId);
  if (existing) return existing;

  const clerkUser = await fetchClerkUser(clerkId);
  const address = clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId) ?? clerkUser.emailAddresses[0];
  if (!address) throw ApiError.badRequest("Your account has no email address");
  const email = address.emailAddress.trim().toLowerCase();
  const verified = address.verification?.status === "verified";

  const [sameEmail] = await db.select().from(users).where(eq(users.email, email));
  if (sameEmail) {
    if (!verified) throw ApiError.forbidden("Please verify your email address to continue");
    if (sameEmail.clerkId && sameEmail.clerkId !== clerkId) throw ApiError.conflict("This email is already used by another account");
    const [linked] = await db
      .update(users)
      .set({ clerkId, updatedAt: new Date() })
      .where(and(eq(users.id, sameEmail.id), isNull(users.clerkId)))
      .returning();
    if (linked) return linked;
    // Another request linked it a moment ago.
    const raced = await byClerkId(clerkId);
    if (raced) return raced;
    throw ApiError.conflict("This email is already used by another account");
  }

  const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() || clerkUser.username || email.split("@")[0]!;
  // Several requests can arrive together on a first sign-in; the unique clerk_id makes only one of them insert.
  await db.insert(users).values({ name, email, clerkId, avatarUrl: clerkUser.imageUrl || null }).onConflictDoNothing();

  const created = await byClerkId(clerkId);
  if (!created) throw ApiError.conflict("Could not create your account. Please try again.");
  return created;
}
