import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { errorResponse } from '../../../lib/server/access';
import { signInWithPassword } from '../../../lib/server/password-auth';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    const { cookie } = await signInWithPassword(
      (env as Env).DB,
      request,
      body.email,
      body.password,
    );
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie, 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
};
