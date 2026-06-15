import pg from "pg";
import crypto from "crypto";

const { Client } = pg;
const url = process.env.SUPABASE_DATABASE_URL_DEV || process.env.DATABASE_URL || "";
const client = new Client({ connectionString: url, ssl: false });

async function q(sql: string, params: any[] = []) {
  return client.query(sql, params);
}

async function main() {
  await client.connect();
  console.log("Connected to dev DB:", url.split("@").pop());

  // Fix settings
  await q(`DELETE FROM sport_center.settings WHERE id > 1`);
  await q(`UPDATE sport_center.settings SET
    center_name='Sport Center Jakarta',
    address='Jl. Sudirman No. 88, Jakarta Pusat',
    phone='021-5555-8888',
    whatsapp='6281234567890',
    email='info@sportcenterjakarta.com',
    open_hour='06:00',
    close_hour='23:00',
    bank_name='BCA',
    bank_account='1234567890',
    bank_account_name='PT Sport Center Jakarta',
    app_url='https://sportcenterjakarta.replit.app'
    WHERE id=1`);
  console.log("✓ Settings updated");

  // Re-seed admin with correct hash
  const secret = process.env.SESSION_SECRET || "dev-secret";
  const hash = crypto.createHmac("sha256", secret).update("admin123").digest("hex");
  await q(`UPDATE sport_center.users SET password_hash=$1 WHERE email='admin@sportcenter.com'`, [hash]);
  console.log("✓ Admin hash updated");

  // Facilities — uses open_time / close_time
  const facilities = [
    { name: "Lapangan Futsal A", cat: "futsal", desc: "Lapangan futsal indoor rumput sintetis, kapasitas 10 pemain", price: 150000, open: "06:00", close: "23:00", img: "https://images.unsplash.com/photo-1529551739587-e242c564f727?w=800" },
    { name: "Lapangan Futsal B", cat: "futsal", desc: "Lapangan futsal outdoor, dilengkapi lampu malam hari", price: 120000, open: "06:00", close: "22:00", img: "https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800" },
    { name: "Lapangan Badminton 1", cat: "badminton", desc: "Lapangan badminton indoor dengan lantai kayu, standar BWF", price: 80000, open: "06:00", close: "23:00", img: "https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=800" },
    { name: "Lapangan Badminton 2", cat: "badminton", desc: "Lapangan badminton indoor dengan AC, nyaman untuk latihan", price: 80000, open: "06:00", close: "23:00", img: "https://images.unsplash.com/photo-1628891890467-b79f2c8ba9dc?w=800" },
    { name: "Lapangan Basket", cat: "basket", desc: "Lapangan basket full-court indoor, lantai parket premium", price: 200000, open: "07:00", close: "22:00", img: "https://images.unsplash.com/photo-1546519638-68e109498ffc?w=800" },
    { name: "Meja Tenis 1", cat: "tenis_meja", desc: "Meja tenis indoor, tersedia perlengkapan sewa", price: 30000, open: "08:00", close: "22:00", img: "https://images.unsplash.com/photo-1593341646782-e0b495cff86d?w=800" },
    { name: "Kolam Renang", cat: "renang", desc: "Kolam renang olimpiade 50m, air bersih berfilter UV", price: 50000, open: "06:00", close: "20:00", img: "https://images.unsplash.com/photo-1575429198097-0414ec08e8cd?w=800" },
    { name: "GOR Serbaguna", cat: "serbaguna", desc: "GOR serbaguna kapasitas 500 orang, cocok untuk event & turnamen", price: 500000, open: "07:00", close: "22:00", img: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800" },
  ];

  const facIds: number[] = [];
  for (const f of facilities) {
    const res = await q(`
      INSERT INTO sport_center.facilities (name, category, description, price_per_hour, open_time, close_time, image_url, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,true)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [f.name, f.cat, f.desc, f.price, f.open, f.close, f.img]);
    if (res.rows[0]) facIds.push(res.rows[0].id);
  }
  if (facIds.length === 0) {
    const res = await q(`SELECT id FROM sport_center.facilities ORDER BY id LIMIT 8`);
    facIds.push(...res.rows.map((r: any) => r.id));
  }
  console.log(`✓ Facilities: ${facIds.length} seeded (IDs: ${facIds.join(",")})`);

  // Promos — uses type enum (promo/event), no promo_type column
  await q(`
    INSERT INTO sport_center.promos (title, description, type, discount_percent, start_date, end_date, is_active, image_url)
    VALUES
      ('Promo Pagi Ceria','Diskon 30% untuk booking jam 06:00-09:00','promo',30,'2026-06-01','2026-08-31',true,'https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800'),
      ('Weekend Warrior','Diskon 20% untuk booking hari Sabtu & Minggu','promo',20,'2026-06-01','2026-12-31',true,'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800'),
      ('Turnamen Futsal HUT RI','Daftar turnamen futsal menyambut HUT ke-81 RI! Total hadiah Rp 50 juta','event',null,'2026-08-01','2026-08-17',true,'https://images.unsplash.com/photo-1529551739587-e242c564f727?w=800'),
      ('Member Baru -25%','Diskon 25% untuk pendaftar member baru bulan Juni','promo',25,'2026-06-01','2026-06-30',true,null)
    ON CONFLICT DO NOTHING
  `).catch((e: any) => console.log("Promos skip:", e.message));
  console.log("✓ Promos seeded");

  // Bookings
  if (facIds.length > 0) {
    const names   = ['Budi Santoso','Sari Dewi','Andi Kurniawan','Rina Maharani','Dodi Prasetyo','Fitri Handayani','Rizal Fauzan','Mega Lestari','Hendra Gunawan','Nita Permata'];
    const phones  = ['081111111111','082222222222','083333333333','084444444444','085555555555','086666666666','087777777777','088888888888','089999999999','081000000000'];
    const prices  = [30000,50000,80000,120000,150000,200000];
    const now     = new Date('2026-06-15');

    for (let i = 0; i < 45; i++) {
      const daysOffset = Math.floor(Math.random() * 210) - 150;
      const d = new Date(now);
      d.setDate(d.getDate() + daysOffset);
      const dateStr  = d.toISOString().split('T')[0];
      const startH   = 7 + Math.floor(Math.random() * 13);
      const dur      = [1,1,2,2,3][Math.floor(Math.random() * 5)];
      const endH     = Math.min(startH + dur, 22);
      const startTime = `${String(startH).padStart(2,'0')}:00`;
      const endTime   = `${String(endH).padStart(2,'0')}:00`;
      const facId     = facIds[Math.floor(Math.random() * facIds.length)];
      const ni        = i % names.length;
      const ppH       = prices[Math.floor(Math.random() * prices.length)];
      const totalP    = ppH * dur;
      const isPast    = daysOffset < -3;
      const status    = isPast
        ? (['completed','completed','completed','confirmed','confirmed'] as const)[Math.floor(Math.random()*5)]
        : (['confirmed','pending_payment','waiting_confirmation','confirmed'] as const)[Math.floor(Math.random()*4)];
      const orderNum  = `SC-${dateStr.replace(/-/g,'')}-${String(i+1).padStart(4,'0')}`;

      await q(`
        INSERT INTO sport_center.bookings
          (order_number,customer_name,customer_email,customer_phone,facility_id,
           booking_date,start_time,end_time,duration_hours,total_price,status,source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'website')
        ON CONFLICT DO NOTHING
      `, [orderNum, names[ni], `user${ni+1}@email.com`, phones[ni], facId, dateStr, startTime, endTime, dur, totalP, status]).catch(()=>{});
    }
    console.log("✓ 45 bookings seeded");

    // Payments for confirmed/completed
    await q(`
      INSERT INTO sport_center.payments (booking_id, amount, payment_method, proof_url, status, confirmed_at)
      SELECT b.id, b.total_price, 'Transfer Bank',
             'https://images.unsplash.com/photo-1518458028785-8fbcd101ebb9?w=400',
             'confirmed', now() - interval '1 day'
      FROM sport_center.bookings b
      WHERE b.status IN ('confirmed','completed')
      AND NOT EXISTS (SELECT 1 FROM sport_center.payments p WHERE p.booking_id=b.id)
    `).catch((e: any) => console.log("Payments skip:", e.message));
    console.log("✓ Payments seeded");
  }

  // Gym memberships — uses name/email/phone/months/total_price
  await q(`
    INSERT INTO sport_center.gym_memberships (name, email, phone, start_date, end_date, months, total_price, status)
    VALUES
      ('Arif Rahman','arif@email.com','081111222233','2026-06-01','2026-06-30',1,300000,'active'),
      ('Dewi Kusuma','dewi@email.com','081111222244','2026-05-01','2026-07-31',3,750000,'active'),
      ('Bima Sakti','bima@email.com','081111222255','2026-01-01','2026-12-31',12,2400000,'active'),
      ('Siti Rahayu','siti@email.com','081111222266','2026-05-01','2026-05-31',1,300000,'expired')
    ON CONFLICT DO NOTHING
  `).catch((e: any) => console.log("Memberships skip:", e.message));
  console.log("✓ Gym memberships seeded");

  // Tax settings
  await q(`
    INSERT INTO sport_center.tax_settings (tax_code, tax_name, tax_rate, tax_type, applies_to, is_active)
    VALUES ('PPN_OUT_11','PPN Keluaran 11%',11,'ppn_keluaran','booking',true)
    ON CONFLICT (tax_code) DO NOTHING
  `).catch(()=>{});
  console.log("✓ Tax settings seeded");

  await client.end();
  console.log("\n✅ Dev DB seeded successfully!");
}

main().catch(e => { console.error("Seed failed:", e.message); process.exit(1); });
