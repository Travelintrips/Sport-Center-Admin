ALTER TYPE "sport_center"."user_role" ADD VALUE 'super_admin' BEFORE 'customer';--> statement-breakpoint
ALTER TYPE "sport_center"."user_role" ADD VALUE 'admin_booking' BEFORE 'customer';--> statement-breakpoint
ALTER TYPE "sport_center"."user_role" ADD VALUE 'finance' BEFORE 'customer';--> statement-breakpoint
ALTER TYPE "sport_center"."user_role" ADD VALUE 'staff' BEFORE 'customer';--> statement-breakpoint
ALTER TYPE "sport_center"."user_role" ADD VALUE 'tenant';--> statement-breakpoint
ALTER TYPE "sport_center"."user_role" ADD VALUE 'ap2_employee';--> statement-breakpoint
ALTER TYPE "sport_center"."membership_status" ADD VALUE 'pending_payment' BEFORE 'active';--> statement-breakpoint
ALTER TYPE "sport_center"."membership_status" ADD VALUE 'waiting_confirmation' BEFORE 'active';--> statement-breakpoint
CREATE TABLE "sport_center"."verification_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer,
	"order_number" text,
	"verified_by_user_id" integer,
	"id_card_number_input" text NOT NULL,
	"status" text NOT NULL,
	"notes" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."booking_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"changed_by" integer,
	"changed_by_name" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"user_name" text,
	"user_role" text,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" integer,
	"before" jsonb,
	"after" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."pricing_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer,
	"name" text NOT NULL,
	"rule_type" text NOT NULL,
	"day_type" text,
	"peak_start_time" text,
	"peak_end_time" text,
	"price_override" numeric(12, 2),
	"price_addon" numeric(12, 2),
	"price_multiplier" numeric(5, 3),
	"is_active" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."notification_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sport_center"."maintenance_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"title" text NOT NULL,
	"maintenance_type" text DEFAULT 'maintenance' NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"start_time" text,
	"end_time" text,
	"all_day" boolean DEFAULT false NOT NULL,
	"reason" text,
	"created_by" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."reschedule_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"requested_by" integer,
	"new_date" text NOT NULL,
	"new_start_time" text NOT NULL,
	"new_end_time" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" integer,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."booking_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"facility_id" integer NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"reviewer_name" text,
	"is_public" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_reviews_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
CREATE TABLE "sport_center"."booking_cancellations" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"cancelled_by" text DEFAULT 'customer' NOT NULL,
	"cancelled_by_user_id" integer,
	"reason" text,
	"refund_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"refund_status" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_cancellations_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
CREATE TABLE "sport_center"."tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"business_name" text NOT NULL,
	"owner_name" text NOT NULL,
	"phone" text,
	"email" text,
	"business_category" text,
	"logo_url" text,
	"address" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "sport_center"."tenant_bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"tenant_id" integer NOT NULL,
	"user_id" integer,
	"booking_type" text DEFAULT 'booth' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"duration_months" integer,
	"requested_area" text,
	"description" text,
	"price" numeric(12, 2) DEFAULT '0' NOT NULL,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"admin_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_bookings_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "sport_center"."tenant_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_booking_id" integer NOT NULL,
	"proof_image_url" text,
	"amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."booking_extension_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"extra_hours" integer NOT NULL,
	"additional_price" numeric(12, 2) NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"admin_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."wa_action_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"booking_id" integer NOT NULL,
	"action" text NOT NULL,
	"used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_action_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ALTER COLUMN "status" SET DEFAULT 'pending_payment'::text;--> statement-breakpoint
DROP TYPE "sport_center"."booking_status";--> statement-breakpoint
CREATE TYPE "sport_center"."booking_status" AS ENUM('pending_payment', 'waiting_confirmation', 'paid', 'confirmed', 'completed', 'cancelled', 'rejected', 'expired', 'refunded');--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ALTER COLUMN "status" SET DEFAULT 'pending_payment'::"sport_center"."booking_status";--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ALTER COLUMN "status" SET DATA TYPE "sport_center"."booking_status" USING "status"::"sport_center"."booking_status";--> statement-breakpoint
ALTER TABLE "sport_center"."users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sport_center"."users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sport_center"."users" ADD COLUMN "google_id" text;--> statement-breakpoint
ALTER TABLE "sport_center"."users" ADD COLUMN "tenant_id" integer;--> statement-breakpoint
ALTER TABLE "sport_center"."users" ADD COLUMN "customer_code" text;--> statement-breakpoint
ALTER TABLE "sport_center"."users" ADD COLUMN "registration_source" text DEFAULT 'web';--> statement-breakpoint
ALTER TABLE "sport_center"."facilities" ADD COLUMN "booking_mode" text DEFAULT 'time_slot' NOT NULL;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "activity_type" text;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "number_of_people" integer;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "resource_name" text;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "source" text DEFAULT 'web';--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "payment_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "checked_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "reminder_h1_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "reminder_day_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sport_center"."payments" ADD COLUMN "payment_method" text DEFAULT 'Transfer Bank';--> statement-breakpoint
ALTER TABLE "sport_center"."payments" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sport_center"."gym_memberships" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "sport_center"."gym_memberships" ADD COLUMN "payment_proof_url" text;--> statement-breakpoint
ALTER TABLE "sport_center"."verification_logs" ADD CONSTRAINT "verification_logs_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "sport_center"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."booking_history" ADD CONSTRAINT "booking_history_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "sport_center"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."booking_history" ADD CONSTRAINT "booking_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "sport_center"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "sport_center"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."pricing_rules" ADD CONSTRAINT "pricing_rules_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "sport_center"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "sport_center"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "sport_center"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."reschedule_requests" ADD CONSTRAINT "reschedule_requests_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "sport_center"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."reschedule_requests" ADD CONSTRAINT "reschedule_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "sport_center"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."reschedule_requests" ADD CONSTRAINT "reschedule_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "sport_center"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."booking_reviews" ADD CONSTRAINT "booking_reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "sport_center"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."booking_reviews" ADD CONSTRAINT "booking_reviews_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "sport_center"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."booking_cancellations" ADD CONSTRAINT "booking_cancellations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "sport_center"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."booking_cancellations" ADD CONSTRAINT "booking_cancellations_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "sport_center"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."tenants" ADD CONSTRAINT "tenants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "sport_center"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."tenant_bookings" ADD CONSTRAINT "tenant_bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "sport_center"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."tenant_bookings" ADD CONSTRAINT "tenant_bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "sport_center"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."tenant_payments" ADD CONSTRAINT "tenant_payments_tenant_booking_id_tenant_bookings_id_fk" FOREIGN KEY ("tenant_booking_id") REFERENCES "sport_center"."tenant_bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."booking_extension_requests" ADD CONSTRAINT "booking_extension_requests_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "sport_center"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."wa_action_tokens" ADD CONSTRAINT "wa_action_tokens_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "sport_center"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."users" ADD CONSTRAINT "users_google_id_unique" UNIQUE("google_id");--> statement-breakpoint
ALTER TABLE "sport_center"."users" ADD CONSTRAINT "users_customer_code_unique" UNIQUE("customer_code");