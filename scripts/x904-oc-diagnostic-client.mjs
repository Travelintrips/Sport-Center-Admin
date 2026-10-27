#!/usr/bin/env node
// Read-only OC diagnostic client. No DB credentials or device control.
import { createHmac, randomBytes } from "node:crypto";
const id = process.argv[2] ?? "";
if (!/^[0-9a-f-]{36}$/i.test(id)) { console.error("usage: node x904-oc-diagnostic-client.mjs <command-uuid>"); process.exit(2); }
const base = process.env.X904_DIAGNOSTIC_BASE_URL ?? "";
const key = process.env.X904_DIAGNOSTIC_HMAC_SECRET ?? "";
if (!/^https:\/\/[^/]+$/i.test(base) || key.length < 48) { console.error("Diagnostic base URL/secret not provisioned"); process.exit(2); }
const route = "/api/internal/gym-x904/diagnostics/command/"+id;
const timestamp = Date.now().toString();
const nonce = randomBytes(24).toString("base64url");
const signature = createHmac("sha256",key).update(["GET",route.replace(/^\/api/,""),timestamp,nonce].join("\n")).digest("hex");
const controller = new AbortController();
const timeout = setTimeout(()=>controller.abort(),10000);
try {
 const response=await fetch(base+route,{method:"GET",headers:{"x-x904-timestamp":timestamp,"x-x904-nonce":nonce,"x-x904-signature":signature},signal:controller.signal,redirect:"error"});
 const body=await response.json().catch(()=>({error:"NON_JSON_RESPONSE"}));
 console.log(JSON.stringify({httpStatus:response.status,...body},null,2));
 if(!response.ok)process.exitCode=1;
} catch(e) { console.error("Diagnostic transport error:",e instanceof Error?e.message:String(e));process.exitCode=1; }
finally {clearTimeout(timeout);}
