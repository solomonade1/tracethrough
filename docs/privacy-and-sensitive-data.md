# Privacy and sensitive data

## Where data goes

Captured traffic stays on your computer: it is held in memory and written to disk only when you export it. There is no account and no cloud service. The site you inspect still receives the normal requests your browser makes.

## Masking

**Mask secrets** is chosen per session, before it starts, and is **off by default**. Off means every value (cookies, tokens, API keys, bodies) is shown exactly as sent, in the list, the detail pane and exports. On means a masking policy hides them before anything is stored, shown or exported. Multipart bodies are omitted while it is on. Masking is defense in depth, not a guarantee. Turn it on before screenshots or sharing.

## Connect App

- The collector listens on `127.0.0.1` only and requires a token. The token is stored on this computer; **Regenerate token** locks out apps using the old one.
- The SDK sends values as captured to the local collector. TraceThrough applies the session's masking setting when it receives them.
- With **This is my app**, TraceThrough adds a `traceparent` header to requests to that one origin, and nowhere else.
- The SDK is off in production (`NODE_ENV=production`) unless you opt in with `TRACETHROUGH_ALLOW_PRODUCTION=1`.

Only inspect sites and apps you are authorized to access.
