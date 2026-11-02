import { pgTable, text, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";

export const roleEnum = pgEnum("role", ["student", "teacher"]);

export const users = pgTable("users", {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    password: text("password").notNull(),
    role: roleEnum("role").default("student").notNull(),
    phone: text("phone").default(""),
    isVerified: boolean("is_verified").default(false).notNull(),

    avatarUrl: text("avatar_url"),
    avatarPublicId: text("avatar_public_id"),

    verificationToken: text("verification_token"),
    verificationExpires: timestamp("verification_expires"),
    refreshToken: text("refresh_token"),
    resetPasswordToken: text("reset_password_token"),
    resetPasswordExpires: timestamp("reset_password_expires"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;