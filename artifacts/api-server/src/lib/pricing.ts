import { db, pricingRulesTable, facilitiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

function getWIBDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00+07:00");
}

function isWeekend(dateStr: string): boolean {
  const d = getWIBDate(dateStr);
  const day = d.getDay();
  return day === 0 || day === 6;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function isPeakHour(startTime: string, endTime: string, peakStart: string, peakEnd: string): boolean {
  const sMin = timeToMinutes(startTime);
  const eMin = timeToMinutes(endTime);
  const pStart = timeToMinutes(peakStart);
  const pEnd = timeToMinutes(peakEnd);
  return sMin < pEnd && eMin > pStart;
}

export interface PriceCalculation {
  basePrice: number;
  finalPrice: number;
  appliedRules: { name: string; adjustment: number }[];
}

export async function calculatePrice(
  facilityId: number,
  bookingDate: string,
  startTime: string,
  endTime: string,
  durationHours: number
): Promise<PriceCalculation> {
  const [facility] = await db
    .select()
    .from(facilitiesTable)
    .where(eq(facilitiesTable.id, facilityId))
    .limit(1);

  if (!facility) throw new Error("Facility not found");

  const baseHourlyRate = Number(facility.pricePerHour);
  const basePrice = baseHourlyRate * durationHours;

  const rules = await db
    .select()
    .from(pricingRulesTable)
    .where(and(eq(pricingRulesTable.facilityId, facilityId), eq(pricingRulesTable.isActive, true)));

  const sortedRules = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const weekend = isWeekend(bookingDate);
  const appliedRules: { name: string; adjustment: number }[] = [];
  let finalPrice = basePrice;

  for (const rule of sortedRules) {
    const ruleType = rule.ruleType;

    if (ruleType === "weekday" && weekend) continue;
    if (ruleType === "weekend" && !weekend) continue;
    if (ruleType === "peak_hour") {
      if (!rule.peakStartTime || !rule.peakEndTime) continue;
      if (!isPeakHour(startTime, endTime, rule.peakStartTime, rule.peakEndTime)) continue;
    }
    if (ruleType === "off_peak_hour") {
      if (!rule.peakStartTime || !rule.peakEndTime) continue;
      if (isPeakHour(startTime, endTime, rule.peakStartTime, rule.peakEndTime)) continue;
    }

    let adjustment = 0;

    if (rule.priceOverride != null) {
      const newPrice = Number(rule.priceOverride) * durationHours;
      adjustment = newPrice - finalPrice;
      finalPrice = newPrice;
    } else if (rule.priceAddon != null) {
      adjustment = Number(rule.priceAddon) * durationHours;
      finalPrice += adjustment;
    } else if (rule.priceMultiplier != null) {
      const newPrice = basePrice * Number(rule.priceMultiplier);
      adjustment = newPrice - finalPrice;
      finalPrice = newPrice;
    }

    appliedRules.push({ name: rule.name, adjustment });
  }

  return {
    basePrice,
    finalPrice: Math.max(0, finalPrice),
    appliedRules,
  };
}
