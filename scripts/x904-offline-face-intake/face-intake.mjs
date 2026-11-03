import { createHash } from 'node:crypto';
import sharp from 'sharp';

// Standalone offline validation. Do not connect to device, gateway, database, queues or SDK.
export async function validateOfflineFace({ pin, filename, bytes }) {
  const rejected = (reason) => ({ status: 'REJECTED', reason, deviceWrite: false, autoDispatch: false });
  if (String(pin) !== '500') return rejected('TEST_PIN_ONLY');
  if (filename !== 'verify_biophoto_9_500.jpg') return rejected('FILENAME_MISMATCH');
  if (!Buffer.isBuffer(bytes)) return rejected('INVALID_INPUT');
  if (bytes.length < 100 || bytes.length > 50000) return rejected('SIZE_INVALID');
  if (!bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) || !bytes.subarray(-2).equals(Buffer.from([0xff, 0xd9]))) return rejected('NOT_JPEG');
  try {
    const image = sharp(bytes, { failOn: 'error', limitInputPixels: 12_000_000 });
    const metadata = await image.metadata();
    if (metadata.format !== 'jpeg' || !metadata.width || !metadata.height || metadata.pages > 1) return rejected('NOT_JPEG');
    await image.toBuffer();
  } catch { return rejected('DECODE_FAILED'); }
  return { status: 'STAGED_OFFLINE_ONLY', pin: '500', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), deviceWrite: false, gatewayConnection: false, sdkCall: false, autoDispatch: false };
}
