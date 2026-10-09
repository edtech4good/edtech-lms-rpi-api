import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * The request headers a browser may send to this API. A browser's preflight is answered with exactly this
 * list, and a header that is not on it makes the browser refuse the real request, so a client that adds a
 * header (the learner app's `X-Learning-Item-Types`, which names the learning-item types its build renders)
 * must be listed here first. The header is sent only to this API, never to the central one.
 */
export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Accept',
  'Accept-Language',
  'Cache-Control',
  'TIMEOFFSET',
  'X-Learning-Item-Types',
];

export const CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

/**
 * The CORS options of the server (see the comment in `server.ts`): any origin in local dev, otherwise the
 * allowlist; a request with no Origin (native app, proxy, curl) is always allowed.
 */
export const corsOptions = (isLocalDev: boolean, allowedOrigins: ReadonlySet<string>): CorsOptions => ({
  origin: isLocalDev
    ? true
    : (origin, callback) => {
        // No Origin header (native app, RPI_CLOUD proxy, curl): allow.
        if (!origin) return callback(null, true);
        return callback(null, allowedOrigins.has(origin));
      },
  methods: CORS_METHODS,
  allowedHeaders: CORS_ALLOWED_HEADERS,
});
