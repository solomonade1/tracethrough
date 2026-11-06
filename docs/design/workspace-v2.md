# Workspace v2: design and implementation spec

Status: Implemented 6 Nov 2026 (see [§15](#15-implementation-notes)) · Date: 5 Nov 2026 · Applies to: `apps/desktop` renderer, `packages/core`, desktop main and web mode

This is the full brief for rebuilding the session workspace. It covers the user flows, design tokens, layout, every component and state, copy text, how each element maps to `NetworkEvent` data, the files to change, and the tests to update.

**Reference mockup:** [workspace-v2-mockup.html](workspace-v2-mockup.html). Open it in a browser; it is interactive and uses sample data. The same page is published as the "TraceThrough Redesign" artifact. When this spec and the mockup disagree, **this spec wins**. Known differences are listed in [§14](#14-where-the-mockup-differs-from-this-spec).

---

## Contents

1. [Goal and scope](#1-goal-and-scope)
2. [Rules carried from the PRD](#2-rules-carried-from-the-prd)
3. [Screen anatomy](#3-screen-anatomy)
4. [Design tokens](#4-design-tokens)
5. [Components](#5-components)
6. [User flows](#6-user-flows)
7. [States and copy](#7-states-and-copy)
8. [Keyboard and accessibility](#8-keyboard-and-accessibility)
9. [Data mapping](#9-data-mapping)
10. [Implementation map](#10-implementation-map)
11. [Test changes](#11-test-changes)
12. [Acceptance checklist](#12-acceptance-checklist)
13. [Decisions taken](#13-decisions-taken)
14. [Where the mockup differs from this spec](#14-where-the-mockup-differs-from-this-spec)

---

## 1. Goal and scope

The workspace is the screen shown after **Start session**. Today it is the topbar, banner, chip filter bar, request table and detail pane in `Workspace.tsx`. v2 keeps that shape: the list on the left and the detail pane on the right. It also keeps everything the draft-1 design showed. It adds what the capture schema and the development plan already support but the UI does not yet expose.

### In scope

| Area | Change |
|---|---|
| Top bar | Export becomes one menu with a scope choice; New session becomes the primary button |
| Session strip | Replaces `.banner`: connection, traffic scope, masking, local-only, warnings, notices |
| Filter bar | Dropdowns replace chip groups; adds a Status dropdown, the Bodies toggle inside the search box, Reset, Group by page and the count |
| Request table | Row checkboxes, server calls nested under the browser request that triggered them, a Linked indicator, Size reasons, a slow-time colour, optional grouping by page |
| Selection bar | Copy as cURL, Export selected, Clear selection |
| Detail header | Status, method, path, a Copy as cURL split button with a full Copy menu, a meta line |
| Overview tab | Linked calls and redirects as clickable cards, error alert, General table |
| Headers tab | Find header, Copy all, per-group and per-row copy, Cookies section, sensitive tags |
| Request tab | Query parameters plus the shared body viewer |
| Response tab | Shared body viewer: Tree, Pretty, Raw, Copy body menu, Save menu, Find, Expand and Collapse all, breadcrumb, Copy value, Copy path |
| Timing tab | Cumulative phase bars, a "not reported" state, Copy |
| Export dialog | In-app dialog for scope, format and masking warning, then the native save dialog |
| Single-request save | Save body, Save request as HAR, Save request and response as JSON |
| Status bar | Request count, linked and unlinked server calls, failures, dropped events, keyboard hint |

### Out of scope (do not build)

- Code generation (TypeScript, Zod, MSW), insights panels, compare, replay, mock. These are Phase 3 in `DEVELOPMENT_PLAN.md` or not in the PRD at all.
- Toggling masking during a session. Redaction runs in main before events reach the renderer, so masking is fixed at session start.
- A waterfall column in the table (UI-04 waterfall). Timing stays in the Timing tab.
- Recent sessions or a URL history dropdown. Persistence (SQLite) is Sprint 4. The URL pill has **no** caret until that exists.
- Home screen and Connect App panel. These are unchanged, apart from picking up the new tokens.

---

## 2. Rules carried from the PRD

Every component below must keep to these. If a design detail conflicts with one, the rule wins.

1. **Honest labels.** Every event shows Browser or Server. Server calls link to a browser request **only** when `traceId` matches exactly (COR-01). Never infer a link from timing or URL. Unlinked server calls say "not linked".
2. **Never fabricate.** Missing, truncated, binary, redirect and streamed bodies show a reason (US-06), never an empty viewer. Fields the browser did not report say "not reported".
3. **Inert rendering.** Bodies are text, never HTML. No `dangerouslySetInnerHTML`. The JSON tree builds React nodes.
4. **Renderer sees only what main sends.** If masking is on, every copy and save action outputs the masked value (`[REDACTED]`). The renderer never asks main for unmasked data.
5. **Local-first.** No network requests from the renderer. Fonts are bundled ([§4.2](#42-typography)). Clipboard and file writes only happen on a user click.

---

## 3. Screen anatomy

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ TOP BAR 50px   Logo │ URL pill │ ● Recording           [■ Stop] [Clear] [Export ▾] [+ New session] │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│ SESSION STRIP 34px  ● App connected │ Browser + Server · traceparent on <origin> only │ ● Masking off │ … │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│ FILTER BAR 50px  [Search…  ☐ Bodies] [Type▾][Source▾][Status▾][Method▾][Domain▾] Reset   ☐ Group by page  n of N │
├──────────────────────────────────────────────────┬─┬──────────────────────────────────────┤
│ REQUEST TABLE                                    │ │ DETAIL PANE (540px default)          │
│ ☐ Status Method Name          Domain Size Time Source │▐│ 200 OK  GET  /path   [Copy as cURL▾] ✕ │
│ ☐ 200    GET   /shop          …      48KB 1.62s Browser 2 linked │▐│ host · 475 ms · 2.2 KB · Server · h2 │
│ ☐ 200    GET    └ /api/…      …      2.2KB 475ms Server linked │▐│ Overview Headers 9 Request Response Timing │
│ …                                                │ │ (tab content)                         │
│ SELECTION BAR (only when rows are ticked)        │ │                                       │
├──────────────────────────────────────────────────┴─┴──────────────────────────────────────┤
│ STATUS BAR 30px  14 requests · 3 server calls linked · 1 not linked · 1 failed   No dropped events │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- The 6px divider between table and detail is a **resize grip**. Width is clamped to 420–720px or 55% of the window, whichever is smaller. It is saved to `localStorage` as `tt.detailWidth`, with try/catch.
- With no row selected, the table takes the full width, as `split.with-detail` does today.
- The Electron window keeps `minWidth: 900`. Below 1200px window width, hide the **Domain** column; domain stays in the detail meta line. Below 1000px, the detail pane overlays the table from the right, full height, with a shadow.

---

## 4. Design tokens

Replace the `:root` block in `apps/desktop/src/renderer/src/styles.css` with the tokens below. Both themes are required. The **dark palette is the mockup's** (`workspace-v2-mockup.html`), token for token; the light palette is derived from it.

**Theme choice.** A theme menu (System, Light, Dark) sits at the right end of the top bar and of the Home brand row; its button shows a monitor, sun or moon icon and is named "Theme: <choice>". System follows `prefers-color-scheme`; Light and Dark set `data-theme` on `<html>`, and the choice is saved in `localStorage` as `tt.theme`. The dark tokens are declared twice, under `:root[data-theme='dark']` and under `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }`; keep the two blocks identical. The stored choice is applied before the first render so there is no flash. Native Electron dialogs (save, confirm) still follow the OS.

Token names extend the existing ones (`--bg`, `--fg`, `--border` and so on) so existing rules keep working. **One rename:** `--server` currently means "5xx status colour", which clashes with the Server source badge. Rename it to `--status-5xx` everywhere, and use `--src-server` for the source.

### 4.1 Colour

| Token | Role | Light | Dark |
|---|---|---|---|
| `--bg` | App background, detail pane | `#ffffff` | `#0c111d` |
| `--bg-2` | Bars: topbar, strip, table head, status bar, menus | `#f6f7f9` | `#101624` |
| `--bg-3` | Raised controls: buttons, hover | `#eceef2` | `#172033` |
| `--bg-input` | Inputs, selects, segmented off state | `#ffffff` | `#0a0e16` |
| `--fg` | Primary text | `#1d2129` | `#e7ebf3` |
| `--fg-muted` | Secondary text, labels | `#667085` | `#8a96ac` |
| `--border` | Panel borders, inputs | `#dde1e7` | `#1f2a3f` |
| `--border-soft` | Row separators | `#eceef2` | `#182134` |
| `--border-strong` | Hover borders, menus, dialogs | `#c4cad4` | `#34446a` |
| `--accent` | Primary button, focus ring, active tab, active filter | `#3559e0` | `#5b9bff` |
| `--accent-fg` | Text on accent | `#ffffff` | `#06101f` |
| `--selected` | Selected row and tree node background | `#e4ebff` | `#5b9bff1f` |
| `--src-browser` | Browser badge text and border | `#2f5fd0` | `#7aa7ff` |
| `--src-server` | Server badge text and border | `#7c4dcc` | `#b79cff` |
| `--ok` | 2xx | `#1f7a3d` | `#4ade80` |
| `--redirect` | 3xx | `#0e7490` | `#5b9bff` |
| `--client` | 4xx, warnings, "not linked", slow time | `#b45309` | `#f5b84b` |
| `--status-5xx` | 5xx | `#c0262d` | `#ff6b6b` |
| `--failed` | Failed state, error alerts | `#c0262d` | `#ff6b6b` |
| `--rec` | Recording dot, Stop button | `#e5484d` | `#ff6b6b` |
| `--mask-bg` / `--mask-fg` | `mark.masked` (unchanged) | `#fde68a` / `#713f12` | `#4a3b10` / `#fde68a` |
| `--hit` | Find-match highlight | `#fde68a` | `#f5b84b33` |

Tinted fills for pills and notes are the semantic colour at low alpha: about 10% (`1a`) for status pills, and 6% (`0f`) for note backgrounds with 27% (`44`) borders. Write them with `color-mix(in srgb, var(--ok) 10%, transparent)` so both themes work from one rule.

JSON syntax colours, used only in the tree and pretty views:

| Token | Light | Dark |
|---|---|---|
| `--json-key` | `#2f5fd0` | `#86bbff` |
| `--json-string` | `#1f7a3d` | `#7ee3b8` |
| `--json-number` | `#b45309` | `#ffb86b` |
| `--json-bool` | `#a3367f` | `#ff8ad4` |
| `--json-null` | `#667085` | `#8a96ac` |

### 4.2 Typography

| Token | Value |
|---|---|
| `--sans` | `"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` |
| `--mono` | `"IBM Plex Mono", ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace` |

Bundle the fonts with `@fontsource/ibm-plex-sans` (400, 500, 600) and `@fontsource/ibm-plex-mono` (400, 500), imported in `main.tsx`. Both are OFL-licensed. Do **not** load Google Fonts: the production CSP and local-first rule forbid it.

| Use | Size / line height | Weight | Face |
|---|---|---|---|
| Base UI text | 13px / 1.4 | 400 | sans |
| Table cells, paths, headers, bodies, numbers | 12px / 1.6 | 400–500 | mono |
| Detail path (header) | 14px | 500 | mono |
| Status pill in detail header | 14px | 500 | mono |
| Section labels ("REQUEST HEADERS") | 11px, uppercase, letter-spacing .06em | 600 | sans |
| Badges, counts, tags | 11px | 500 | sans |
| Dialog title | 16px | 600 | sans |
| Logo | 15px | 600 | sans |

Use `font-variant-numeric: tabular-nums` on Size, Time, counts and timing values.

### 4.3 Spacing, radius, sizes

| Token | Value | Use |
|---|---|---|
| `--space-1` … `--space-5` | 4, 6, 8, 12, 14px | Gaps; 14px is the standard horizontal padding of every bar and pane |
| `--radius-sm` | 5px | Badges, status pills, small buttons |
| `--radius` | 7px | Buttons, inputs, selects, link cards |
| `--radius-lg` | 9–12px | Menus (9), dialog (12) |
| `--h-topbar` | 50px | |
| `--h-strip` | 34px | |
| `--h-filter` | 50px | |
| `--h-row` | 30px | Table row; update `ROW_HEIGHT` in `RequestTable.tsx` |
| `--h-group` | 28px | Group-by-page header row |
| `--h-status` | 30px | |
| `--w-detail` | 540px | Default detail width |
| `--shadow-pop` | `0 16px 40px rgb(0 0 0 / .35)` | Menus, dialog |

Z-order: table group headers 1, menus 20, dialog 30, toast 40.

Motion: the toast fades over 150ms and the switch knob slides over 150ms. Both are off under `prefers-reduced-motion`. Nothing else animates.

### 4.4 Table column grid

`grid-template-columns: 24px 54px 54px minmax(0,1fr) 112px 62px 66px 134px; gap: 6px; padding: 0 10px;` (Source is 134px so "Browser · 2 linked" and "Server · not linked" fit.)

The columns are checkbox, Status, Method, Name, Domain, Size, Time and Source. Size and Time are right-aligned.

---

## 5. Components

Component names are suggestions. Where an existing class name is used by e2e tests it is listed and **must be kept**.

### 5.1 Top bar (`Workspace.tsx`, `.topbar`)

| Element | Behaviour |
|---|---|
| Logo | 18px rounded square with an accent-to-`--src-server` gradient, then "TraceThrough". A border on the right separates it from the URL. |
| URL pill | `status.url` in mono 12px, in an input-styled box at least 320px wide. Ellipsis when long; `title` holds the full URL. No caret ([§13](#13-decisions-taken)). |
| Recording indicator | `role="status"`, `aria-live="polite"`. Shows "Recording" with a red dot and halo, or "Stopped" with a muted dot. The test checks `/Recording/` and `/Stopped/`. |
| Stop | Only while recording. Danger style. Label `■ Stop`, which the test relies on. |
| Clear | Disabled when there are no events. Calls `clearSession()`, then resets the store, the selection and ticked rows. |
| Export ▾ | Disabled when there are no events. Opens the Export menu ([§5.13](#513-menus)). |
| Theme menu | Last item in the bar. See [§4](#4-design-tokens). |
| + New session | Primary button. If there are events, it asks first using the existing `confirm()` text: "Start a new session? Exchanges that have not been exported will be discarded." Its accessible name must contain "New session". |

### 5.2 Session strip (new `SessionStrip.tsx`, replaces `.banner`)

One 34px line of facts separated by 1px × 14px dividers. Use class `.session-strip`; the tests move from `.banner` to it.

| Slot | Content | Source |
|---|---|---|
| Connection | When `status.connectedOrigin` is set and at least one server event has arrived this session: green dot and **"App connected"**. Set but none yet: amber dot, "App Connect on · waiting for server events". Not set: this slot is left out, because the traffic-scope slot already says "Browser traffic only". | `status.connectedOrigin`; server-event count from `events` |
| Traffic scope | Connected: "Browser + Server · traceparent on `<host>` only". Not connected: "Browser traffic only · this site's own server calls are not visible". | `connectedOrigin` |
| Browser | A small static chip naming the browser, such as "Chrome" or "Edge". | `status.channel` |
| Masking | "Masking on" with an accent dot, or "Masking off" with a muted dot. It is not clickable; its tooltip reads "Masking is chosen when a session starts". | `status.masked` |
| Local | "Local session · in memory until exported" | static |
| Right side | When unmasked, an amber note: "Exports include live cookies and tokens". After an export, the notice "Exported to `<path>`" replaces it for 6s, then the note returns. | `status.masked`, export result |

The test at `connect.e2e.test.ts:87` looks for the exact text `App Connect`. Either keep a span with exactly that text (for example in the tooltip-trigger chip) or update the test to `/App connected|App Connect on/`. Preferred: update the test.

### 5.3 Filter bar (`FilterBar.tsx`)

The order is left to right as listed. The bar is 50px high with 8px gaps.

| Control | Spec | Maps to `EventFilter` |
|---|---|---|
| Search | A box 300px wide holding a magnifier icon, an input and a "☐ Bodies" checkbox separated by a left border. Input: `type="search"`, `aria-label="Search requests"` (tests use this), placeholder "Filter by URL, method or status". The filter update is a React transition (no artificial delay), so typing stays responsive on large sessions and tests do not race a timer. | `text`, `searchBodies` |
| Type | Select `aria-label="Type"`. Options: All types, Fetch / XHR, Doc, Fetch, XHR, Asset, Other. | `types`; "Fetch / XHR" maps to `['fetch','xhr']` |
| Source | Select `aria-label="Source"`. Options: All sources, Browser, Server. | `sources` |
| Status | Select `aria-label="Status"`. Options: All statuses, 2xx, 3xx, 4xx, 5xx, Failed, Pending. | `statusClasses` |
| Method | Select `aria-label="Method"`. "All methods" plus the methods seen in this session, sorted. | `methods` |
| Domain | Select `aria-label="Domain"`, at least 170px wide. "All domains" plus the domains seen, sorted. | `domains` |
| Reset | A link button, shown only when any filter is set. Clears all filters, including Bodies. | `resetFilter()` |
| (spacer) | | |
| Group by page | Checkbox. Off by default. Saved in the store, not in `localStorage`. | UI only |
| Count | `aria-live="polite"`. Shows "N requests" when nothing is filtered, otherwise "n of N requests". Appends " · D dropped (session cap)" in amber when `status.dropped > 0`. | |

A select with a value other than "All …" gets the active style: accent border and `--selected` fill. `core/filter.ts` needs no change.

### 5.4 Request table (`RequestTable.tsx`)

Keep the virtualizer, follow-tail behaviour, grid ARIA and keyboard handling. Keep the class names `.table`, `.body`, `.row`, `.c-status`, `.c-method`, `.c-name`, `.badge.browser` and `.badge.server`.

**Row model.** Build a flat array of row items from the filtered events, then virtualize that array:

```
type RowItem =
  | { kind: 'event'; event: NetworkEvent; child: boolean }
  | { kind: 'group'; key: string; label: string; count: number };
```

- **Default order: arrival order.** A server event that has a linked browser trigger *in the filtered set* is not placed in arrival order. It goes right after its trigger with `child: true`, ordered by timestamp. If the trigger is filtered out, the server event appears in arrival order as a normal row. A navigation must still be the first row (test `app.e2e.test.ts:55`).
- **Group by page on:** group by `navigationId` in arrival order of the first event in each group. The label is the path (`nameOf`) of the group's `isNavigation` event, or else of its first event. Events without a `navigationId`, including unlinked server calls, go in a final group called "Not tied to a page" with the note "server calls without trace context". Group headers are 28px high, and show the label in mono and "N requests" in muted text. Rows are not nested in this mode.

**Cells.**

| Column | Content |
|---|---|
| ☐ | Checkbox `aria-label="Select request"`. Clicking it toggles `picked` and does **not** select the row. |
| Status | Pill with mono 12px text and a tone colour: `statusLabel(e)`, which gives "failed" or "…" for pending. Keep `statusTone`. |
| Method | Mono, muted. |
| Name | `nameOf(urlSanitized)` in mono, with ellipsis; `title` holds the full URL. Child rows get a 16px indent and a `└` glyph in `--border-strong`. |
| Domain | `e.domain`, muted, ellipsis. Hidden below 1200px. |
| Size | `formatBytes(responseBody.sizeBytes)`, plus `*` when `truncated` with the tooltip "Truncated preview". Otherwise the existing `SHORT_REASON` text in muted. |
| Time | `formatMs(durationMs)`. Coloured `--client` when over 1000ms. Empty while pending. |
| Source | A `.badge.browser` or `.badge.server` badge, followed by a linked indicator. Browser rows with linked server calls show "N linked" with the tooltip "Server calls linked by trace ID". Linked server rows show "linked". Unlinked server rows show "not linked" in `--client`, with the tooltip "No browser request carried a matching trace context". |

Row states: hover is a 3% foreground tint. Selected gets the `--selected` background and a 2px inset accent bar on the left. A ticked checkbox does not change the row background. Failed rows keep the existing red name colour from `.tone-failed .c-name`.

**Header row:** a select-all checkbox (`aria-label="Select all shown"`) that ticks or unticks every *visible* event, followed by the column titles.

**Empty states:**
- No events yet: "No requests yet. Browse the site in the capture window." (existing).
- Events exist but none match: "No requests match these filters." followed by a **Reset filters** link.

### 5.5 Selection bar

Pinned at the bottom of the table column, shown only while `picked.size > 0`. It has an accent tint at 7%.

- "N requests selected" (singular "1 request selected").
- **Copy as cURL**: every picked request in table order, joined by a blank line. Toast: "Copied N cURL commands".
- **Export selected**: opens the Export dialog with scope "Selected rows".
- **Clear selection**: a link.

`picked` survives filter changes. Ids removed by the ring buffer are dropped from it in `applyBatch`. Clear and New session empty it.

### 5.6 Detail pane: header (`DetailPane.tsx`)

Keep `<aside aria-label="Request details">`, which tests use.

Line 1, 8px gaps:
- **Status pill:** "200 OK" (status and statusText), "Failed", or "Pending" in the tone colour, at 14px.
- **Method chip:** mono 12px, bordered, raised fill.
- **Path:** `nameOf(url)` in mono 14px/500, with ellipsis and the full URL as `title`. It takes the remaining space.
- **Split button:** "Copy as cURL" plus a ▾ that opens the **Request copy menu** ([§5.13](#513-menus)).
- **Close (✕):** `aria-label="Close details"`. Calls `select(undefined)`.

Line 2, muted 12px, with 1px dividers: the domain · `formatMs(duration)` · the size, or "no body" · the source badge · `protocol`, shown only when present.

Tabs: Overview · Headers *(count)* · Request · Response · Timing. The Headers count is the number of request headers plus response header lines. Tabs use `role="tab"` and `aria-selected`, and keep the names tests use. The selected tab stays the same when you select another row; this is the existing store behaviour, and the default stays `overview`.

### 5.7 Overview tab

Top to bottom:

1. **Error alert**, only when `state === 'failed'`: a red note with `role="alert"` showing `error.message` in bold and `error.code` in mono below it.
2. **Server calls**, only for browser events with a `traceId`. The heading carries the hint "linked by trace ID". It lists **link cards**: full-width bordered buttons showing status pill, source badge, method and path, with the duration pushed right. A card's accessible name starts with the status and method, for example "200 GET /api/slow". When there are none: "None reported for this request yet."
3. **Triggered by**, only for server events. It shows one link card, or the amber note: "Not linked: no browser request carried a matching trace context. TraceThrough does not guess links from timing."
4. **Redirected from** and **Redirects to**: link cards, using `redirectedFromId` in both directions.
5. **General**: a heading with a Copy link that copies the rows as `Label: value` lines. Then a key-value table (`table.kv`, with sans labels in muted text) with these rows, each omitted when empty: URL · Method · Status · Type, written `type (resourceType)` when they differ · **Source** · Started (`HH:MM:SS.mmm`, 24h) · Duration · Protocol, or "not reported" · Navigation ("Page navigation") · Service worker ("Served by service worker") · **Handled request** · Trace ID (mono) · Redaction. Keep the three existing Redaction sentences from `DetailPane.tsx`.

Clicking a link card selects that event, keeps the Overview tab and scrolls the table row into view.

### 5.8 Headers tab

- **Find row**, pinned at the top: an input "Find header or value…" that hides non-matching rows in all three sections, case-insensitive on name and value, and a **Copy all** button that copies request headers, a blank line, then response headers.
- **Request headers**: section label, count, and a Copy link (`name: value` lines). Then `table.kv` with mono names in `--json-key` and mono values.
- **Response headers**: the same. Multi-value headers are split on `\n` into separate rows, as today.
- **Cookies**: section label and count, plus a Copy link (`name=value` lines). Parse the request `cookie` header on `;\s*` into rows labelled "Sent", and each `set-cookie` line into a row labelled "Set" whose attributes (`Path=/; HttpOnly; SameSite=Lax`) appear on a second muted line. The name cell reads `name · Sent`. When there are none: "No cookies sent or set."
- **Per-row Copy:** each value cell has a small "Copy" button in the top-right. It is visible on row hover **and** on `:focus-within`, so keyboard users can reach it. It copies the value only. Toast: "Copied `<name>`".
- **Sensitive tag:** when masking is **off**, rows whose name matches `authorization | proxy-authorization | cookie | set-cookie | x-api-key` get an amber "sensitive" tag after the value. When masking is on, masked values are highlighted with `mark.masked` (existing `Masked` component), and the tag is not shown.
- Empty states keep the existing text: "No request headers captured.", "Waiting for response…", "No response headers (request did not complete)."

Keep `tr` rows; tests find `tr` by header name.

### 5.9 Request tab

The top area holds Query parameters and the Body heading. It scrolls separately, with a maximum height of 190px.

- **Query parameters**: a count and a Copy link that copies the query string without `?`. Then `table.kv` with per-row copy. When there are none: "No query parameters."
- **Body**: the heading, then the shared **Body viewer** ([§5.11](#511-body-viewer-new-bodyviewertsx-and-jsontreetsx)) bound to `requestBody`. When the body is absent: "GET requests have no body." for GET and HEAD, otherwise "No request body."

### 5.10 Response tab

The shared Body viewer bound to `responseBody`. When the body is absent: "Waiting for response…" while pending, otherwise "No response body (request did not complete)."

### 5.11 Body viewer (new `BodyViewer.tsx` and `JsonTree.tsx`)

This replaces `BodyView` and is used by both Request and Response. Its view mode is saved **per tab** in the store (`requestView` and `responseView`), so switching rows keeps the view.

**Toolbar row**, left to right:
- **Segmented control** for Tree, Pretty and Raw, shown only when the body is **JSON**: the MIME type contains `json`, it is **not truncated**, and the preview parses. Default: Tree. Otherwise show the muted text "Shown as text, never run".
- (spacer)
- **Copy body** split button (primary): the main part copies the preview as captured. The ▾ opens the **Body copy menu**.
- **Save ▾** opens the **Save menu**.
- When the body is unavailable, Copy body is disabled. The Save menu then offers only the two "request" items.

**Meta row:** a MIME chip (mono 11px, bordered) · "Captured preview · `<size>`" · when truncated, an amber "Truncated: the body is larger than the capture limit" · (spacer) · **Expand all** and **Collapse all** links (Tree view only).

**Find row:** input "Find in request…" or "Find in response…", plus a count ("0 matches", "1 match", "N matches"). Debounce 120ms.
- Tree: match keys and values case-insensitively. Highlight matching nodes with `--hit`, open every ancestor of a match, and scroll to the first. **Enter** moves to the next match and **Shift+Enter** to the previous; the current match also gets an accent outline.
- Pretty, Raw and text: wrap matches in `<mark class="find-hit">` inside the `<pre>`, by splitting the text into React nodes rather than injecting HTML. Enter and Shift+Enter cycle the same way.
- **Ctrl/Cmd+F** while the detail pane has focus focuses this input.

**Content:**
- **Tree** (`JsonTree`): `<details>`/`<summary>` or an equivalent `role="tree"` structure. An object reads `{ N properties }` and an array `[ N items ]`. Child levels have a 16px indent and a dashed left guide. Nodes are open to depth 3 by default. Arrays with more than 100 items show the first 100 and a "Show N more" button. Leaves read `key: value`, coloured with the JSON tokens; strings are quoted. Masked strings render with `mark.masked`.
  - Clicking a leaf **or** a summary selects that node: `--selected` background and `aria-selected`.
- **Pretty:** `JSON.stringify(parsed, null, 2)` in `<pre>`. **Raw:** the preview exactly as captured, in `<pre>`. **Text bodies** (HTML, JS, plain text): the preview in `<pre>`, always inert. All `<pre>` elements use `white-space: pre-wrap; word-break: break-all`, and every view passes through `Masked`.

**Footer row** (Tree view only): a breadcrumb of the selected node's path, such as `data › items › 0 › name`, with the last segment in bold. Before any selection it reads "Click a value to see its path". Then **Copy value** and **Copy path**, both disabled until something is selected.
- **Path format:** a JavaScript accessor from the root, for example `data.items[0].name`. Keys that are not identifiers use `["key"]`. The root is an empty path.
- **Copy value:** strings copy without quotes; numbers, booleans and null copy as their JSON text; objects and arrays copy as pretty JSON.

**Unavailable body:** the toolbar still renders (with Copy disabled), then the reason note using the existing `unavailableMessage()` text and the `.unavailable` class, which tests use.

### 5.12 Timing tab

- A "PHASES" heading with a Copy link (`Phase: value` lines).
- Rows of DNS lookup, Connect, TLS, Waiting (TTFB) and Download, with columns label (110px), track and value (64px, right-aligned).
- The track is a 10px bar whose segment starts where the previous phases end and is as wide as `ms / durationMs`, with a minimum of 0.8%. It is accent coloured.
- When a phase is missing, the track cell reads "Not reported (reused connection, cache or server event)".
- A bold **Total** row with `formatMs(durationMs)`. Keep it as a `tr`, which the test uses. **Implementation note:** build this tab as a `table.kv` so the `tr` locator keeps working.
- While pending: "Waiting for response…"

### 5.13 Menus

There is one `Menu` primitive: `role="menu"` with `role="menuitem"` buttons. It is anchored to the button's bottom edge, right-aligned, and flips left when it would overflow. It is at least 230px wide, with a 9px radius, `--bg-2` fill, `--border-strong` border and `--shadow-pop`. Items are 6px × 9px, and a right-aligned muted mono hint (`.har`, `bash`) is allowed. Arrow keys move between items, Enter runs one, and Esc closes the menu and returns focus to its button. Clicking outside closes it. Only one menu is open at a time.

**Export menu** (top bar):

| Group label | Item | Hint |
|---|---|---|
| Whole session | Export as HAR | `.har` |
| | Export as JSON | `.json` |
| Only what is shown | Export filtered as HAR | `n of N` |
| | Export filtered as JSON | `n of N` |

Each item opens the Export dialog with that scope and format preselected.

**Request copy menu** (detail header ▾):

| Item | Output |
|---|---|
| Copy URL | `urlSanitized` |
| Copy as cURL *(bash)* | `toCurl(e)` ([§10.1](#101-packagescore)) |
| Copy as fetch *(JS)* | `toFetch(e)` |
| — | |
| Copy request headers | `name: value` lines |
| Copy response headers | `name: value` lines |
| Copy response body | Response preview as captured |
| — | |
| Copy as HAR entry | One HAR 1.2 entry as JSON |
| Copy everything *(request + response)* | Request line, headers, body, a blank line, status line, headers, body |

**Body copy menu:** Copy body *(as captured)* · Copy pretty JSON (JSON only) · Copy selected value · Copy selected path. The last two show the toast "Click a value in the tree first" when nothing is selected.

**Save menu:** Save body *(.json / .html / .js / .txt, from the MIME type)* · Save this request *(.har)* · Save request + response *(.json)*. Save body is hidden when the body is unavailable. Each item calls `saveFile` ([§10.3](#103-shared-api-and-main)), which opens the native save dialog.

### 5.14 Export dialog (new `ExportDialog.tsx`)

A modal inside the workspace: `role="dialog"`, `aria-modal="true"`, labelled by its title. It is 480px wide with an 18px padding and a 12px radius, over a dimmed scrim. Focus is trapped and starts on the primary button. Esc or Cancel closes it.

1. Title: **Export**.
2. **Scope** radio cards: "Whole session · N requests", "Only what is shown · n requests match the filters", and "Selected rows · k requests" (only when `picked.size > 0`).
3. **Format** radio cards: "**HAR 1.2** · Opens in Chrome DevTools, Charles, Fiddler. Server calls carry `_source: server`." and "**TraceThrough JSON** · Everything captured, including trace IDs and links between browser and server."
4. **Warning note**, using `exportWarning(masked)` from `@tracethrough/core`: an amber note when unmasked, with the lead-in "Masking is off for this session."; a neutral note when masked.
5. Buttons: **Cancel** and **Save file…** (primary). Save calls `exportSession(format, { ids })` with `ids` omitted for the whole session. On `saved: true`, the dialog closes and the strip notice and a toast both show "Exported to `<path>`". On cancel from the native dialog, nothing changes.

Selected radio cards get an accent border and a 6% accent fill (`:has(input:checked)`).

### 5.15 Toast

A single toast in the bottom centre, 44px above the status bar. It is an inverted pill (`--fg` background, `--bg` text, 12px/500) with `aria-live="polite"` and **no** `role="status"` (the Recording indicator is the only `role="status"` in the workspace, and tests find it by role), and stays for 1.5s. New messages replace the current one. If the clipboard write fails, the toast reads "Couldn't copy: clipboard unavailable".

### 5.16 Status bar

A 30px bar on `--bg-2` with 12px muted text and bold counts:

- "N requests"
- "N server calls linked"
- "N not linked"
- "N failed"
- (spacer)
- "No dropped events · cap 10,000", or "D dropped (session cap)" in amber
- "Arrow keys move through the list"

---

## 6. User flows

Each flow lists the trigger, then the steps, then what the user should see. The mockup reproduces F2 to F12 with sample data.

### F1. Start a session and watch traffic

1. On Home, enter a URL, optionally tick "This is my app" and "Mask secrets", and click **Start session**. Home is unchanged.
2. The workspace opens. The Recording dot pulses, the strip states connection, scope and masking, and the list is empty with its empty-state text.
3. Requests stream in. The list follows the tail while it is scrolled to the bottom, as today. Server calls appear nested under their browser request once both have arrived.
4. **Outcome:** the user always knows what can and can't be seen, from the strip, and whether values are masked.

### F2. Find a request

1. Type in Search; tick **Bodies** to also search body previews.
2. Narrow down with the Type, Source, Status, Method and Domain selects. Active selects are highlighted and the count reads "n of N requests".
3. Optionally tick **Group by page** to see requests under each page navigation.
4. Click **Reset** to clear everything.
5. **Outcome:** the user reaches any request in at most two controls. The draft's "Fetch / XHR", "All sources", "GET" and domain filters all still exist.

### F3. Read a response and copy part of it

1. Click a row. The detail pane opens on the last-used tab. Open **Response**.
2. A JSON body opens in Tree view. Switch to Pretty or Raw at any time.
3. Type in **Find in response**. Matches highlight, collapsed branches open, and the count updates. Enter moves to the next match.
4. Click a value. The breadcrumb shows `data › items › 0 › name`. Click **Copy value** or **Copy path** (`data.items[0].name`).
5. Or use **Copy body ▾** for the whole body as captured, pretty JSON, or the selected value or path.
6. **Save ▾ › Save body** writes the body to a file through the native save dialog.
7. **Outcome:** every copy action from the draft works, plus path copying and saving.

### F4. Inspect headers and cookies

1. Open **Headers**. The tab shows the header count.
2. Scan Request headers, Response headers and Cookies. Sensitive headers are tagged when masking is off.
3. Type in **Find header or value** to filter rows across all three sections.
4. Copy one value (hover or focus the row, then Copy), one group (its Copy link) or everything (**Copy all**).
5. **Outcome:** cookies no longer have to be read out of raw `cookie` and `set-cookie` strings.

### F5. Inspect what was sent

1. Open **Request**. Query parameters are listed with per-row copy.
2. The body uses the same viewer as Response, with the same tree, find and copy tools.
3. **Outcome:** request and response are symmetrical, which the draft lacked.

### F6. Follow a request from browser to server and back

1. Select a browser row tagged "2 linked". Its server calls sit under it in the list.
2. Overview › **Server calls** lists them as cards. Click one.
3. The server call opens, still on Overview. **Triggered by** links back, and **Handled request** shows the route, for example `GET /shop`.
4. A server call that is "not linked" says why, in amber, and makes no guess.
5. **Outcome:** App Connect's main value (COR-01) is visible from the list, not only inside the detail pane.

### F7. Follow a redirect chain

1. Select a 3xx row. Response says "Redirect responses have no readable body. See the next hop in Overview."
2. Overview › **Redirects to** opens the next hop, which shows **Redirected from**.

### F8. Understand a failure or a missing body

1. A failed row shows a red "failed" status. Overview opens with an error alert giving the message and code, for example `net::ERR_NAME_NOT_RESOLVED`.
2. Binary, too-large, streamed and read-failed bodies show the matching `unavailableMessage` text. Copy body is disabled.
3. A truncated JSON body shows the amber "Truncated" note and opens as text, without Tree or Pretty, because it cannot be parsed honestly.

### F9. Reproduce a request elsewhere

1. In the detail header, click **Copy as cURL**, or open ▾ for fetch, a HAR entry, headers or everything.
2. A toast confirms what was copied.
3. With masking on, the output contains `[REDACTED]` where values were masked. This is stated in the menu's tooltip: "Masked values stay masked".

### F10. Save one request

1. In the body viewer, **Save ▾ › Save this request (.har)** or **Save request + response (.json)**.
2. The native save dialog suggests `tracethrough-<method>-<last-path-segment>-<stamp>.<ext>`.
3. **Outcome:** a single request can be shared without exporting the session.

### F11. Export several requests

1. Tick rows in the table, or use the header checkbox to tick everything shown.
2. The selection bar appears. Choose **Copy as cURL** (all of them) or **Export selected**.
3. The Export dialog opens with "Selected rows" chosen. Pick HAR or JSON, read the warning, and click **Save file…**.
4. **Clear selection** dismisses the bar.

### F12. Export the session

1. Top bar **Export ▾**: whole session or only what is shown, as HAR or JSON.
2. The Export dialog opens preselected. Its warning text comes from `exportWarning(masked)`.
3. Click **Save file…**, then use the native save dialog. Afterwards the strip and a toast show "Exported to …".
4. **Outcome:** this replaces the two separate Export HAR and Export JSON buttons and the native warning box, with one confirmation instead of two.

### F13. Stop, clear, start over

- **■ Stop:** recording ends and the indicator reads "Stopped". The list and detail pane stay usable, and exporting still works.
- **Clear:** the list, selection and ticked rows empty. The session keeps recording.
- **+ New session:** confirms when there is unexported data, then returns to Home.

### F14. Keyboard-only pass

Tab moves from the top bar to the strip (which has no focusable items), the filters, the table, the detail tabs and then the tab content. In the table, ↑ ↓ Home End move the selection, Space ticks the focused row and Esc closes the detail pane. In the detail pane, Ctrl/Cmd+F focuses Find. Menus and the dialog behave as described in [§8](#8-keyboard-and-accessibility).

---

## 7. States and copy

All copy is plain, active, and written from the user's side. Do not invent new wording for the states that already have text in `format.ts` or `DetailPane.tsx`; reuse it.

| State | Where | Text |
|---|---|---|
| No events | Table | "No requests yet. Browse the site in the capture window." |
| Nothing matches | Table | "No requests match these filters." + **Reset filters** |
| Pending | Status cell, Time cell | "…" and empty |
| Pending | Response, Headers, Timing | "Waiting for response…" |
| Failed | Overview | Alert: `error.message` / `error.code` |
| Body: empty | Viewer | "No body." |
| Body: too-large | Viewer | "Body (X) is above the capture read limit, so it was not read." |
| Body: binary | Viewer | "Binary content of type M (X) is not displayed." |
| Body: redirect | Viewer | "Redirect responses have no readable body. See the next hop in Overview." |
| Body: streamed | Viewer | "Streamed response (for example server-sent events). The body is not captured." |
| Body: read-failed | Viewer | "The browser did not make this body available (cancelled, opaque/CORS-restricted, or evicted from the network cache)." |
| Body: omitted-by-policy | Viewer | The existing two variants (multipart while masked, or body capture off) |
| Truncated | Viewer meta | "Truncated: the body is larger than the capture limit" |
| Text body | Viewer toolbar | "Shown as text, never run" |
| No request body | Request | "GET requests have no body." / "No request body." |
| No query | Request | "No query parameters." |
| No cookies | Headers | "No cookies sent or set." |
| Phase missing | Timing | "Not reported (reused connection, cache or server event)" |
| Server calls none | Overview | "None reported for this request yet." |
| Not linked | Overview | "Not linked: no browser request carried a matching trace context. TraceThrough does not guess links from timing." |
| Not linked | Table | "not linked" (amber) |
| Copy done | Toast | "Copied URL" / "Copied cURL" / "Copied `<header>`" / "Copied path data.items[0].name" … |
| Copy needs selection | Toast | "Click a value in the tree first" |
| Clipboard failed | Toast | "Couldn't copy: clipboard unavailable" |
| Export done | Strip + toast | "Exported to `<path>`" |
| Unmasked session | Strip (right) | "Exports include live cookies and tokens" |
| Dropped events | Count, status bar | "D dropped (session cap)" |

---

## 8. Keyboard and accessibility

- Every control has a visible focus ring: 2px `--accent`, 1px offset.
- Table: keep `role="grid"`, `aria-rowcount`, `aria-rowindex` and `aria-selected`. Group header rows are `role="row"` with a single `role="rowheader"` cell spanning the columns. Child rows add `aria-level="2"`.
- Keys in the table: ↑ ↓ Home End (existing), Space toggles the tick on the selected row, Esc closes the detail pane.
- Tabs: `role="tablist"` / `tab` / `tabpanel`. ← and → move between tabs.
- Menus: `aria-haspopup="menu"` and `aria-expanded` on the trigger. ↑ ↓ Enter Esc inside the menu, with focus returned to the trigger.
- Dialog: focus trap, Esc closes, focus returns to the button that opened it.
- The JSON tree is reachable by keyboard. ↑ ↓ move between visible nodes, → opens and ← closes, Enter selects. Use `role="tree"` / `treeitem` with `aria-expanded`.
- Per-row Copy buttons show on `:focus-within`, not only on hover.
- Contrast: body text is at least 4.5:1 in both themes, and muted text at least 4.5:1 on `--bg`. Check `--fg-muted` on `--bg-2` too.
- Under `prefers-reduced-motion`, there is no toast fade and no switch slide.

---

## 9. Data mapping

| UI element | Source (`NetworkEvent` unless stated) |
|---|---|
| Status pill / tone | `state`, `status`, `statusText`; `statusLabel` and `statusTone` in `format.ts` |
| Status filter | `statusClassOf()` in core |
| Method | `method` |
| Name / path | `nameOf(urlSanitized)` |
| Domain | `domain` |
| Size | `responseBody.sizeBytes`, `truncated`, `unavailableReason` |
| Time | `durationMs` |
| Source badge | `source` |
| Linked children / "N linked" | browser `traceId` → server events with the same `traceId` |
| Triggered by / "linked" | server `traceId` → the browser event with the same `traceId` |
| "not linked" | `source === 'server'` and no browser event with that `traceId` (or no `traceId`) |
| Group by page | `navigationId`; label from the group's `isNavigation` event |
| Redirect cards | `redirectedFromId`, in both directions |
| Protocol | `protocol`, or "not reported" |
| Handled request | `handler` |
| Service worker | `fromServiceWorker` |
| Headers | `requestHeadersSanitized`, `responseHeadersSanitized` (values may contain `\n`) |
| Cookies | Parsed from `requestHeadersSanitized.cookie` and `responseHeadersSanitized['set-cookie']` |
| Query parameters | `new URL(urlSanitized).searchParams` |
| Bodies | `requestBody` / `responseBody`: `mime`, `sizeBytes`, `preview`, `truncated`, `unavailableReason` |
| Timing | `timing.dnsMs`, `connectMs`, `tlsMs`, `ttfbMs`, `downloadMs` |
| Error | `error.message`, `error.code` |
| Redaction row | `redactionApplied`, `status.masked` |
| Strip | `SessionStatus`: `url`, `channel`, `connectedOrigin`, `masked`, `dropped` |

Linked lookups run on every batch. Build one `Map<traceId, { browser?: NetworkEvent; server: NetworkEvent[] }>` per `events` change with `useMemo`, so nesting and counts stay O(n). This must meet the existing UI-02 budget: filtering 2,000 events at p95 under 200ms.

---

## 10. Implementation map

### 10.1 `packages/core`

Add `src/copy.ts` and export it from `src/index.ts`. These are pure functions with unit tests in `test/copy.test.ts`:

| Function | Notes |
|---|---|
| `toCurl(e: NetworkEvent): string` | `curl '<url>'`, `-X <METHOD>` when not GET, one `-H 'name: value'` per request header (multi-value lines split), `--data-raw '<preview>'` when there is a request body preview. Escape single quotes as `'\''`. Lines joined with ` \` and a newline plus two spaces. |
| `toFetch(e: NetworkEvent): string` | `await fetch(<url>, { method, headers, body })`. JSON-encode the strings. |
| `toHarEntry(e: NetworkEvent, masked: boolean): HarEntry` | Reuse the entry-building logic inside `toHar`. Refactor `toHar` to call it so the two cannot drift. |
| `parseCookies(e: NetworkEvent): { kind: 'sent' \| 'set'; name: string; value: string; attributes?: string }[]` | |
| `jsonPathToString(segments: (string \| number)[]): string` | `data.items[0].name`, with `["key"]` for keys that are not identifiers. |
| `exchangeAsText(e: NetworkEvent): string` | Used by "Copy everything". |

Tests must include a masked event, so outputs keep `[REDACTED]`; header values with quotes; multi-line `set-cookie`; a request without a body; and paths with non-identifier keys.

`filter.ts` and `schema.ts` need no change.

### 10.2 Renderer (`apps/desktop/src/renderer/src`)

| File | Change |
|---|---|
| `styles.css` | Tokens from [§4](#4-design-tokens), both themes; the `--server` → `--status-5xx` rename; styles for every new component; delete `.banner`, `.chip-group` and the filter `.chip` rules |
| `main.tsx` | Import the `@fontsource` CSS |
| `store.ts` | Add `picked: Set<string>`, `togglePick`, `setPicked`, `clearPicked`; `groupByPage` and its setter; `requestView` / `responseView` (`'tree' \| 'pretty' \| 'raw'`); `toast` plus `showToast(text)`; `exportDialog: { open; scope; format }`. `applyBatch` removes evicted ids from `picked`. `reset` clears `picked`. |
| `components/Workspace.tsx` | New top bar, `SessionStrip`, `FilterBar`, the table and detail with a resizable grip, `SelectionBar`, `StatusBar`, `ExportDialog`, `Toast` |
| `components/SessionStrip.tsx` | New ([§5.2](#52-session-strip-new-sessionstriptsx-replaces-banner)) |
| `components/FilterBar.tsx` | Rewrite with selects ([§5.3](#53-filter-bar-filterbartsx)) |
| `components/RequestTable.tsx` | Row model, checkbox column, linked cell, group rows, empty states, 30px rows ([§5.4](#54-request-table-requesttabletsx)) |
| `components/SelectionBar.tsx`, `StatusBar.tsx`, `Toast.tsx`, `Menu.tsx`, `ExportDialog.tsx` | New |
| `components/DetailPane.tsx` | Becomes the header and tabs shell. Move each tab into `detail/OverviewTab.tsx`, `HeadersTab.tsx`, `RequestTab.tsx`, `ResponseTab.tsx` and `TimingTab.tsx`. Keep `Masked` and `KeyValues`, adding row copy to `KeyValues`. |
| `components/BodyViewer.tsx`, `JsonTree.tsx` | New ([§5.11](#511-body-viewer-new-bodyviewertsx-and-jsontreetsx)). The tree builds React nodes; no HTML strings. |
| `format.ts` | Add `saveNameFor(e, ext)` and `extForMime(mime)`. `unavailableMessage` stays as it is. |
| `lib/clipboard.ts` | `copy(text, label)`: calls `navigator.clipboard.writeText` (already used in `ConnectPanel`), then `showToast`. |

### 10.3 Shared API and main

`apps/desktop/src/shared/api.ts`:

```ts
export interface ExportScope { ids?: string[] }        // omitted = whole session
export interface SaveFileRequest {
  suggestedName: string;                               // e.g. tracethrough-get-products-2026-11-05T11-02-14.har
  content: string;                                     // text only; binary bodies are never captured
  kind: 'har' | 'json' | 'text';
}
// TraceThroughApi changes:
exportSession(format: ExportFormat, scope?: ExportScope): Promise<ExportResult>;
saveFile(req: SaveFileRequest): Promise<ExportResult>;
```

Add `IPC.saveFile = 'tl:save-file'`.

`apps/desktop/src/main/index.ts`:
- `exportSession(format, scope)`: validate that `scope.ids` is an array of strings with at most 10,000 entries. Call `host.exportData(format, scope?.ids)`. **Remove the `dialog.showMessageBox` confirmation**, because the in-app Export dialog now shows the same `exportWarning(masked)` text. Keep `showSaveDialog`. Default file name `tracethrough-<stamp>[-filtered|-selected].<ext>`.
- `saveFile(req)`: validate types and cap `content` at 32 MB. Open `showSaveDialog` with filters from `kind`, write UTF-8, and return the path. Register it with `handle()` so the sender check applies.

`apps/desktop/src/main/session-host.ts`: `exportData(format, ids?)` filters `buffer.all()` by id set before `toHar` / `toSessionExport`.

`apps/desktop/src/preload/index.ts`: expose `saveFile` and pass `scope` through.

### 10.4 Web mode (`apps/desktop/src/web`)

- `server.ts`: the `export` call accepts `ids`.
- `client.ts`: `exportSession(format, scope)` drops its `confirm()`, because the in-app dialog confirms. It keeps the existing download behaviour. `saveFile` downloads through a Blob and an `<a download>` link with the suggested name, and returns `{ saved: true, path: suggestedName }`.

### 10.5 Security checklist for this change

- No new renderer network access. Fonts are bundled.
- Clipboard writes happen only in click and keyboard handlers.
- `saveFile` content comes from data the renderer already holds, which main has already redacted. Main still validates size and type.
- Bodies and the tree are rendered as React text nodes only.
- The canary e2e test ("never renders the planted secret") must still pass with masking on.

---

## 11. Test changes

### 11.1 E2E updates (`apps/desktop/test`)

| Test | Today | Change to |
|---|---|---|
| `app.e2e` filters | `getByRole('group', { name: 'Status' }).getByRole('button', { name: '4xx' })` | `getByRole('combobox', { name: 'Status' }).selectOption('4xx')` |
| `connect.e2e` source filter | `getByRole('group', { name: 'Source' }).getByRole('button', { name: 'Server' })` | `getByRole('combobox', { name: 'Source' }).selectOption('server')` |
| `app.e2e` export | `getByRole('button', { name: 'Export HAR' })` and a stub for `showMessageBox` | Click `Export` › menu item "Export as HAR" › dialog "Save file…". Keep the `showSaveDialog` stub and drop the `showMessageBox` stub. |
| `app.e2e` export notice | `locator('.banner')` contains "Exported to" | `locator('.session-strip')` contains "Exported to" |
| `app.e2e` unmasked | `locator('.banner')` contains "Masking is off" | `locator('.session-strip')` contains "Masking off" |
| `app.e2e` request body | `detail.locator('pre')` contains `"password": "[REDACTED]"` | Click the "Pretty" view first (Tree is now the default), then check `pre` |
| `app.e2e` unmasked request body | `detail.locator('pre')` contains the canary | Same: click "Pretty" first |
| `connect.e2e` linked | `locator('tr', { hasText: 'Server calls' }).locator('li')` | `getByRole('region', { name: 'Server calls' }).getByRole('button')`. Render each Overview section as `<section aria-label="…">`. |
| `connect.e2e` triggered by | `locator('tr', { hasText: 'Triggered by' })` | `getByRole('region', { name: 'Triggered by' })` |
| `connect.e2e` App Connect text | `getByText('App Connect', { exact: true })` | `locator('.session-strip')` contains `/App connected\|App Connect on/` |

These are unchanged and must keep passing: `.c-name`, `.c-status`, `.c-method`, the table rows (`.table .body [role="row"]`, excluding group rows; give group rows `data-kind="group"` and filter them out in the `rows()` helper), `getByRole('status')` for Recording and Stopped, `■ Stop`, `New session`, `Reset`, `Search requests`, `Request details`, the tab names, `tr` rows for `authorization`, `set-cookie`, `Handled request`, `Source` and `Total`, `mark.masked`, `.unavailable`, `.badge.browser` and `.badge.server`.

### 11.2 New tests

- **Core unit:** every function in [§10.1](#101-packagescore).
- **E2E:** tick two rows, Export selected as HAR, and check the file has exactly 2 entries.
- **E2E:** Response Tree, then Find "slow", then the match count is at least 1; click a leaf; Copy path. Read the clipboard through `app.evaluate(({ clipboard }) => clipboard.readText())` and check the path.
- **E2E:** Headers › Cookies lists `sid` as "Set" for `/api/set-cookie`.
- **E2E:** with App Connect, the browser `/api/products` row shows "2 linked" and the two server rows follow it immediately.
- **E2E:** with Group by page on, a group header with the navigation path exists.
- **Performance:** extend the 2k-event filter test so building the row model (nesting and grouping) stays under the existing p95 budget.

---

## 12. Acceptance checklist

The change is done when all of these are true:

- [ ] Every draft-1 element in [§1](#in-scope) is present: filters, Tree/Pretty/Raw, Copy body and its menu, Save, Find with a count, Expand and Collapse all, breadcrumb, Copy value, Copy path, the Overview/Headers/Request/Response/Timing tabs, the strip, and the top-bar actions.
- [ ] Light and dark themes both follow [§4](#4-design-tokens) and pass the contrast checks in [§8](#8-keyboard-and-accessibility).
- [ ] Server calls nest under their trigger only on an exact `traceId` match; unlinked calls say "not linked".
- [ ] Every body state in [§7](#7-states-and-copy) renders its text; nothing shows an empty viewer.
- [ ] Every copy and save action outputs masked values when the session is masked.
- [ ] Export through the dialog works for whole, filtered and selected scopes, in both formats, on desktop and in web mode.
- [ ] Single-request saves work on desktop and web.
- [ ] The full keyboard flow in F14 works without a mouse.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm test:e2e` pass with the updated and new tests in [§11](#11-test-changes).
- [ ] The UI-02 performance test still passes at 2,000 events.
- [ ] `DEVELOPMENT_PLAN.md` §7 is updated: DX-01 (Copy as cURL) ✅, and UI-04 partial (navigation grouping ✅, waterfall ⏭).

---

## 13. Decisions taken

These are defaults so implementation can start; revisit them with pilot feedback.

| # | Question | Decision |
|---|---|---|
| 1 | Chips or dropdowns for filters? | Dropdowns, matching the draft. Core still supports any-of lists if multi-select is wanted later. |
| 2 | Keep the Type column? | No. The Type filter covers it, and Overview shows the type. The space goes to Name. |
| 3 | Default body view | Tree, matching the draft. Pretty and Raw are one click away. |
| 4 | Native or in-app export confirmation | In-app dialog only, so there is one confirmation instead of two. Main still controls the file write. |
| 5 | URL pill dropdown | None until saved sessions exist (Sprint 4). |
| 6 | Server calls in the list | Nested under the trigger by default; Group by page is optional. |
| 7 | Binary bodies | Not captured (`unavailableReason: 'binary'`), so Save body is hidden for them. |
| 8 | Fonts | IBM Plex, bundled. The system stack is the fallback. |
| 9 | Row height | 30px (was 26px), for touch-pad accuracy and checkbox hit areas. |

---

## 14. Where the mockup differs from this spec

The mockup is a design reference built with sample data. Implement the spec where they differ:

- The mockup is **dark only**. The app must support light and dark ([§4.1](#41-colour)).
- The mockup loads Google Fonts. The app must bundle the fonts.
- The mockup's Find highlights in text views only show a count. The app highlights and cycles matches ([§5.11](#511-body-viewer-new-bodyviewertsx-and-jsontreetsx)).
- In the mockup only leaves are selectable in the tree. The app also lets you select object and array nodes.
- Mockup "Save" and "Export" actions only show a toast. The app opens the real save dialog.
- In the mockup the Overview link cards and General table are plain markup. In the app the Overview sections must be `<section aria-label>` regions ([§11.1](#111-e2e-updates-appsdesktoptest)), and General must include the **Source** row.
- The mockup's "Started" times and its "Exports include…" note are static. The app derives them from the session.
- The mockup's tree, menus and dialog have only basic keyboard support. The app must meet [§8](#8-keyboard-and-accessibility) in full.

---

## 15. Implementation notes

Built on 6 Nov 2026. Where the build differs from the text above, this section is the record.

| Area | Built as | Why |
|---|---|---|
| Toast | `aria-live="polite"` div, no `role` | Tests and users locate the Recording indicator by `role="status"`; two status regions made that ambiguous. |
| Search | Transition, not a 120 ms debounce | No artificial delay; keeps the box responsive and removes a timing race in e2e tests. |
| Group headers | Not sticky | Rows are virtualized with transforms; sticky positioning would need a second layer. They still read as headers. |
| Session strip | "Browser only" slot dropped when App Connect is off | It repeated the "Browser traffic only" scope text. |
| Theme | System / Light / Dark menu in the top bar and on Home | Added in review (6 Nov 2026): the app previously only followed the OS. The dark palette is the mockup's. |
| Icons | Link icon in the URL pill, magnifier in the search box | Present in the mockup; missing from the first build. |
| Detail status pill | Capped at 13em with ellipsis | Long status texts ("500 Internal Server Error") were pushing the path out. |
| Size column | 72 px | "600.0 KB*" was truncated at 62 px. |
| Export dialog | Shows `exportWarning()` text only | The unmasked warning already starts with "Masking was off…"; the extra lead-in repeated it. |
| Source column | 134 px | Fits the longest linked label. |
| Link cards | Status, then source badge, then method and URL, then duration | DOM order is status, "GET url", badge, duration so the accessible name starts with "200 GET"; CSS `order` shows the badge second. |
| Find in text views | Highlights every hit and cycles with Enter / Shift+Enter | As specified; the count is computed from the text, not the DOM. |
| Tree keyboard | `role="tree"` with `aria-activedescendant`; arrows, Home, End, Enter, Space | As specified in section 8. |
| Single-request save (web mode) | Browser download via a Blob link | There is no native save dialog in the browser. |
| Export confirmation | In-app dialog only | The native `showMessageBox` confirmation was removed (decision 4). |
| Web `saveFile` | Handled in the client, not an RPC | The server never writes caller-chosen paths. |

New pure modules and where they are tested:

- `packages/core/src/copy.ts` (`toCurl`, `toFetch`, `parseCookies`, `jsonPathToString`, `exchangeAsText`, `headerLines`) and `toHarEntry` in `export.ts`: `packages/core/test/copy.test.ts`.
- `apps/desktop/src/shared/validate.ts` (export format, scope and save-request checks used by main and the web server): `apps/desktop/test/validate.test.ts`.
- `apps/desktop/src/renderer/src/lib/rows.ts` (trace links, nesting, group by page) and the save-name helpers in `format.ts`: `apps/desktop/test/rows.test.ts`.
- Scoped export over the web RPC: `apps/desktop/test/web.test.ts`.

Not done (still as in section 1, out of scope): code generation, insights, compare, replay, a waterfall column, recent sessions.
