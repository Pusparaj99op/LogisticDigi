import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // The whole app is client-rendered (Firebase Auth + Firestore listeners,
  // no route handlers, no server actions), so a static export is exactly the
  // right output — and it lets Vercel deploy this pnpm-workspace app from the
  // repo root without a Root Directory project setting pointed at apps/web.
  output: 'export',
  // Plain static hosting (no Next-aware router in front of it) resolves
  // "/operations/ledger" by looking for that *directory's* index.html. The
  // default export instead writes "operations/ledger.html" as a sibling
  // file, which a generic static server 404s on. trailingSlash makes the
  // export emit "operations/ledger/index.html" so clean URLs just work.
  trailingSlash: true,
  // The workspace packages ship TypeScript source rather than build output,
  // so Next compiles them alongside the app.
  transpilePackages: ['@logisticdigi/core', '@logisticdigi/x402'],

  webpack(config) {
    // Those packages use explicit `.js` specifiers, which is correct for ESM
    // and required by Node's resolver. Webpack resolves them literally and
    // finds nothing, because the files on disk are `.ts`. This alias closes
    // the gap without weakening the packages' module correctness.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },

  turbopack: {
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },
};

export default config;
