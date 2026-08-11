let lastTimestamp = 0;
let sequence = 0;

export function uuidV7(now = Date.now()) {
  if (now === lastTimestamp) sequence = (sequence + 1) & 0x0fff;
  else { lastTimestamp = now; sequence = crypto.getRandomValues(new Uint16Array(1))[0]! & 0x0fff; }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index--) { bytes[index] = Number(timestamp & 0xffn); timestamp >>= 8n; }
  bytes[6] = 0x70 | ((sequence >> 8) & 0x0f);
  bytes[7] = sequence & 0xff;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
