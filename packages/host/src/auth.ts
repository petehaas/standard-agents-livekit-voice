/**
 * Credentials for the Builder API. Either an API key (SA_API_KEY), or the
 * local super admin password from the agent's .dev.vars (SA_ADMIN_PASSWORD),
 * exchanged for a session token at startup.
 */
export async function resolveToken(baseUrl: string): Promise<string> {
  if (process.env.SA_API_KEY) return process.env.SA_API_KEY;
  const password = process.env.SA_ADMIN_PASSWORD;
  if (!password) throw new Error('Set SA_ADMIN_PASSWORD (or SA_API_KEY) in your environment.');

  let response: Response;
  try {
    response = await fetch(new URL('/api/auth/login', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password }),
    });
  } catch {
    throw new Error(`Can't reach the agent dev server at ${baseUrl}. Start it first: cd agent && npm run dev`);
  }
  const body = (await response.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!response.ok || !body.token) {
    throw new Error(
      `Sign-in to ${baseUrl} failed (${response.status}: ${body.error ?? 'no token'}). ` +
        'Check that the agent dev server is running and SA_ADMIN_PASSWORD matches SUPER_ADMIN_PASSWORD in agent/.dev.vars.',
    );
  }
  return body.token;
}
