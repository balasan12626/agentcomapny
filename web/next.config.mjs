// Same-origin API proxy so the httpOnly session cookie works without CORS.
const API = process.env.API_URL || 'http://localhost:4000';
// Phones on your Wi-Fi load the dev server via your PC's LAN IP; list it in
// DEV_ORIGINS (comma-separated hostnames/IPs) so Next.js dev allows it.
const devOrigins = (process.env.DEV_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const isDev = process.env.NODE_ENV !== 'production';

// Content-Security-Policy. Next.js App Router injects inline bootstrap
// scripts, so 'unsafe-inline' stays for scripts until nonces are wired in;
// 'unsafe-eval' is only needed by the dev server (React Refresh). The task
// WebSocket runs on the API port, hence ws:/wss: in connect-src.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export default {
  // NEXT_DIST_DIR lets `next build` run beside a live `next dev` (Windows locks .next).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  allowedDevOrigins: devOrigins,
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Content-Security-Policy', value: csp },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      // HSTS only matters behind TLS; set it in production builds.
      ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
    ] }];
  },
};
