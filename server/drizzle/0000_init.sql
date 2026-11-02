CREATE TYPE "public"."role" AS ENUM('student', 'teacher');--> statement-breakpoint
CREATE TYPE "public"."series_type" AS ENUM('weekly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('inprogress', 'submitted', 'timeout', 'evaluating');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('mcq', 'descriptive');--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"role" "role" DEFAULT 'student' NOT NULL,
	"phone" text DEFAULT '',
	"is_verified" boolean DEFAULT false NOT NULL,
	"avatar_url" text,
	"avatar_public_id" text,
	"verification_token" text,
	"verification_expires" timestamp,
	"refresh_token" text,
	"reset_password_token" text,
	"reset_password_expires" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "assignment_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"question_id" text NOT NULL,
	"options" text[],
	"text_answer" text,
	"marks_awarded" double precision,
	"feedback" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"assignment_id" text,
	"series_id" text,
	"enrolled_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_enrollments_student_assignment" UNIQUE("student_id","assignment_id"),
	CONSTRAINT "assignment_enrollments_student_series" UNIQUE("student_id","series_id"),
	CONSTRAINT "assignment_enrollments_one_target" CHECK (("assignment_enrollments"."assignment_id" IS NULL) <> ("assignment_enrollments"."series_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "assignment_options" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"value" text NOT NULL,
	"is_correct" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"block_id" text,
	"type" "question_type" NOT NULL,
	"description" text NOT NULL,
	"images" jsonb,
	"marks" double precision NOT NULL,
	"model_answer" text,
	"rubric" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignment_series" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"type" "series_type" DEFAULT 'weekly' NOT NULL,
	"join_code" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_series_join_code_unique" UNIQUE("join_code")
);
--> statement-breakpoint
CREATE TABLE "assignment_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"student_id" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"submitted_at" timestamp,
	"is_late" boolean DEFAULT false NOT NULL,
	"total_marks_awarded" double precision,
	"overall_feedback" text,
	"graded_by" text,
	"graded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"join_code" text,
	"created_by" text NOT NULL,
	"total_marks" double precision NOT NULL,
	"start_date" timestamp,
	"due_date" timestamp,
	"series_id" text,
	"sequence_order" integer,
	"day_gap" integer,
	"unlock_offset_days" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assignments_join_code_unique" UNIQUE("join_code")
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"type" text DEFAULT 'SCHEDULED' NOT NULL,
	"instructions" text[],
	"duration" integer NOT NULL,
	"created_by" text NOT NULL,
	"join_code" text NOT NULL,
	"total_marks" double precision NOT NULL,
	"require_feedback" boolean DEFAULT false NOT NULL,
	"start_time" timestamp,
	"end_time" timestamp,
	"publish_time" timestamp,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "exams_join_code_unique" UNIQUE("join_code")
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"exam_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text NOT NULL,
	"block_id" text,
	"type" "question_type" NOT NULL,
	"description" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"images" jsonb,
	"content_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"marks" double precision NOT NULL,
	"model_answer" text,
	"rubric" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "options" (
	"id" text PRIMARY KEY NOT NULL,
	"question_id" text NOT NULL,
	"value" text NOT NULL,
	"is_correct" boolean NOT NULL,
	"is_code" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"exam_id" text NOT NULL,
	"status" "submission_status" NOT NULL,
	"score" double precision,
	"submitted_at" timestamp,
	"graded_by" text,
	"graded_at" timestamp,
	"overall_feedback" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "answers" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"question_id" text NOT NULL,
	"options" text[],
	"text_answer" text,
	"is_correct" boolean,
	"marks_awarded" double precision,
	"feedback" text,
	"evaluated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedbacks" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"student_id" text NOT NULL,
	"submission_id" text NOT NULL,
	"experience_rating" integer NOT NULL,
	"experience_text" text,
	"ai_evaluation_rating" integer,
	"ai_evaluation_text" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text,
	"assignment_id" text,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"question_type" "question_type" DEFAULT 'mcq' NOT NULL,
	"question_count" integer DEFAULT 0 NOT NULL,
	"total_marks" double precision DEFAULT 0 NOT NULL,
	"instructions" text[],
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blueprint_review_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_intent_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exam_intent_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"exam_input" jsonb NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"summary" jsonb,
	"blueprint_status" text DEFAULT 'pending' NOT NULL,
	"blueprint" jsonb,
	"blueprint_error" text,
	"questions_status" text DEFAULT 'pending' NOT NULL,
	"questions" jsonb,
	"questions_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_review_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"exam_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_bank_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"question_number" text,
	"raw_text" text NOT NULL,
	"question_text" text,
	"options" jsonb DEFAULT '[]'::jsonb,
	"correct_option" text,
	"subject" text,
	"topics" text[],
	"description" text,
	"page_start" integer NOT NULL,
	"page_end" integer NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb,
	"tables" jsonb DEFAULT '[]'::jsonb,
	"lists" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_bank_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"title" text NOT NULL,
	"file_url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_chunks" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"seq" integer NOT NULL,
	"page" integer NOT NULL,
	"type" text NOT NULL,
	"text" text NOT NULL,
	"font_size" real,
	"bold" boolean DEFAULT false NOT NULL,
	"heading_level_hint" integer,
	"heading_source" text,
	"image_url" text,
	"image_width" integer,
	"image_height" integer,
	CONSTRAINT "book_blocks_book_seq_unique" UNIQUE("book_id","seq")
);
--> statement-breakpoint
CREATE TABLE "book_contents" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"node_id" text NOT NULL,
	"markdown" text NOT NULL,
	CONSTRAINT "book_contents_node_id_unique" UNIQUE("node_id")
);
--> statement-breakpoint
CREATE TABLE "book_images" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"node_id" text NOT NULL,
	"position" integer NOT NULL,
	"block_seq" integer NOT NULL,
	"page" integer NOT NULL,
	"caption" text,
	"url" text NOT NULL,
	"width" integer,
	"height" integer
);
--> statement-breakpoint
CREATE TABLE "book_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"parent_id" text,
	"level" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"title_generated" boolean DEFAULT false NOT NULL,
	"description" text,
	"key_concepts" text[],
	"page_start" integer NOT NULL,
	"page_end" integer NOT NULL,
	"start_block" integer NOT NULL,
	"end_block" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" text PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"title" text NOT NULL,
	"file_url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" jsonb,
	"page_count" integer,
	"toc" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_answers" ADD CONSTRAINT "assignment_answers_submission_id_assignment_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."assignment_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_answers" ADD CONSTRAINT "assignment_answers_question_id_assignment_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."assignment_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_enrollments" ADD CONSTRAINT "assignment_enrollments_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_enrollments" ADD CONSTRAINT "assignment_enrollments_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_enrollments" ADD CONSTRAINT "assignment_enrollments_series_id_assignment_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."assignment_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_options" ADD CONSTRAINT "assignment_options_question_id_assignment_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."assignment_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_series" ADD CONSTRAINT "assignment_series_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_graded_by_users_id_fk" FOREIGN KEY ("graded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_series_id_assignment_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."assignment_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "options" ADD CONSTRAINT "options_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_graded_by_users_id_fk" FOREIGN KEY ("graded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_review_messages" ADD CONSTRAINT "blueprint_review_messages_session_id_exam_intent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."exam_intent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_intent_messages" ADD CONSTRAINT "exam_intent_messages_session_id_exam_intent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."exam_intent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_intent_sessions" ADD CONSTRAINT "exam_intent_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_chunks" ADD CONSTRAINT "question_bank_chunks_document_id_question_bank_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."question_bank_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_documents" ADD CONSTRAINT "question_bank_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_blocks" ADD CONSTRAINT "book_blocks_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_contents" ADD CONSTRAINT "book_contents_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_contents" ADD CONSTRAINT "book_contents_node_id_book_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."book_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_images" ADD CONSTRAINT "book_images_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_images" ADD CONSTRAINT "book_images_node_id_book_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."book_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_nodes" ADD CONSTRAINT "book_nodes_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_nodes" ADD CONSTRAINT "book_nodes_parent_id_book_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."book_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_active_exam_user_idx" ON "submissions" USING btree ("exam_id","user_id") WHERE "submissions"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "answers_submission_question_idx" ON "answers" USING btree ("submission_id","question_id");--> statement-breakpoint
CREATE INDEX "book_images_node_idx" ON "book_images" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "book_nodes_book_position_idx" ON "book_nodes" USING btree ("book_id","position");