import { eq, and } from "drizzle-orm";
import db from "../../common/db/index.js";
import { users } from "../../common/db/schema.js";
import { ApiError } from "../../common/utils/ApiError.js";
import type { RoleDto } from "./auth.dto.js";

// What the website is allowed to see of a user. The Clerk id stays on the server.
const toSafeUser = ({ clerkId: _clerkId, ...safe }: typeof users.$inferSelect) => safe;

// ── Get me ────────────────────────────────────────────────────────────────────
const getMe = async (userId: string) => {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw ApiError.notFound("User not found");
    return toSafeUser(user);
};

// ── Choose student or teacher (once, on first sign-in) ────────────────────────
const onboard = async (userId: string, data: RoleDto) => {
    const [updated] = await db
        .update(users)
        .set({ role: data.role, onboarded: true, updatedAt: new Date() })
        .where(and(eq(users.id, userId), eq(users.onboarded, false)))
        .returning();

    if (!updated) throw ApiError.conflict("You have already chosen your role");
    return toSafeUser(updated);
};

// ── Switch between student and teacher (any time) ─────────────────────────────
// Everyone may use both sides. Nothing is deleted when the role changes: exams a person made as a teacher and results
// they earned as a student all stay where they are, and show again when they switch back.
const switchRole = async (userId: string, data: RoleDto) => {
    const [updated] = await db
        .update(users)
        .set({ role: data.role, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();

    if (!updated) throw ApiError.notFound("User not found");
    return toSafeUser(updated);
};

// ── Update Profile ────────────────────────────────────────────────────────────
const updateProfile = async (userId: string, data: { phone?: string, name?: string }, file?: Express.Multer.File) => {
    const updateData: Partial<typeof users.$inferInsert> = {};

    if (data.phone !== undefined) {
        updateData.phone = data.phone;
    }

    if (data.name !== undefined) {
        updateData.name = data.name;
    }

    if (file) {
        const { uploadToCloudinary } = await import("../../common/config/cloudinary.js");
        const uploadResult = await uploadToCloudinary(file.buffer, "abiyaas/avatars");
        updateData.avatarUrl = uploadResult.url;
        updateData.avatarPublicId = uploadResult.publicId;
    }

    if (Object.keys(updateData).length === 0) {
        return getMe(userId);
    }

    const [updatedUser] = await db.update(users)
        .set({ ...updateData, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();

    if (!updatedUser) throw ApiError.notFound("User not found during update");

    return toSafeUser(updatedUser);
};

export { getMe, onboard, switchRole, updateProfile };
