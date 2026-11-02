import { pgEnum } from "drizzle-orm/pg-core";

export const questionTypeEnum = pgEnum("question_type", ["mcq", "descriptive"]);
