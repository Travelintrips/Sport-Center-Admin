import { Router } from "express";
import { db, facilitiesTable, facilityImagesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { adminMiddleware } from "../lib/auth";
import { getSupabaseAdmin } from "../lib/supabase";
import multer from "multer";
import path from "path";

const BUCKET = "facility-images";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    const valid =
      allowed.test(path.extname(file.originalname).toLowerCase()) &&
      allowed.test(file.mimetype);
    cb(null, valid);
  },
});

async function ensureBucket() {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.getBucket(BUCKET);
  if (error) {
    await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    });
  }
}

ensureBucket().catch(() => {});

async function uploadToSupabase(
  buffer: Buffer,
  originalName: string,
  mimetype: string
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const ext = path.extname(originalName).toLowerCase() || ".jpg";
  const filename = `facility-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(filename, buffer, { contentType: mimetype, upsert: false });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(data.path);

  return publicUrl;
}

async function deleteFromSupabase(url: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const match = url.match(/\/storage\/v1\/object\/public\/facility-images\/(.+?)(\?.*)?$/);
    if (match?.[1]) {
      await supabase.storage.from(BUCKET).remove([decodeURIComponent(match[1])]);
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
    await Promise.all(images.map((img) => deleteFromSupabase(img.url)));
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

      const publicUrl = await uploadToSupabase(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

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
        await deleteFromSupabase(img.url);
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
