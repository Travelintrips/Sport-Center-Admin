import { Router } from "express";
import { db, facilitiesTable, facilityImagesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";

const router = Router();

async function getFacilityWithImages(id: number) {
  const [facility] = await db.select().from(facilitiesTable).where(eq(facilitiesTable.id, id)).limit(1);
  if (!facility) return null;
  const images = await db.select().from(facilityImagesTable).where(eq(facilityImagesTable.facilityId, id));
  return { ...facility, images, pricePerHour: Number(facility.pricePerHour) };
}

router.get("/facilities", async (req, res) => {
  try {
    const { activeOnly, category } = req.query;
    let facilities = await db.select().from(facilitiesTable);
    if (activeOnly === "true") facilities = facilities.filter((f) => f.isActive);
    if (category) facilities = facilities.filter((f) => f.category === category);

    const facilityIds = facilities.map((f) => f.id);
    const images = facilityIds.length > 0
      ? await db.select().from(facilityImagesTable).where(inArray(facilityImagesTable.facilityId, facilityIds))
      : [];

    const result = facilities.map((f) => ({
      ...f,
      pricePerHour: Number(f.pricePerHour),
      images: images.filter((img) => img.facilityId === f.id),
    }));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "List facilities error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/facilities", adminMiddleware, async (req, res) => {
  try {
    const { imageUrls, ...data } = req.body;
    const [facility] = await db.insert(facilitiesTable).values({
      ...data,
      pricePerHour: String(data.pricePerHour),
    }).returning();
    if (imageUrls?.length) {
      await db.insert(facilityImagesTable).values(
        imageUrls.map((url: string, i: number) => ({ facilityId: facility.id, url, isPrimary: i === 0 }))
      );
    }
    const result = await getFacilityWithImages(facility.id);
    res.status(201).json(result);
  } catch (err) {
    req.log.error({ err }, "Create facility error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/facilities/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const facility = await getFacilityWithImages(id);
    if (!facility) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(facility);
  } catch (err) {
    req.log.error({ err }, "Get facility error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/facilities/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { imageUrls, ...data } = req.body;
    const updateData: Record<string, unknown> = { ...data };
    if (data.pricePerHour !== undefined) updateData.pricePerHour = String(data.pricePerHour);
    await db.update(facilitiesTable).set(updateData).where(eq(facilitiesTable.id, id));
    if (imageUrls !== undefined) {
      await db.delete(facilityImagesTable).where(eq(facilityImagesTable.facilityId, id));
      if (imageUrls.length) {
        await db.insert(facilityImagesTable).values(
          imageUrls.map((url: string, i: number) => ({ facilityId: id, url, isPrimary: i === 0 }))
        );
      }
    }
    const result = await getFacilityWithImages(id);
    if (!result) { res.status(404).json({ error: "Not found" }); return; }
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Update facility error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/facilities/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(facilitiesTable).where(eq(facilitiesTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete facility error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
