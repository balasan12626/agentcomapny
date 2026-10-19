// Same-origin API proxy so the httpOnly session cookie works without CORS.
const API = process.env.API_URL || 'http://localhost:4000';
// Phones on your Wi-Fi load the dev server via your PC's LAN IP; list it in
// DEV_ORIGINS (comma-separated hostnames/IPs) so Next.js dev allows it.
const devOrigins = (process.env.DEV_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

export default {
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
    ] }];
  },
};
