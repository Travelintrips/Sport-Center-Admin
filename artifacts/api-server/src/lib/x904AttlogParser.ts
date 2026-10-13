/** Strict X904 ADMS ATTLOG parser. No biometric templates or machine commands. */
export type X904Attlog = {pin:string; occurred:string; status:number; verify:number};
const timestamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
export function parseX904Attlog(raw: string): X904Attlog[] | null {
  if (!raw || Buffer.byteLength(raw, "utf8") > 32768) return null;
  const lines = raw.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0 || lines.length > 1000) return null;
  const out: X904Attlog[] = [];
  for (const line of lines) {
    const cols = line.split("\t");
    if (cols.length < 4 || cols.length > 12) return null;
    const [pin, occurred, statusRaw, verifyRaw] = cols;
    const status = Number(statusRaw), verify = Number(verifyRaw);
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(pin) || !timestamp.test(occurred) ||
        !/^\d{1,3}$/.test(statusRaw) || !/^\d{1,3}$/.test(verifyRaw) ||
        !Number.isInteger(status) || status > 255 || !Number.isInteger(verify) || verify > 255) return null;
    const date = new Date(occurred.replace(" ", "T") + "Z");
    if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0,19).replace("T"," ") !== occurred) return null;
    out.push({pin,occurred,status,verify});
  }
  return out;
}
