---
'@tracethrough/core': minor
---

Add helpers for copying and saving a single exchange: `toCurl`, `toFetch`, `toHarEntry`, `parseCookies`, `jsonPathToString`, `headerLines` and `exchangeAsText`. `toHar` now builds each entry with `toHarEntry`, so single-entry and full exports cannot drift; its output is unchanged.
