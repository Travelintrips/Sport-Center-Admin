---
name: GAE deploy — analyticsPublic.ts TS fix
description: TypeScript error in analyticsPublic.ts blocks Cloud Build typecheck step; fix is limit "5" not 5.
---

# GA4 analyticsPublic.ts — int64 limit field must be string

**Rule:** `RunReportRequest.limit` in GA4 Analytics Data API v1beta is typed as `string | null` in TypeScript (proto int64). Passing a number literal `limit: 5` causes TS2769.

**Fix:** `limit: "5"` — committed in local `88a59b1`.

**Why:** GA4 API JS types represent int64 as string; tsc strict mode rejects number.

**How to apply:** Any future GA4 runReport call with limit must use string form.
