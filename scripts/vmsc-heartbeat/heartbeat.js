// Dedicated VMSC heartbeat sender. Never reads or changes attendance records.
// Install at C:\\SportCenter-X904-Gateway\\heartbeat.js on the approved VMSC PC.
// Requires VMSC_HEARTBEAT_URL, VMSC_HEARTBEAT_KEY, VMSC_DEVICE_SERIAL.
const endpoint = process.env.VMSC_HEARTBEAT_URL;
const key = process.env.VMSC_HEARTBEAT_KEY;
const serial = process.env.VMSC_DEVICE_SERIAL;
if (!endpoint || !key || key.length < 32 || !serial) {
  console.error('VMSC heartbeat configuration incomplete');
  process.exit(1);
}
const url = new URL(endpoint);
if (url.protocol !== 'https:' || !url.pathname.endsWith('/internal/gym-x904/vmsc-heartbeat')) {
  console.error('HTTPS VMSC heartbeat endpoint required');
  process.exit(1);
}
let running = false;
async function send() {
  if (running) return;
  running = true;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-vmsc-heartbeat-key': key },
      body: JSON.stringify({ source: 'VMSC', serial }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw Error('heartbeat HTTP ' + response.status);
    console.log(new Date().toISOString(), 'VMSC_HEARTBEAT_ACK');
  } catch (error) {
    console.error(new Date().toISOString(), 'VMSC_HEARTBEAT_FAILED', error.message);
  } finally {
    running = false;
  }
}
await send();
setInterval(send, 120000).unref?.();
