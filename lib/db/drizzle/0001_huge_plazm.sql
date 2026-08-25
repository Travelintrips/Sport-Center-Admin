CREATE TYPE "sport_center"."customer_type" AS ENUM('umum', 'angkasa_pura');--> statement-breakpoint
CREATE TYPE "sport_center"."verification_status" AS ENUM('not_required', 'pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE "sport_center"."ap_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"id_card_number" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ap_members_id_card_number_unique" UNIQUE("id_card_number")
);
--> statement-breakpoint
CREATE TABLE "sport_center"."discount_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_type" text NOT NULL,
	"discount_percentage" integer DEFAULT 0 NOT NULL,
"discount_amount" integer,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_settings_customer_type_unique" UNIQUE("customer_type")
);
--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "customer_type" "sport_center"."customer_type" DEFAULT 'umum' NOT NULL;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "id_card_number" text;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "verification_status" "sport_center"."verification_status" DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "base_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "ap_discount_amount" numeric(12, 2) DEFAULT '0' NOT NULL;