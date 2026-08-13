import crypto from "crypto";
import { db, usersTable, facilitiesTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const SECRET = process.env.SESSION_SECRET || "sport-center-secret-key-2024";

function hashPassword(password: string): string {
  return crypto.createHmac("sha256", SECRET).update(password).digest("hex");
}

async function main() {
  // Seed admin
  const passwordHash = hashPassword("admin123");
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, "admin@sportcenter.com")).limit(1);
  if (existing.length > 0) {
    await db.update(usersTable).set({ passwordHash, role: "admin", name: "Admin" }).where(eq(usersTable.email, "admin@sportcenter.com"));
    console.log("Admin user updated");
  } else {
    await db.insert(usersTable).values({ name: "Admin", email: "admin@sportcenter.com", passwordHash, role: "admin" });
    console.log("Admin user created");
  }

  // Seed settings
  const existingSettings = await db.select().from(settingsTable).limit(1);
  if (existingSettings.length === 0) {
    await db.insert(settingsTable).values({
      centerName: "Sport Center Jakarta",
      address: "Jl. Sudirman No. 123, Jakarta Pusat",
      phone: "+62-21-1234567",
      whatsapp: "+6281216104734",
      email: "info@sportcenterjakarta.com",
      openHour: "06:00",
      closeHour: "22:00",
      bankName: "BCA",
      bankAccount: "1234567890",
      bankAccountName: "Sport Center Jakarta",
      qrisImageUrl: "/uploads/qris-263226c1-c51d-4353-9165-cedaba32adb4.jpeg",
    });
    console.log("Settings created");
  }

  // Seed facilities
  const facilitySeed = [
      {
        name: "Lapangan Badminton A",
        category: "Badminton",
        description: "Lapangan badminton indoor premium dengan lantai kayu parket, pencahayaan LED terang, dan AC.",
        pricePerHour: "80000",
        openTime: "06:00",
        closeTime: "22:00",
        minDuration: 1,
        maxDuration: 4,
        capacity: 4,
        isActive: true,
      },
      {
        name: "Lapangan Badminton B",
        category: "Badminton",
        description: "Lapangan badminton indoor dengan fasilitas lengkap. Cocok untuk latihan dan pertandingan.",
        pricePerHour: "75000",
        openTime: "06:00",
        closeTime: "22:00",
        minDuration: 1,
        maxDuration: 4,
        capacity: 4,
        isActive: true,
      },
      {
        name: "Lapangan Futsal",
        category: "Futsal",
        description: "Lapangan futsal indoor dengan rumput sintetis berkualitas tinggi dan sistem drainase baik.",
        pricePerHour: "200000",
        openTime: "07:00",
        closeTime: "22:00",
        minDuration: 1,
        maxDuration: 3,
        capacity: 14,
        isActive: true,
      },
      {
        name: "Kolam Renang Olympic",
        category: "Renang",
        description: "Kolam renang ukuran Olympic 50m dengan jalur terpisah untuk umum dan latihan profesional.",
        pricePerHour: "50000",
        openTime: "06:00",
        closeTime: "20:00",
        minDuration: 1,
        maxDuration: 4,
        capacity: 30,
        isActive: true,
      },
      {
        name: "Lapangan Basket",
        category: "Basket",
        description: "Lapangan basket indoor standar NBA dengan lantai parket dan pencahayaan profesional.",
        pricePerHour: "150000",
        openTime: "07:00",
        closeTime: "22:00",
        minDuration: 1,
        maxDuration: 3,
        capacity: 20,
        isActive: true,
      },
      {
        name: "Studio Fitness",
        category: "Fitness",
        description: "Studio fitness lengkap dengan peralatan cardio, free weights, dan area functional training.",
        pricePerHour: "40000",
        openTime: "05:00",
        closeTime: "22:00",
        minDuration: 1,
        maxDuration: 4,
        capacity: 25,
        isActive: true,
      },
      {
        name: "Lapangan Tenis",
        category: "Tenis",
        description: "Lapangan tenis indoor dengan permukaan hard court standar ITF dan net berkualitas.",
        pricePerHour: "120000",
        openTime: "06:00",
        closeTime: "21:00",
        minDuration: 1,
        maxDuration: 3,
        capacity: 4,
        isActive: true,
      },
    ];
  const existingFacilities = await db.select({ name: facilitiesTable.name }).from(facilitiesTable);
  const existingNames = new Set(existingFacilities.map((facility) => facility.name));
  const missingFacilities = facilitySeed.filter((facility) => !existingNames.has(facility.name));
  if (missingFacilities.length > 0) {
    await db.insert(facilitiesTable).values(missingFacilities);
    console.log(`Facilities seeded (${missingFacilities.length} missing facilities added)`);
  } else {
    console.log("Facilities already exist, skipping");
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
