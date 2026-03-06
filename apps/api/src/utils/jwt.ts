type JwtPayload = {
  sub: string;
  email: string;
  role: string;
  exp: number;
};

const encoder = new TextEncoder();

function base64UrlEncode(input: Uint8Array): string {
  return btoa(String.fromCharCode(...input)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacSha256(data: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return new Uint8Array(signature);
}

export async function signJwt(payload: Omit<JwtPayload, 'exp'>, secret: string, ttlSeconds = 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const fullPayload: JwtPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const headerEncoded = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadEncoded = base64UrlEncode(encoder.encode(JSON.stringify(fullPayload)));
  const signingInput = `${headerEncoded}.${payloadEncoded}`;
  const signature = await hmacSha256(signingInput, secret);
  const signatureEncoded = base64UrlEncode(signature);
  return `${signingInput}.${signatureEncoded}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const segments = token.split('.');
  if (segments.length !== 3) {
    return null;
  }

  const [headerEncoded, payloadEncoded, signatureEncoded] = segments;
  const signingInput = `${headerEncoded}.${payloadEncoded}`;
  const expected = await hmacSha256(signingInput, secret);
  if (base64UrlEncode(expected) !== signatureEncoded) {
    return null;
  }

  const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadEncoded));
  const payload = JSON.parse(payloadJson) as JwtPayload;
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

export type { JwtPayload };
