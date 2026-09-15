import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { errorResponse } from '../../../lib/server/access';
import { signUpWithPassword } from '../../../lib/server/password-auth';

export const prerender = false;

/**
 * Creates an account with an email address and a password.
 *
 * Always a NEW account, never an existing one — see password-auth.ts for why
 * that is the rule this whole feature rests on.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    const { cookie } = await signUpWithPassword(
      (env as Env).DB,
      request,
      body.email,
      body.password,
    );
    return new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
};
