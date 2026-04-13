CREATE TYPE "public"."channel" AS ENUM('email', 'form', 'sns_twitter', 'sns_linkedin');--> statement-breakpoint
CREATE TYPE "public"."form_type" AS ENUM('google_forms', 'native_html', 'wordpress_cf7', 'iframe_embed', 'with_captcha');--> statement-breakpoint
CREATE TYPE "public"."outreach_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."prospect_status" AS ENUM('new', 'contacted', 'responded', 'converted', 'rejected', 'inactive', 'unreachable');--> statement-breakpoint
CREATE TYPE "public"."response_type" AS ENUM('reply', 'auto_reply', 'bounce', 'meeting_request', 'rejection');--> statement-breakpoint
CREATE TYPE "public"."sentiment" AS ENUM('positive', 'neutral', 'negative');--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "evaluations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" text NOT NULL,
	"evaluation_date" timestamp with time zone DEFAULT now() NOT NULL,
	"metrics" jsonb NOT NULL,
	"findings" text NOT NULL,
	"improvements" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"domain" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"website_url" text NOT NULL,
	"country" text,
	"address" text,
	"industry" text,
	"overview" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outreach_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" text NOT NULL,
	"prospect_id" integer NOT NULL,
	"channel" "channel" NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"status" "outreach_status" DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "project_prospects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_prospects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" text NOT NULL,
	"prospect_id" integer NOT NULL,
	"match_reason" text NOT NULL,
	"priority" smallint DEFAULT 3 NOT NULL,
	"status" "prospect_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_project_prospect" UNIQUE("project_id","prospect_id"),
	CONSTRAINT "chk_priority" CHECK ("project_prospects"."priority" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "prospects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"contact_name" text,
	"organization_id" text NOT NULL,
	"department" text,
	"overview" text NOT NULL,
	"industry" text,
	"website_url" text NOT NULL,
	"email" text,
	"contact_form_url" text,
	"form_type" "form_type",
	"sns_accounts" jsonb,
	"do_not_contact" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "responses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"outreach_log_id" integer NOT NULL,
	"channel" "channel" NOT NULL,
	"content" text NOT NULL,
	"sentiment" "sentiment" NOT NULL,
	"response_type" "response_type" NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_logs" ADD CONSTRAINT "outreach_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_logs" ADD CONSTRAINT "outreach_logs_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_prospects" ADD CONSTRAINT "project_prospects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_prospects" ADD CONSTRAINT "project_prospects_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_organization_id_organizations_domain_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("domain") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_outreach_log_id_outreach_logs_id_fk" FOREIGN KEY ("outreach_log_id") REFERENCES "public"."outreach_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_evaluations_project" ON "evaluations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_org_normalized_name" ON "organizations" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "idx_outreach_project" ON "outreach_logs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_outreach_prospect" ON "outreach_logs" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "idx_outreach_dedup" ON "outreach_logs" USING btree ("project_id","prospect_id","status");--> statement-breakpoint
CREATE INDEX "idx_project_prospects_project" ON "project_prospects" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_project_prospects_prospect" ON "project_prospects" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "idx_project_prospects_status" ON "project_prospects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_projects_user" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_prospect_unique_email" ON "prospects" USING btree ("email") WHERE "prospects"."email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_prospect_unique_form" ON "prospects" USING btree ("contact_form_url") WHERE "prospects"."contact_form_url" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_prospect_org" ON "prospects" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_responses_outreach" ON "responses" USING btree ("outreach_log_id");