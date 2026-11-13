import { pgTable, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";

export const roleEnum = pgEnum("role", ["student", "teacher"]);

export const users = pgTable("users", {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    // The user's id in Clerk, which now handles signing in. Set the first time they sign in.
    clerkId: text("clerk_id").unique(),
    // False until a new user has chosen whether they start as a student or a teacher.
    onboarded: boolean("onboarded").default(false).notNull(),
    role: roleEnum("role").default("student").notNull(),
    phone: text("phone").default(""),

    avatarUrl: text("avatar_url"),
    avatarPublicId: text("avatar_public_id"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;