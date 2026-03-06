const encoder = new TextEncoder();

export async function hashPassword(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(raw));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(raw: string, hash: string): Promise<boolean> {
  const hashed = await hashPassword(raw);
  return hashed === hash;
}
