import pg from "pg";

const SOURCE_SYSTEM = "sport_center";

type QueryClient = pg.PoolClient | pg.Pool;

export type SportCenterBookingProjection = {
  publicBookingId: number;
  sourceBookingId: number;
  companyId: number;
  facilityId: number | null;
  orderNumber: string;
};

export type CanonicalBankAccountResolution = {
  sourceAccountRef: string;
  canonicalBankAccountId: number;
  mappingId: number;
};

function bookingStatus(status: string | null | undefined): string {
  switch (status) {
    case "confirmed":
    case "completed":
      return status;
    case "cancelled":
    case "rejected":
    case "expired":
    case "refunded":
      return "cancelled";
    default:
      return "pending";
  }
}

function paymentStatus(status: string | null | undefined): string {
  switch (status) {
    case "paid":
    case "confirmed":
    case "completed":
      return "paid";
    case "waiting_confirmation":
      return "pending";
    default:
      return "unpaid";
  }
}

export async function ensureSportCenterBookingMirror(
  client: QueryClient,
  sourceBookingId: number,
  effectiveDate?: string | null,
): Promise<SportCenterBookingProjection> {
  const sourceResult = await client.query(
    `SELECT sb.id, sb.order_number, sb.customer_id, sb.customer_name,
            sb.customer_phone, sb.customer_email, sb.facility_id,
            sb.booking_date, sb.start_time, sb.end_time, sb.duration_hours,
             sb.total_price, sb.discount_amount, sb.status,
            sb.notes, sb.ppn_rate, sb.ppn_amount, sb.grand_total,
            sb.created_at,
            sf.name AS facility_name
       FROM sport_center.sport_bookings sb
       LEFT JOIN sport_center.sport_facilities sf ON sf.id = sb.facility_id
      WHERE sb.id = $1
       FOR SHARE OF sb`,
    [sourceBookingId],
  );
  const source = sourceResult.rows[0];
  if (!source) {
    throw new Error(`BOOKING_PROJECTION_SOURCE_NOT_FOUND:${sourceBookingId}`);
  }

  const ownershipDate =
    effectiveDate ??
    (source.booking_date ? String(source.booking_date).slice(0, 10) : null) ??
    new Date(source.created_at).toISOString().slice(0, 10);
  const ownership = await client.query(
    `SELECT fcm.id, fcm.company_id,
            COALESCE(c.name, c.company_name, c.code) AS company_name,
            c.is_active
       FROM sport_center.facility_company_mappings fcm
       JOIN public.companies c ON c.id = fcm.company_id
      WHERE fcm.facility_id = $1
        AND fcm.is_active = true
        AND c.is_active = true
        AND fcm.effective_from <= $2::date
        AND (fcm.effective_until IS NULL OR fcm.effective_until >= $2::date)
      ORDER BY fcm.effective_from DESC, fcm.id DESC`,
    [source.facility_id, ownershipDate],
  );
  if (ownership.rows.length !== 1) {
    throw new Error(
      `BOOKING_COMPANY_RESOLUTION_REQUIRED:${sourceBookingId}:candidates=${ownership.rows.length}`,
    );
  }
  const companyId = Number(ownership.rows[0].company_id);

  const facility = await client.query(
    `SELECT id
       FROM public.sport_facilities
      WHERE company_id = $1
        AND LOWER(TRIM(name)) = LOWER(TRIM($2))
      ORDER BY id
      LIMIT 1`,
    [companyId, source.facility_name ?? ""],
  );
  const publicFacilityId = facility.rows[0]?.id == null
    ? null
    : Number(facility.rows[0].id);
  const customer = source.customer_id == null
    ? { rows: [] as Array<{ id: number }> }
    : await client.query(
        `SELECT id
           FROM public.sport_customers
          WHERE id = $1
          LIMIT 1`,
        [source.customer_id],
      );
  const publicCustomerId = customer.rows[0]?.id == null
    ? null
    : Number(customer.rows[0].id);
  const ppnRate = source.ppn_rate == null ? 0 : Number(source.ppn_rate);
  const ppnAmount = source.ppn_amount == null ? 0 : Math.round(Number(source.ppn_amount));
  const totalAmount = source.grand_total == null
    ? Math.round(Number(source.total_price))
    : Math.round(Number(source.grand_total));
  const baseAmount = Math.max(0, totalAmount - ppnAmount);

  const existing = await client.query(
    `SELECT id, booking_number, sc_booking_id
       FROM public.sport_bookings
      WHERE sc_booking_id = $1
      FOR UPDATE`,
    [sourceBookingId],
  );
  if (existing.rows.length > 1) {
    throw new Error(`BOOKING_PROJECTION_DUPLICATE:${sourceBookingId}`);
  }

  const result = await client.query(
    `INSERT INTO public.sport_bookings
       (company_id, booking_number, customer_id, customer_name, customer_phone,
        facility_id, facility_name, booking_date, start_time, end_time,
        duration_hours, status, payment_status, base_amount, discount_amount,
        total_amount, promo_code, notes, created_at, updated_at, tax_rate,
        tax_amount, customer_email, sc_booking_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9::time,$10::time,$11,$12,$13,
             $14,$15,$16,NULL,$17,$18,NOW(),$19,$20,$21,$22)
     ON CONFLICT (booking_number) DO UPDATE SET
       company_id = EXCLUDED.company_id,
       booking_number = EXCLUDED.booking_number,
       sc_booking_id = EXCLUDED.sc_booking_id,
       customer_id = COALESCE(EXCLUDED.customer_id, public.sport_bookings.customer_id),
       customer_name = EXCLUDED.customer_name,
       customer_phone = EXCLUDED.customer_phone,
       facility_id = EXCLUDED.facility_id,
       facility_name = EXCLUDED.facility_name,
       booking_date = EXCLUDED.booking_date,
       start_time = EXCLUDED.start_time,
       end_time = EXCLUDED.end_time,
       duration_hours = EXCLUDED.duration_hours,
       status = EXCLUDED.status,
       payment_status = EXCLUDED.payment_status,
       base_amount = EXCLUDED.base_amount,
       discount_amount = EXCLUDED.discount_amount,
       total_amount = EXCLUDED.total_amount,
       notes = EXCLUDED.notes,
       updated_at = NOW(),
       tax_rate = EXCLUDED.tax_rate,
       tax_amount = EXCLUDED.tax_amount,
       customer_email = EXCLUDED.customer_email
     RETURNING id`,
    [
      companyId,
      String(source.order_number),
       publicCustomerId,
      String(source.customer_name),
      source.customer_phone ?? null,
      publicFacilityId,
      source.facility_name ?? "Sport Center",
      String(source.booking_date),
      String(source.start_time),
      String(source.end_time),
      Number(source.duration_hours ?? 1),
      bookingStatus(source.status),
      paymentStatus(source.status),
      baseAmount,
      Math.round(Number(source.discount_amount ?? 0)),
      totalAmount,
      source.notes ?? null,
      source.created_at ?? new Date(),
      ppnRate,
      ppnAmount,
      source.customer_email ?? null,
      sourceBookingId,
    ],
  );
  const publicBookingId = Number(result.rows[0]?.id ?? existing.rows[0]?.id);
  if (!publicBookingId) {
    throw new Error(`BOOKING_PROJECTION_WRITE_FAILED:${sourceBookingId}`);
  }
  return {
    publicBookingId,
    sourceBookingId,
    companyId,
    facilityId: publicFacilityId,
    orderNumber: String(source.order_number),
  };
}

export async function resolveCanonicalBankAccount(
  client: QueryClient,
  companyId: number,
  sourceAccountRef: string | null | undefined,
  provider: string | null | undefined,
  effectiveDate: string,
): Promise<CanonicalBankAccountResolution> {
  const normalizedRef = String(sourceAccountRef ?? "").trim();
  if (!normalizedRef) {
    throw new Error("BANK_ACCOUNT_MAPPING_REQUIRED:source_reference_missing");
  }
  const normalizedProvider = String(provider ?? "").trim().toLowerCase();
  const rows = await client.query(
    `SELECT id, canonical_bank_account_id
       FROM sport_center.bank_account_source_mappings
      WHERE company_id = $1
        AND source_system = $2
        AND source_account_ref = $3
        AND provider = $4
        AND is_active = true
        AND effective_from <= $5::date
        AND (effective_until IS NULL OR effective_until >= $5::date)
      ORDER BY effective_from DESC, id DESC
      FOR SHARE`,
    [companyId, SOURCE_SYSTEM, normalizedRef, normalizedProvider, effectiveDate],
  );
  if (rows.rows.length !== 1) {
    throw new Error(
      `BANK_ACCOUNT_MAPPING_REQUIRED:${companyId}:${normalizedRef}:${normalizedProvider}:candidates=${rows.rows.length}`,
    );
  }
  return {
    sourceAccountRef: normalizedRef,
    canonicalBankAccountId: Number(rows.rows[0].canonical_bank_account_id),
    mappingId: Number(rows.rows[0].id),
  };
}