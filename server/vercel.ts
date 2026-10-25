import type { IncomingMessage, ServerResponse } from 'node:http';
import app from './index.ts';

function header(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function restoreApiPath(req: IncomingMessage) {
  const current = req.url || '/';
  const queryIndex = current.indexOf('?');
  const pathOnly = queryIndex >= 0 ? current.slice(0, queryIndex) : current;
  const query = queryIndex >= 0 ? current.slice(queryIndex) : '';
  if (pathOnly === '/api' || pathOnly.startsWith('/api/')) return;

  const invoked = header(req, 'x-invoke-path') || header(req, 'x-forwarded-uri') || header(req, 'x-original-uri');
  const invokedPath = invoked.split('?')[0];
  if (invokedPath === '/api' || invokedPath.startsWith('/api/')) {
    req.url = `${invokedPath}${query}`;
    return;
  }
  req.url = `/api${pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`}${query}`;
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  restoreApiPath(req);
  return app(req, res);
}
