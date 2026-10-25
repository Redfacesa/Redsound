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
  const query = queryIndex >= 0 ? current.slice(queryIndex + 1) : '';
  const params = new URLSearchParams(query);
  const forwarded = params.get('__rs');
  if (forwarded) {
    params.delete('__rs');
    const extra = params.toString();
    req.url = `/api/${decodeURIComponent(forwarded).replace(/^\/+/, '')}${extra ? `?${extra}` : ''}`;
    return;
  }
  if (pathOnly === '/api' || (pathOnly.startsWith('/api/') && pathOnly !== '/api/server')) return;

  const invoked = header(req, 'x-invoke-path') || header(req, 'x-forwarded-uri') || header(req, 'x-original-uri');
  const invokedPath = invoked.split('?')[0];
  if (invokedPath === '/api' || (invokedPath.startsWith('/api/') && invokedPath !== '/api/server')) {
    req.url = `${invokedPath}${query ? `?${query}` : ''}`;
    return;
  }
  req.url = `/api${pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`}${query ? `?${query}` : ''}`;
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  restoreApiPath(req);
  return app(req, res);
}
