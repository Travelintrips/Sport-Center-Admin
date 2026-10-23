import { setAuthTokenGetter } from "@workspace/api-client-react";

export const TOKEN_KEY = "sport_center_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getCurrentRole(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const [payloadB64] = token.split(".");
    if (!payloadB64) return null;
    const payload = JSON.parse(atob(payloadB64));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Initialize the fetch interceptor
setAuthTokenGetter(() => getToken());
