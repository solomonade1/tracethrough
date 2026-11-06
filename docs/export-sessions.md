# Export sessions

**Export** in the session header saves the whole session or only what is currently shown (after filters) as **HAR** or **JSON**. Tick rows first to export just those.

- Sessions live in memory on this computer until you export them. Closing the app discards them.
- Without **Mask secrets**, exports contain live cookies and tokens. Treat the file as a secret. The export dialog warns you.
- With **Mask secrets** on, exports carry the masked values.
- HAR entries record the HTTP version the browser reported (`http/1.1`, `h2`, `h3`); when it was not observed (server events), the entry says `unknown`.

See [Privacy and sensitive data](privacy-and-sensitive-data.md).
