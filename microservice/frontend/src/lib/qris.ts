/** CRC16-CCITT-FALSE: poly 0x1021, init 0xFFFF */
function crc16(payload: string): string {
  let crc = 0xffff;
  for (const ch of payload) {
    crc ^= ch.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function buildDynamicQris(staticPayload: string, amount: number): string {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("qris_invalid_amount");
  const source = staticPayload.trim();
  if (!source) throw new Error("qris_payload_not_configured");

  const body = source.slice(0, -8);
  const dynamic = body.replace("010211", "010212");
  if (dynamic === body) throw new Error("qris_not_static");

  const amountStr = String(amount);
  const tag54 = "54" + String(amountStr.length).padStart(2, "0") + amountStr;

  const idx = dynamic.indexOf("5802ID");
  if (idx === -1) throw new Error("qris_missing_country_tag");

  const withAmount = dynamic.slice(0, idx) + tag54 + dynamic.slice(idx);
  const result = withAmount + "6304" + crc16(withAmount + "6304");
  return result;
}
