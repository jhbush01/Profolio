import type { APIRoute } from 'astro';
import { withRepo } from '../../../lib/server/handler';


export const prerender = false;

/** Whether this account has a password login, and which address it uses. */
export const GET: APIRoute = ({ request }) =>
  withRepo(request, async (repo) => {
    const email = await repo.passwordEmail();
    return Response.json({ email }, { headers: { 'Cache-Control': 'private, no-store' } });
  });

/**
 * Sets or changes the password on the account already signed in.
 *
 * This is how an account that arrived through Google or Cloudflare gains a
 * password, and the reason sign-up never has to adopt an existing account by
 * email. Changing one requires the current password, so a borrowed unlocked
 * laptop cannot be used to lock the owner out of their own evidence.
 */
export const PUT: APIRoute = ({ request }) =>
  withRepo(request, async (repo, email) => {
    const body = (await request.json()) as {
      email?: unknown;
      current?: unknown;
      password?: unknown;
    };
    await repo.setPassword(
      typeof body.email === 'string' && body.email ? body.email : email,
      body.current,
      body.password,
    );
    // Every session ended, this one included: a password change that leaves the
    // session it was changed because of still running has done nothing.
    return Response.json({ ok: true, signedOut: true });
  });
