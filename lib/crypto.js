import crypto from 'node:crypto';

function key() {
  const hex = process.env.TOKEN_ENCRYPTION_KEY || '';
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return Buffer.from(hex, 'hex');
}

/** AES-256-GCM. Output: base64(iv | authTag | ciphertext). */
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decrypt(encoded) {
  const raw = Buffer.from(encoded, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
