import http from "node:http";
import { URL } from "node:url";

const clientId = String(process.env.QRIS_GMAIL_CLIENT_ID_DEV ?? "").trim();
const clientSecret = String(process.env.QRIS_GMAIL_CLIENT_SECRET_DEV ?? "").trim();
const port = Number(process.env.QRIS_GMAIL_OAUTH_PORT ?? 53682);
const redirectUri = `http://127.0.0.1:${port}`;
const scope = "https://www.googleapis.com/auth/gmail.readonly";

if (!clientId || !clientSecret) {
  console.error("Set QRIS_GMAIL_CLIENT_ID_DEV and QRIS_GMAIL_CLIENT_SECRET_DEV first.");
  process.exit(1);
}

const state = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
auth.searchParams.set("client_id", clientId);
auth.searchParams.set("redirect_uri", redirectUri);
auth.searchParams.set("response_type", "code");
auth.searchParams.set("scope", scope);
auth.searchParams.set("access_type", "offline");
auth.searchParams.set("prompt", "consent");
auth.searchParams.set("include_granted_scopes", "false");
auth.searchParams.set("state", state);

console.log("\nOpen this URL in a browser on this same computer:\n");
console.log(auth.toString());
console.log(`\nWaiting for OAuth callback on ${redirectUri} ...\n`);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", redirectUri);
    if (url.pathname !== "/") {
      res.writeHead(404).end("Not found");
      return;
    }
    if (url.searchParams.get("state") !== state) {
      res.writeHead(400).end("OAuth state mismatch");
      return;
    }
    const error = url.searchParams.get("error");
    if (error) {
      res.writeHead(400).end(`OAuth failed: ${error}`);
      console.error("OAuth failed:", error);
      server.close();
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400).end("Missing OAuth code");
      return;
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${JSON.stringify(token)}`);
    }

    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("OAuth Gmail read-only berhasil. Kembali ke terminal. Anda boleh menutup tab ini.");

    console.log("\nOAuth Gmail read-only berhasil.");
    console.log("Scope:", token.scope ?? scope);
    console.log("Token type:", token.token_type ?? "Bearer");
    console.log("\nSimpan nilai berikut sebagai QRIS_GMAIL_REFRESH_TOKEN_DEV:");
    console.log(token.refresh_token ?? "<NO_REFRESH_TOKEN_RETURNED>");
    console.log("\nJANGAN commit atau kirim refresh token ke chat.");
    if (!token.refresh_token) {
      console.log("Jika tidak ada refresh token, revoke grant app ini lalu jalankan ulang dengan prompt=consent.");
    }
  } catch (error) {
    res.writeHead(500).end("OAuth token exchange failed");
    console.error(error);
  } finally {
    server.close();
  }
});

server.listen(port, "127.0.0.1");
