import { z } from "zod"

const optionSchema = z.object({
  value: z.string({ message: "Option value is required" })
    .min(1, { message: "Option value cannot be empty" }),
  isCorrect: z.boolean({ message: "isCorrect is required" }),
})

const rubricSchema = z.object({
  categories: z.array(z.object({
    name: z.string(),
    weight: z.number(),
    key_points: z.array(z.string()),
  })),
})

export const createQuestionSchema = z.object({
  sectionId: z.string({ message: "Section ID is required" })
    .min(1, { message: "Section ID cannot be empty" }),
  blockId: z.string().optional(),
  type: z.enum(["mcq", "descriptive"], {
    message: "Question type must be mcq or descriptive"
  }),
  images: z.array(z.object({
    url: z.string().url(),
    publicId: z.string()
  })).optional(),
  description: z.string({ message: "Description is required" })
    .min(10, { message: "Description must be at least 10 characters long" }),
  marks: z.coerce.number({ message: "Marks are required" })
    .min(0.5, { message: "Marks must be at least 0.5" }),
  options: z.preprocess(
    (val) => {
      if (typeof val === "string") {
        try { return JSON.parse(val); } catch (e) { return val; }
      }
      return val;
    },
    z.array(optionSchema)
      .min(2, { message: "MCQ must have at least 2 options" })
      .max(5, { message: "MCQ cannot have more than 5 options" })
      .optional()
  ),
  rubric: rubricSchema.nullable().optional(),
})
  .refine((data) => {
    if (data.type === "mcq" && (!data.options || data.options.length === 0)) return false
    return true
  }, { message: "MCQ questions must have options" })
  .refine((data) => {
    if (data.type === "descriptive" && data.options) return false
    return true
  }, { message: "Descriptive questions cannot have options" })
  .refine((data) => {
    if (data.type === "mcq" && data.options) {
      return data.options.some(opt => opt.isCorrect === true)
    }
    return true
  }, { message: "MCQ must have at least one correct option" })

export type CreateQuestionDto = z.infer<typeof createQuestionSchema>

export const updateQuestionSchema = z.object({
  description: z.string()
    .min(10, { message: "Description must be at least 10 characters long" })
    .optional(),
  marks: z.coerce.number()
    .min(0.5, { message: "Marks must be at least 0.5" })
    .optional(),
  images: z.array(z.object({
    url: z.string().url(),
    publicId: z.string()
  })).optional(),
  options: z.preprocess(
    (val) => {
      if (typeof val === "string") {
        try { return JSON.parse(val); } catch (e) { return val; }
      }
      return val;
    },
    z.array(optionSchema.extend({ id: z.string().optional() }))
      .min(2, { message: "MCQ must have at least 2 options" })
      .max(5, { message: "MCQ cannot have more than 5 options" })
      .optional()
  ),
  rubric: rubricSchema.nullable().optional(),
})

export type UpdateQuestionDto = z.infer<typeof updateQuestionSchema>
