import { z } from "zod"

export const registerSchema = z.object({
    name: z.string({ message: "Name is required" })
        .min(2, "Name must be at least 2 characters")
        .max(50, "Name must be at most 50 characters")
        .trim(),

    email: z.string({ message: "Email is required" })
        .email("Invalid email address")
        .toLowerCase(),

    password: z.string({ message: "Password is required" })
        .min(8, "Password must be at least 8 characters")
        .regex(/(?=.*[A-Z])/, "Password must contain at least one uppercase letter")
        .regex(/(?=.*\d)/, "Password must contain at least one number"),

    // Anyone can sign up as a teacher (to create exams) or a student (to take them).
    role: z.enum(["student", "teacher"]).default("student"),

    phone: z.string()
        .length(10, "Phone must be 10 digits")
        .regex(/^[0-9]+$/, "Phone must contain only numbers")
        .optional(),
})

export const loginSchema = z.object({
    email: z.string({ message: "Email is required" })
        .email("Invalid email address")
        .toLowerCase(),
    password: z.string({ message: "Password is required" })
})

export const forgotPasswordSchema = z.object({
    email: z.string({ message: "Email is required" })
        .email("Invalid email address")
        .toLowerCase(),
})

export const resendOtpSchema = z.object({
    email: z.string({ message: "Email is required" })
        .email("Invalid email address")
        .toLowerCase(),
})

export const resetPasswordSchema = z.object({
    email: z.string({ message: "Email is required" })
        .email("Invalid email address")
        .toLowerCase(),
    otp: z.string({ message: "OTP is required" })
        .length(6, "OTP must be exactly 6 digits")
        .regex(/^\d+$/, "OTP must contain only numbers"),
    password: z.string({ message: "Password is required" })
        .min(8, "Password must be at least 8 characters")
        .regex(/(?=.*[A-Z])/, "Password must contain at least one uppercase letter")
        .regex(/(?=.*\d)/, "Password must contain at least one number"),
})

export const updateProfileSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters").max(50, "Name must be at most 50 characters").optional(),
    phone: z.string()
        .length(10, "Phone must be 10 digits")
        .regex(/^[0-9]+$/, "Phone must contain only numbers")
        .optional(),
})

export const verifyOtpSchema = z.object({
    email: z.string({ message: "Email is required" })
        .email("Invalid email address")
        .toLowerCase(),
    otp: z.string({ message: "OTP is required" })
        .length(6, "OTP must be exactly 6 digits")
        .regex(/^\d+$/, "OTP must contain only numbers"),
})

export type RegisterDto = z.infer<typeof registerSchema>
export type LoginDto = z.infer<typeof loginSchema>
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>
export type ResendOtpDto = z.infer<typeof resendOtpSchema>
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>