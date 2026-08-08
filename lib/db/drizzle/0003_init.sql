CREATE TYPE "sport_center"."user_account_type" AS ENUM('personal', 'company');--> statement-breakpoint
CREATE TYPE "sport_center"."billing_status" AS ENUM('unbilled', 'billed', 'paid');--> statement-breakpoint
CREATE TYPE "sport_center"."payer_type" AS ENUM('personal', 'company');--> statement-breakpoint
CREATE TYPE "sport_center"."payment_type" AS ENUM('dp', 'pelunasan', 'full_payment');--> statement-breakpoint
CREATE TYPE "sport_center"."invoice_status" AS ENUM('unpaid', 'partial_paid', 'paid');--> statement-breakpoint
CREATE TYPE "sport_center"."company_verification_status" AS ENUM('pending', 'approved', 'rejected', 'revoked');--> statement-breakpoint
CREATE TYPE "sport_center"."bank_mutation_status" AS ENUM('unmatched', 'need_review', 'auto_matched', 'matched', 'duplicate_need_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "sport_center"."recon_candidate_type" AS ENUM('payment', 'order', 'invoice', 'expense');--> statement-breakpoint
CREATE TYPE "sport_center"."recon_match_status" AS ENUM('candidate', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "sport_center"."booking_group_status" AS ENUM('pending', 'paid');--> statement-breakpoint
CREATE TYPE "sport_center"."expense_category" AS ENUM('Alat Gym', 'Bola & Peralatan Olahraga', 'Perbaikan Lapangan', 'Maintenance Fasilitas', 'Listrik & Air', 'Kebersihan', 'Gaji / Fee Staff', 'Sewa / Vendor', 'Lain-lain');--> statement-breakpoint
CREATE TYPE "sport_center"."expense_status" AS ENUM('draft', 'pending_approval', 'approved', 'paid', 'rejected', 'cancelled');--> statement-breakpoint
ALTER TYPE "sport_center"."booking_status" ADD VALUE 'waiting_admin_approval' BEFORE 'paid';--> statement-breakpoint
CREATE TABLE "sport_center"."company_invoice_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"booking_id" integer,
	"company_id" integer,
	"booking_date" text,
	"facility_name" text,
	"customer_name" text,
	"customer_phone" text,
	"start_time" text,
	"end_time" text,
	"duration_hours" numeric(6, 2),
	"price_per_hour" numeric(12, 2),
	"subtotal" numeric(14, 2),
	"tax_amount" numeric(14, 2),
	"total_amount" numeric(14, 2),
	"order_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."company_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" text NOT NULL,
	"company_customer_id" integer NOT NULL,
	"period_month" text NOT NULL,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"ppn_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"remaining_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"invoice_status" "sport_center"."invoice_status" DEFAULT 'unpaid' NOT NULL,
	"paid_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "sport_center"."company_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"employee_id" text NOT NULL,
	"office_email" text,
	"id_card_url" text,
	"verification_status" "sport_center"."company_verification_status" DEFAULT 'pending' NOT NULL,
	"corporate_billing_enabled" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by" integer,
	"rejection_reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_users_company_employee_unique" UNIQUE("company_id","employee_id")
);
--> statement-breakpoint
CREATE TABLE "sport_center"."company_verifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_user_id" integer,
	"company_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"employee_id" text NOT NULL,
	"office_email" text,
	"id_card_url" text,
	"status" "sport_center"."company_verification_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" integer,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."company_verification_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"verification_id" integer NOT NULL,
	"action" text NOT NULL,
	"used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_verification_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sport_center"."tax_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tax_code" text NOT NULL,
	"tax_name" text NOT NULL,
	"tax_rate" numeric(5, 2) NOT NULL,
	"tax_type" text DEFAULT 'output_vat' NOT NULL,
	"applies_to" text DEFAULT 'sport_center_booking' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_settings_tax_code_unique" UNIQUE("tax_code")
);
--> statement-breakpoint
CREATE TABLE "sport_center"."tax_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" integer NOT NULL,
	"reference_number" text NOT NULL,
	"tax_code" text NOT NULL,
	"tax_rate" numeric(5, 2) NOT NULL,
	"dpp" numeric(14, 2) NOT NULL,
	"tax_amount" numeric(14, 2) NOT NULL,
	"transaction_date" text NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"transaction_type" text DEFAULT 'original' NOT NULL,
	"reversal_of_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."accounting_journals" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"order_number" text NOT NULL,
	"journal_type" text NOT NULL,
	"debit_account" text DEFAULT 'Kas/Bank' NOT NULL,
	"debit_amount" numeric(14, 2) NOT NULL,
	"credit_revenue_account" text DEFAULT 'Pendapatan Sport Center' NOT NULL,
	"credit_revenue_amount" numeric(14, 2) NOT NULL,
	"credit_ppn_account" text DEFAULT 'PPN Keluaran' NOT NULL,
	"credit_ppn_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"journal_date" text NOT NULL,
	"is_reversal" boolean DEFAULT false NOT NULL,
	"reversal_of_id" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."bank_account_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"bank_account_id" text NOT NULL,
	"company_id" integer,
	"opening_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"current_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"last_reconciled_balance" numeric(14, 2) DEFAULT '0',
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."bank_journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"journal_id" text NOT NULL,
	"mutation_id" integer NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"debit_account_code" text NOT NULL,
	"debit_account_name" text NOT NULL,
	"credit_account_code" text NOT NULL,
	"credit_account_name" text NOT NULL,
	"memo" text,
	"candidate_type" text,
	"candidate_id" integer,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by" text,
	CONSTRAINT "bank_journal_entries_journal_id_unique" UNIQUE("journal_id")
);
--> statement-breakpoint
CREATE TABLE "sport_center"."bank_mutations" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"bank_account_id" text,
	"transaction_date" text NOT NULL,
	"description" text NOT NULL,
	"credit_amount" numeric(14, 2) DEFAULT '0',
	"debit_amount" numeric(14, 2) DEFAULT '0',
	"amount" numeric(14, 2) NOT NULL,
	"direction" text NOT NULL,
	"mutation_key" text NOT NULL,
	"normalized_description" text,
	"provider_name" text,
	"provider_order_id" text,
	"raw_payload" jsonb,
	"status" "sport_center"."bank_mutation_status" DEFAULT 'unmatched' NOT NULL,
	"matched_payment_id" integer,
	"matched_order_id" integer,
	"uploaded_proof_url" text,
	"transaction_type" text,
	"tax_type" text,
	"tax_period" text,
	"tax_payment_reference" text,
	"accounting_posted" boolean DEFAULT false NOT NULL,
	"journal_id" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"rejected_by" text,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."bank_reconciliation_account_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"bank_account_id" text,
	"transaction_type" text NOT NULL,
	"direction" text NOT NULL,
	"debit_coa_id" text NOT NULL,
	"debit_coa_name" text NOT NULL,
	"credit_coa_id" text NOT NULL,
	"credit_coa_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."bank_reconciliation_closing" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"bank_account_id" text,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"opening_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_in" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_out" numeric(14, 2) DEFAULT '0' NOT NULL,
	"system_ending_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"statement_ending_balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"difference" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'unreconciled' NOT NULL,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"reopened_by" text,
	"reopened_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."bank_reconciliation_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"mutation_id" integer NOT NULL,
	"candidate_type" "sport_center"."recon_candidate_type" NOT NULL,
	"candidate_id" integer NOT NULL,
	"match_score" integer DEFAULT 0 NOT NULL,
	"match_reason" text,
	"amount_match" boolean DEFAULT false NOT NULL,
	"date_match" boolean DEFAULT false NOT NULL,
	"name_match" boolean DEFAULT false NOT NULL,
	"order_id_match" boolean DEFAULT false NOT NULL,
	"proof_match" boolean DEFAULT false NOT NULL,
	"status_valid_match" boolean DEFAULT false NOT NULL,
	"tolerance_used" boolean DEFAULT false NOT NULL,
	"note" text,
	"status" "sport_center"."recon_match_status" DEFAULT 'candidate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."booking_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"group_ref" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_name" text NOT NULL,
	"total_payment" numeric(12, 2) NOT NULL,
	"status" "sport_center"."booking_group_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_groups_group_ref_unique" UNIQUE("group_ref")
);
--> statement-breakpoint
CREATE TABLE "sport_center"."wa_booking_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"customer_id" integer,
	"current_step" text DEFAULT 'ask_facility' NOT NULL,
	"facility_id" integer,
	"booking_date" text,
	"start_time" text,
	"duration_minutes" integer,
	"booker_name" text,
	"customer_name" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"raw_messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expired_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sport_center"."sport_expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"expense_no" text NOT NULL,
	"expense_date" text NOT NULL,
	"category" "sport_center"."expense_category" NOT NULL,
	"description" text NOT NULL,
	"vendor_name" text,
	"facility_id" integer,
	"amount" numeric(14, 2) NOT NULL,
	"ppn_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"payment_method" text,
	"payment_account" text,
	"payment_status" "sport_center"."expense_status" DEFAULT 'draft' NOT NULL,
	"receipt_url" text,
	"notes" text,
	"created_by" integer,
	"approved_by" integer,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"rejected_reason" text,
	"journal_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sport_center"."payments" DROP CONSTRAINT "payments_booking_id_unique";--> statement-breakpoint
ALTER TABLE "sport_center"."users" ADD COLUMN "account_type" "sport_center"."user_account_type" DEFAULT 'personal';--> statement-breakpoint
ALTER TABLE "sport_center"."users" ADD COLUMN "company_name" text;--> statement-breakpoint
ALTER TABLE "sport_center"."users" ADD COLUMN "pic_name" text;--> statement-breakpoint
ALTER TABLE "sport_center"."users" ADD COLUMN "pic_phone" text;--> statement-breakpoint
ALTER TABLE "sport_center"."users" ADD COLUMN "pic_email" text;--> statement-breakpoint
ALTER TABLE "sport_center"."users" ADD COLUMN "billing_address" text;--> statement-breakpoint
ALTER TABLE "sport_center"."users" ADD COLUMN "payment_terms_days" integer DEFAULT 30;--> statement-breakpoint
ALTER TABLE "sport_center"."users" ADD COLUMN "monthly_credit_limit" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "sport_center"."users" ADD COLUMN "allow_monthly_billing" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "sport_center"."users" ADD COLUMN "account_status" text DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "booker_name" text;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "payment_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "payer_type" "sport_center"."payer_type" DEFAULT 'personal';--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "company_customer_id" integer;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "booked_for_name" text;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "booked_for_phone" text;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "payment_required_now" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "billing_status" "sport_center"."billing_status";--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "company_invoice_id" integer;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "ppn_rate" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "ppn_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "grand_total" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "down_payment" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "is_dp_paid" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "booked_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "group_ref" text;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "approved_by_admin_phone" text;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "rejected_reason" text;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sport_center"."payments" ADD COLUMN "payment_type" "sport_center"."payment_type" DEFAULT 'full_payment' NOT NULL;--> statement-breakpoint
ALTER TABLE "sport_center"."payments" ADD COLUMN "ocr_name" text;--> statement-breakpoint
ALTER TABLE "sport_center"."payments" ADD COLUMN "ocr_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "sport_center"."payments" ADD COLUMN "ocr_date" text;--> statement-breakpoint
ALTER TABLE "sport_center"."payments" ADD COLUMN "ocr_raw" text;--> statement-breakpoint
ALTER TABLE "sport_center"."payments" ADD COLUMN "ocr_data" jsonb;--> statement-breakpoint
ALTER TABLE "sport_center"."settings" ADD COLUMN "fonnte_token" text;--> statement-breakpoint
ALTER TABLE "sport_center"."settings" ADD COLUMN "fonnte_admin_wa" text;--> statement-breakpoint
ALTER TABLE "sport_center"."settings" ADD COLUMN "admin_wa_phones" text;--> statement-breakpoint
ALTER TABLE "sport_center"."settings" ADD COLUMN "app_url" text;--> statement-breakpoint
ALTER TABLE "sport_center"."company_invoice_items" ADD CONSTRAINT "company_invoice_items_invoice_id_company_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "sport_center"."company_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."company_invoices" ADD CONSTRAINT "company_invoices_company_customer_id_users_id_fk" FOREIGN KEY ("company_customer_id") REFERENCES "sport_center"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."company_users" ADD CONSTRAINT "company_users_company_id_users_id_fk" FOREIGN KEY ("company_id") REFERENCES "sport_center"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."company_users" ADD CONSTRAINT "company_users_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sport_center"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."company_users" ADD CONSTRAINT "company_users_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "sport_center"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."company_verifications" ADD CONSTRAINT "company_verifications_company_user_id_company_users_id_fk" FOREIGN KEY ("company_user_id") REFERENCES "sport_center"."company_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."company_verifications" ADD CONSTRAINT "company_verifications_company_id_users_id_fk" FOREIGN KEY ("company_id") REFERENCES "sport_center"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."company_verifications" ADD CONSTRAINT "company_verifications_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sport_center"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."company_verifications" ADD CONSTRAINT "company_verifications_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "sport_center"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."company_verification_tokens" ADD CONSTRAINT "company_verification_tokens_verification_id_company_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "sport_center"."company_verifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."accounting_journals" ADD CONSTRAINT "accounting_journals_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "sport_center"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."bank_journal_entries" ADD CONSTRAINT "bank_journal_entries_mutation_id_bank_mutations_id_fk" FOREIGN KEY ("mutation_id") REFERENCES "sport_center"."bank_mutations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_mutation_id_bank_mutations_id_fk" FOREIGN KEY ("mutation_id") REFERENCES "sport_center"."bank_mutations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."wa_booking_sessions" ADD CONSTRAINT "wa_booking_sessions_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "sport_center"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."sport_expenses" ADD CONSTRAINT "sport_expenses_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "sport_center"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."sport_expenses" ADD CONSTRAINT "sport_expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "sport_center"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."sport_expenses" ADD CONSTRAINT "sport_expenses_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "sport_center"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_invoices_company_period_unique" ON "sport_center"."company_invoices" USING btree ("company_customer_id","period_month");--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD CONSTRAINT "bookings_company_customer_id_users_id_fk" FOREIGN KEY ("company_customer_id") REFERENCES "sport_center"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sport_center"."bookings" ADD CONSTRAINT "bookings_booked_by_user_id_users_id_fk" FOREIGN KEY ("booked_by_user_id") REFERENCES "sport_center"."users"("id") ON DELETE set null ON UPDATE no action;