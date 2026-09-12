/**
 * Cloudflare Access identity verification.
 *
 * Access puts a signed JWT on every request that passes through it, as the
 * `Cf-Access-Jwt-Assertion` header (and the `CF_Authorization` cookie).
 *
 * SECURITY: trusting `Cf-Access-Authenticated-User-Email` on its own is NOT
 * safe. A Worker can be reached on its workers.dev hostname, or on any route
 * not covered by an Access policy, and anyone can set that header on a request.
 * So the signature is verified here against the team's public keys, along with
 * the issuer, audience and expiry. Anything that fails is a 401.
 *
 * If the Access settings are missing, the API fails closed with 503 rather than
 * silently serving an unauthenticated endpoint.
 */

/**
 * What the Access token asserts. Deliberately not the row owner: see
 * accounts.ts, which resolves one of these to a stable account id.
 */
export interface TokenIdentity {
  /** Verified email claim. Used for display and for linking an account. */
  email: string;
  /** The `sub` claim, when the token carries one. */
  subject: string | null;
}

interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Local development only. Never set this in production. */
  ACCESS_DEV_BYPASS?: string;
}

/**
 * An error that carries the HTTP status it should be reported as, so a policy
 * refusal is not indistinguishable from a crash.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class AuthError extends HttpError {}

/** JWKS cache, keyed by team domain. Workers reuse isolates, so this helps. */
const keyCache = new Map<string, { keys: Map<string, CryptoKey>; fetchedAt: number }>();
const KEY_TTL_MS = 60 * 60 * 1000;

/**
 * Backed by an explicit ArrayBuffer rather than the default ArrayBufferLike,
 * because crypto.subtle.verify's BufferSource will not accept a view that
 * might sit on a SharedArrayBuffer.
 */
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Decodes one JWT segment. Anything unparseable is a malformed token (401),
 * never a server fault (500) — a bad token must not surface internals.
 */
function decodeJson(segment: string): Record<string, unknown> {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
  } catch {
    throw new AuthError(401, 'Malformed Access token');
  }
}

async function publicKeys(teamDomain: string): Promise<Map<string, CryptoKey>> {
  const cached = keyCache.get(teamDomain);
  if (cached && Date.now() - cached.fetchedAt < KEY_TTL_MS) return cached.keys;

  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new AuthError(503, 'Could not fetch Access signing keys');
  const jwks = (await response.json()) as { keys: Array<JsonWebKey & { kid: string }> };

  const keys = new Map<string, CryptoKey>();
  for (const jwk of jwks.keys) {
    keys.set(
      jwk.kid,
      await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    );
  }
  keyCache.set(teamDomain, { keys, fetchedAt: Date.now() });
  return keys;
}

/**
 * Resolves the caller's verified identity, or throws AuthError.
 * `teamDomain` is the bare hostname, e.g. "yourteam.cloudflareaccess.com".
 */
export async function requireIdentity(request: Request, env: AccessEnv): Promise<TokenIdentity> {
  if (env.ACCESS_DEV_BYPASS === 'true') {
    // Only ever set in wrangler dev; see wrangler.jsonc and the README.
    return { email: 'dev@localhost', subject: 'dev-subject' };
  }

  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.ACCESS_AUD?.trim();
  if (!teamDomain || !audience) {
    throw new AuthError(503, 'Access is not configured on this Worker');
  }

  const cookie = request.headers.get('Cookie') ?? '';
  const fromCookie = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie)?.[1];
  const token = request.headers.get('Cf-Access-Jwt-Assertion') ?? fromCookie;
  if (!token) throw new AuthError(401, 'No Access token on this request');

  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError(401, 'Malformed Access token');
  const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string];

  const header = decodeJson(headerSegment) as { kid?: string; alg?: string };
  if (header.alg !== 'RS256') throw new AuthError(401, 'Unexpected token algorithm');
  if (!header.kid) throw new AuthError(401, 'Token has no key id');

  const key = (await publicKeys(teamDomain)).get(header.kid);
  if (!key) throw new AuthError(401, 'Token signed by an unknown key');

  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(signatureSegment),
    new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
  );
  if (!verified) throw new AuthError(401, 'Token signature does not verify');

  const payload = decodeJson(payloadSegment) as {
    aud?: string | string[];
    iss?: string;
    exp?: number;
    nbf?: number;
    email?: string;
    sub?: string;
  };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) throw new AuthError(401, 'Token expired');
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) throw new AuthError(401, 'Token not yet valid');
  if (payload.iss !== `https://${teamDomain}`) throw new AuthError(401, 'Unexpected token issuer');

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) throw new AuthError(401, 'Token audience does not match this application');

  if (!payload.email) throw new AuthError(401, 'Token carries no email claim');
  return {
    email: payload.email.toLowerCase(),
    subject: typeof payload.sub === 'string' && payload.sub ? payload.sub : null,
  };
}

/** Turns an AuthError (or anything else) into a JSON response. */
export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message }, { status: 500 });
}
