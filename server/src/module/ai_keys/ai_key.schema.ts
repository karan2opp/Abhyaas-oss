import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { users } from "../auth/user.schema.js";

// The OpenAI API key a person has added ("bring your own key"). Their AI use (writing questions, grading answers) is
// billed to it. The key itself is stored encrypted (see common/utils/secretbox.ts) and is never sent back to the website:
// only the last four characters are shown.
export const userAiKeys = pgTable("user_ai_keys", {
    id: text("id").primaryKey().$defaultFn(() => createId()),
    // One key per person.
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }).notNull().unique(),
    provider: text("provider").default("openai").notNull(),

    encryptedKey: text("encrypted_key").notNull(),
    // For showing which key is saved ("…a1b2") without revealing it.
    last4: text("last4").notNull(),

    // "valid" after the key was checked when saved. "invalid" once OpenAI later rejected it, until a new key is saved.
    status: text("status").default("valid").notNull(),
    lastCheckedAt: timestamp("last_checked_at").defaultNow().notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UserAiKey = typeof userAiKeys.$inferSelect;
