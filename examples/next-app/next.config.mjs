import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const config = {
  // The TraceThrough packages ship TypeScript source inside this monorepo.
  transpilePackages: ['@tracethrough/next', '@tracethrough/node', '@tracethrough/core'],
  // Pin the monorepo root rather than letting Next guess from lockfiles found further up.
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
};

export default config;
