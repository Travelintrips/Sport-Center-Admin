let startupReady = process.env.NODE_ENV === "production";

export function isStartupReady(): boolean {
  return startupReady;
}

export function markStartupReady(): void {
  startupReady = true;
}