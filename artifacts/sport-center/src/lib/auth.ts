import { setAuthTokenGetter } from "@workspace/api-client-react";

export const TOKEN_KEY = "sport_center_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Initialize the fetch interceptor
setAuthTokenGetter(() => getToken());
