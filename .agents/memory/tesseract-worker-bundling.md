---
name: OCR runtime worker assets
description: Deployment constraint for OCR libraries with runtime-resolved workers and language data
---

OCR libraries whose workers are resolved dynamically need their package assets present at runtime and a writable ephemeral cache.

**Why:** Bundling can relocate dynamic worker paths and make a user upload crash the API. Serverless application filesystems are read-only, so language data must not be cached beside deployed code.

**How to apply:** Keep the OCR package's worker assets available to the runtime, store caches under a writable temporary directory, and validate that an image upload completes OCR without taking down the API after a clean deployment build.