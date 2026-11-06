# Inspect a website

1. On the home screen choose **Inspect Website**.
2. Enter a URL. A bare host such as `example.com` becomes `https://example.com` (`http://` for `localhost`). Only `http` and `https` are accepted.
3. Click **Start session**. A separate Chrome or Edge window opens with a fresh profile: no cookies, no extensions.

## Session preferences

- **Mask secrets** hides cookies, tokens, API keys and passwords in the list and in exports. It is **off by default**, so values appear exactly as captured. Turn it on before screenshots or sharing. It is chosen when the session starts. See [Privacy and sensitive data](privacy-and-sensitive-data.md).
- **This is my app** is for sites you run yourself with the SDK installed. See [Connect a Next.js app](connect-nextjs.md). Leave it off for any other site.

## What you will see

Browser requests only. A website's own server-side requests (for example, data fetched while it renders on the server) happen between its servers and are not visible to TraceThrough. Only your own app can show those, through the SDK.

Only inspect sites you are authorized to access.
