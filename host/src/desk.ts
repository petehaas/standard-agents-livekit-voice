/**
 * The support desk: a local page the caller opens instead of a meeting app.
 * It shows the agent's orb, asks only for the microphone, and draws an order
 * card when the host makes the `show_card` RPC.
 */
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const deskDir = join(dirname(fileURLToPath(import.meta.url)), '../desk');
const clientSdk = join(
  dirname(createRequire(import.meta.url).resolve('livekit-client')),
  'livekit-client.umd.js',
);

export interface DeskSession {
  liveKitUrl: string;
  token: string;
}

export function startDesk(session: DeskSession, port = Number(process.env.DESK_PORT ?? 8787)): Promise<string> {
  const server: Server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    try {
      if (path === '/session') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify(session));
        return;
      }
      if (path === '/vendor/livekit-client.umd.js') {
        const body = await readFile(clientSdk);
        response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
        response.end(body);
        return;
      }
      if (path.startsWith('/products/')) {
        const name = path.slice('/products/'.length);
        if (!/^[a-z0-9-]+\.(png|jpe?g|webp)$/.test(name)) {
          response.writeHead(404).end('Not found');
          return;
        }
        try {
          const body = await readFile(join(deskDir, 'products', name));
          const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
          response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' });
          response.end(body);
        } catch {
          response.writeHead(404).end('Not found');
        }
        return;
      }
      if (path === '/' || path === '/index.html') {
        const body = await readFile(join(deskDir, 'index.html'));
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(body);
        return;
      }
      response.writeHead(404).end('Not found');
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : 'Desk error');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      resolve(`http://127.0.0.1:${actual}/`);
    });
  });
}
