/**
 * Turning a password into something safe to store, and back into a yes or no.
 *
 * PBKDF2-HMAC-SHA256, because it is the only serious password KDF that Workers
 * can run with no dependency: WebCrypto has it natively, while scrypt and
 * Argon2 would mean shipping WASM into an edge runtime and paying for it on
 * every cold start. PBKDF2 is weaker per unit of work than either — it is
 * cheap to parallelise on a GPU — so the iteration count has to do the lifting,
 * and it is stored per row so it can be raised without stranding anybody.
 *
 * COST NOTE. 210,000 iterations is OWASP's current floor for this construction
 * and takes roughly a tenth of a second of CPU. That is fine on a paid Workers
 * plan and will exceed the free plan's 10ms CPU allowance, which is a real
 * constraint on where this can run rather than a number to quietly lower: the
 * iteration count IS the security of the stored password.
 *
 * Verification is constant-time. A comparison that returns early on the first
 * wrong byte leaks, one byte at a time, what the right bytes are.
 */

/** OWASP's floor for PBKDF2-HMAC-SHA256. Raise, never lower. */
export const PBKDF2_ITERATIONS = 210_000;
const ALGORITHM = 'PBKDF2-SHA256';
const SALT_BYTES = 16;
const KEY_BITS = 256;

export interface StoredPassword {
  hash: string;
  salt: string;
  algorithm: string;
  iterations: number;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<StoredPassword> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(password, salt, PBKDF2_ITERATIONS);
  return {
    hash: toBase64(derived),
    salt: toBase64(salt),
    algorithm: ALGORITHM,
    iterations: PBKDF2_ITERATIONS,
  };
}

/** Length-independent, early-exit-free comparison. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

export async function verifyPassword(password: string, stored: StoredPassword): Promise<boolean> {
  // An unrecognised algorithm is a no, not a crash and not a yes. It is how a
  // future migration to a stronger KDF fails safe while it is half-applied.
  if (stored.algorithm !== ALGORITHM) return false;
  const derived = await derive(password, fromBase64(stored.salt), stored.iterations);
  return sameBytes(derived, fromBase64(stored.hash));
}

/** True when the stored hash was made with settings we no longer use. */
export function needsRehash(stored: StoredPassword): boolean {
  return stored.algorithm !== ALGORITHM || stored.iterations < PBKDF2_ITERATIONS;
}

/**
 * What counts as an acceptable password.
 *
 * Length, and nothing else. Composition rules — a capital, a digit, a symbol —
 * are what produce Password1! on every account in the building; NIST dropped
 * them for that reason. A minimum of 12 and a ceiling high enough for a
 * passphrase is the whole policy.
 *
 * The ceiling is not decoration: PBKDF2 hashes whatever it is given, so an
 * unbounded password field is a request to burn CPU on a megabyte of input.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

/** The reason it was refused, or null when it is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. A few unrelated words is easier to remember and harder to guess than a short one with symbols in it.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `That is longer than ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}
