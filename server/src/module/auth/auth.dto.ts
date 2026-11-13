import { z } from "zod";

export const updateProfileSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters").max(50, "Name must be at most 50 characters").optional(),
    phone: z.string()
        .length(10, "Phone must be 10 digits")
        .regex(/^[0-9]+$/, "Phone must contain only numbers")
        .optional(),
})

// Student or teacher. Chosen when a new user first signs in, and changeable at any time after that.
export const roleSchema = z.object({
    role: z.enum(["student", "teacher"], { message: "Choose student or teacher" }),
})

export type RoleDto = z.infer<typeof roleSchema>
