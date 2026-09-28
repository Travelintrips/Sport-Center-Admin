let startupReady = false;

export function isStartupReady(): boolean {
  return startupReady;
}

export function markStartupReady(): void {
  startupReady = true;
}
