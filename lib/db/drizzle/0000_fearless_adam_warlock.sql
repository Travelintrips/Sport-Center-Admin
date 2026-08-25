CREATE SCHEMA IF NOT EXISTS "sport_center";
--> statement-breakpoint
CREATE TYPE "sport_center"."user_role" AS ENUM('admin', 'customer');--> statement-breakpoint
CREATE TYPE "sport_center"."booking_status" AS ENUM('pending_payment', 'paid', 'confirmed', 'cancelled', 'completed', 'refunded');--> statement-breakpoint
CREATE TYPE "sport_center"."payment_status" AS ENUM('pending', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TYPE "sport_center"."promo_type" AS ENUM('promo', 'event');--> statement-breakpoint
CREATE TYPE "sport_center"."membership_status" AS ENUM('active', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "sport_center"."users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "sport_center"."user_role" DEFAULT 'customer' NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sport_center"."facilities" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text,
	"price_per_hour" numeric(12, 2) NOT NULL,
	"open_time" text DEFAULT '06:00' NOT NULL,
	"close_time" text DEFAULT '22:00' NOT NULL,
	"min_duration" integer DEFAULT 1 NOT NULL,
	"max_duration" integer,
	"capacity" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."facility_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"url" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."admin_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"customer_id" integer,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text NOT NULL,
	"facility_id" integer NOT NULL,
	"booking_date" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"duration_hours" integer NOT NULL,
	"total_price" numeric(12, 2) NOT NULL,
	"promo_code" text,
	"discount_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" "sport_center"."booking_status" DEFAULT 'pending_payment' NOT NULL,
	"notes" text,
	"admin_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "sport_center"."payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"proof_url" text,
	"status" "sport_center"."payment_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
CREATE TABLE "sport_center"."promo_registrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"promo_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."promos" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"type" "sport_center"."promo_type" DEFAULT 'promo' NOT NULL,
	"discount_percent" numeric(5, 2),
	"start_date" text,
	"end_date" text,
	"image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"code" text,
	"discount_type" text DEFAULT 'percent' NOT NULL,
	"discount_amount" numeric(12, 2),
	"min_purchase" numeric(12, 2),
	"max_uses" integer,
	"used_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promos_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sport_center"."blocked_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"facility_id" integer NOT NULL,
	"date" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"center_name" text DEFAULT 'Sport Center' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"whatsapp" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"open_hour" text DEFAULT '06:00',
	"close_hour" text DEFAULT '22:00',
	"logo_url" text,
	"bank_name" text,
	"bank_account" text,
	"bank_account_name" text,
	"qris_image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."gym_memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"months" integer DEFAULT 1 NOT NULL,
	"total_price" numeric(12, 2) NOT NULL,
	"status" "sport_center"."membership_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sport_center"."facility_images" ADD CONSTRAINT "facility_images_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "sport_center"."facilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."admin_notes" ADD CONSTRAINT "admin_notes_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "sport_center"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD CONSTRAINT "bookings_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sport_center"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD CONSTRAINT "bookings_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "sport_center"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "sport_center"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."promo_registrations" ADD CONSTRAINT "promo_registrations_promo_id_promos_id_fk" FOREIGN KEY ("promo_id") REFERENCES "sport_center"."promos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."blocked_schedules" ADD CONSTRAINT "blocked_schedules_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "sport_center"."facilities"("id") ON DELETE cascade ON UPDATE no action;