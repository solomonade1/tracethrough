import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const config = {
  // The TraceLens packages ship TypeScript source inside this monorepo.
  transpilePackages: ['@tracelens/next', '@tracelens/node', '@tracelens/core'],
  // Pin the monorepo root rather than letting Next guess from lockfiles found further up.
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
};

export default config;
