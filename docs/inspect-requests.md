# Inspect requests and responses

Every request appears in the list as it happens. Each row is labelled **Browser** or **Server**.

- **Search and filter:** the search box narrows the list; the dropdowns filter by type, source, status, method and domain. Tick **Bodies** to search body previews too, and **Group by page** to group requests under the page that caused them.
- **Details:** click a row to open its overview, headers (request, response, cookies), request body, response body and timing.
- **Bodies:** shown as a searchable tree, pretty-printed or raw. Copy a value, its path or the whole body, or save it.
- **Copy as cURL:** in the detail header, with more options (fetch, headers, a HAR entry, everything).
- **Failures** show the reason, such as a DNS error. Missing, truncated, binary or streamed bodies say why instead of showing nothing.

## Browser and server rows

With **This is my app** on, a browser request lists the server calls it triggered, and a server call links back to the request and handler that caused it. Links are made only when the trace id matches exactly. A server row that shows **Not linked** was not tied to a browser request (see [Known limitations](known-limitations.md)).

## Limits

Body previews are bounded. The app keeps at most 10,000 events and about 128 MiB of event data, oldest first; the status bar counts anything dropped.
