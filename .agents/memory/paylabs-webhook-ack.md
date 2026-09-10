---
name: Paylabs webhook acknowledgement
description: Signed outbound acknowledgement contract for Paylabs v4.8.1 asynchronous notifications.
---

## Rule
After an inbound callback passes environment and signature verification and its local notification/payment state is safely persisted, respond with HTTP 200 and exactly:

```json
{"merchantId":"<selected merchant>","requestId":"<callback request id>","errCode":"0"}
```

The response must include `Content-Type: application/json;charset=utf-8`, `X-TIMESTAMP`, `X-PARTNER-ID`, `X-REQUEST-ID`, and `X-SIGNATURE`. Sign the response with the selected merchant private key, using `POST:/api/paylabs/webhook:<sha256-minified-body>:<X-TIMESTAMP>`.

**Why:** Paylabs treats the signed HTTP response as acknowledgement of asynchronous notification delivery. A plain 200 JSON response without the required headers is reported as “no response” and can trigger retries.

**How to apply:** Use the sandbox private key/public key pair when `sandboxMode` is active and the production pair otherwise. Never use the public key to sign, never send a success ACK after inbound verification or local finalization fails, and never log private keys or full signatures.