import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
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
