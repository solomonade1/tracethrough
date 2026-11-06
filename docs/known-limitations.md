# Known limitations

- **Websites you don't own:** only browser traffic is visible. Their server-side requests (including server rendering) are not exposed to anyone but the site.
- **Server requests are recorded only for apps you connect**, and only Node `fetch` (undici) calls. Axios and `node:http`/`https` clients are not recorded yet.
- **Runtimes:** Node.js 20 or later. The Next.js Edge runtime is not supported.
- **Local only:** the collector accepts connections from the same computer. Remote collection is not supported.
- **Production:** the SDK is off when `NODE_ENV=production` unless you opt in.
- **Next.js 15:** the first render of each page after a compile or boot can show as **Not linked**. Next.js 16 has no gap. Other Next.js versions are untested. Next.js 15 needs TypeScript 6 or earlier.
- **Next.js internals:** the adapter reads Next.js's private request store. If a release changes it, server rows appear unlinked rather than breaking your app.
- **Bodies:** previews up to 64 KB each on the server by default; streamed (`text/event-stream`) and binary bodies are reported, not read.
- **Memory:** at most 10,000 events and about 128 MiB of event data per session, oldest dropped first.
- **Browsers:** sessions open in Google Chrome or Microsoft Edge from your computer; no browser is bundled.
- **Installers** are unsigned unless a release says otherwise; there is no auto-update.
