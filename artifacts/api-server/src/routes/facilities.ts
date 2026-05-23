import { Router } from "express";
import { db, facilitiesTable, facilityImagesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import multer from "multer";
import path from "path";
import fs from "fs";

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const name = `facility-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const valid =
      allowed.test(path.extname(file.originalname).toLowerCase()) &&
      allowed.test(file.mimetype);
    cb(null, valid);
  },
});

function getPublicUrl(filename: string): string {
  return `/api/uploads/${filename}`;
}

function deleteLocalFile(url: string): void {
  try {
    const filename = url.split("/api/uploads/").pop();
    if (filename) {
      const filePath = path.join(UPLOADS_DIR, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  } catch {
    // non-fatal
  }
}

const router = Router();

async function getFacilityWithImages(id: number) {
  const [facility] = await db
    .select()
    .from(facilitiesTable)
    .where(eq(facilitiesTable.id, id))
    .limit(1);
  if (!facility) return null;
  const images = await db
    .select()
    .from(facilityImagesTable)
    .where(eq(facilityImagesTable.facilityId, id));
  return { ...facility, images, pricePerHour: Number(facility.pricePerHour) };
}

router.get("/facilities", async (req, res) => {
  try {
    const { activeOnly, category } = req.query;
    let facilities = await db.select().from(facilitiesTable);
    if (activeOnly === "true") facilities = facilities.filter((f) => f.isActive);
    if (category) facilities = facilities.filter((f) => f.category === category);

    const facilityIds = facilities.map((f) => f.id);
    const images =
      facilityIds.length > 0
        ? await db
            .select()
            .from(facilityImagesTable)
            .where(inArray(facilityImagesTable.facilityId, facilityIds))
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
    const [facility] = await db
      .insert(facilitiesTable)
      .values({ ...data, pricePerHour: String(data.pricePerHour) })
      .returning();
    if (imageUrls?.length) {
      await db.insert(facilityImagesTable).values(
        imageUrls.map((url: string, i: number) => ({
          facilityId: facility.id,
          url,
          isPrimary: i === 0,
        }))
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
    if (data.pricePerHour !== undefined)
      updateData.pricePerHour = String(data.pricePerHour);
    await db
      .update(facilitiesTable)
      .set(updateData)
      .where(eq(facilitiesTable.id, id));
    if (imageUrls !== undefined) {
      const oldImages = await db
        .select()
        .from(facilityImagesTable)
        .where(eq(facilityImagesTable.facilityId, id));
      oldImages.forEach((img) => deleteLocalFile(img.url));
      await db
        .delete(facilityImagesTable)
        .where(eq(facilityImagesTable.facilityId, id));
      if (imageUrls.length) {
        await db.insert(facilityImagesTable).values(
          imageUrls.map((url: string, i: number) => ({
            facilityId: id,
            url,
            isPrimary: i === 0,
          }))
        );
      }
    }
    const result = await getFacilityWithImages(id);
    if (!result) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Update facility error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/facilities/:id", adminMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const images = await db
      .select()
      .from(facilityImagesTable)
      .where(eq(facilityImagesTable.facilityId, id));
    images.forEach((img) => deleteLocalFile(img.url));
    await db.delete(facilitiesTable).where(eq(facilitiesTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Delete facility error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/facilities/:id/images",
  adminMiddleware,
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No image file provided" });
        return;
      }
      const id = parseInt(req.params.id);
      const publicUrl = getPublicUrl(req.file.filename);

      const existingImages = await db
        .select()
        .from(facilityImagesTable)
        .where(eq(facilityImagesTable.facilityId, id));
      const isPrimary = existingImages.length === 0;

      const [image] = await db
        .insert(facilityImagesTable)
        .values({ facilityId: id, url: publicUrl, isPrimary })
        .returning();

      res.status(201).json(image);
    } catch (err) {
      req.log.error({ err }, "Upload facility image error");
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.delete(
  "/facilities/:id/images/:imageId",
  adminMiddleware,
  async (req, res) => {
    try {
      const imageId = parseInt(req.params.imageId);
      const [img] = await db
        .select()
        .from(facilityImagesTable)
        .where(eq(facilityImagesTable.id, imageId))
        .limit(1);

      if (img) {
        deleteLocalFile(img.url);
        await db
          .delete(facilityImagesTable)
          .where(eq(facilityImagesTable.id, imageId));

        if (img.isPrimary) {
          const [remaining] = await db
            .select()
            .from(facilityImagesTable)
            .where(eq(facilityImagesTable.facilityId, img.facilityId))
            .limit(1);
          if (remaining) {
            await db
              .update(facilityImagesTable)
              .set({ isPrimary: true })
              .where(eq(facilityImagesTable.id, remaining.id));
          }
        }
      }
      res.status(204).send();
    } catch (err) {
      req.log.error({ err }, "Delete facility image error");
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.patch(
  "/facilities/:id/images/:imageId/primary",
  adminMiddleware,
  async (req, res) => {
    try {
      const facilityId = parseInt(req.params.id);
      const imageId = parseInt(req.params.imageId);
      await db
        .update(facilityImagesTable)
        .set({ isPrimary: false })
        .where(eq(facilityImagesTable.facilityId, facilityId));
      await db
        .update(facilityImagesTable)
        .set({ isPrimary: true })
        .where(eq(facilityImagesTable.id, imageId));
      res.json({ success: true });
    } catch (err) {
      req.log.error({ err }, "Set primary image error");
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
