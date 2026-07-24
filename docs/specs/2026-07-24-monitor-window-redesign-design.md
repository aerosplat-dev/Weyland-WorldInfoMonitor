# Weyland World Info Monitor window redesign

**Date:** 2026-07-24

## Goal

Replace the extension's floating book icon, detached count badge, hover tooltip,
and right-click configuration tooltip with a mobile-safe Weyland monitor window
opened from SillyTavern's World Info panel.

## Confirmed cause of the current UI bug

The current extension appends three independently positioned elements directly
to `<body>`: the trigger, results panel, and configuration panel. The trigger
uses an absolute bottom-left position and an experimental CSS anchor while the
panels use `position: fixed`. SillyTavern fixes `<body>` and transforms `<html>`,
so those containing blocks are not reliable. The round artifact is the
trigger's count-badge pseudo-element rendering separately from the book glyph.

The redesign removes that entire surface. It does not attempt to adjust the old
coordinates or retain hover-only behavior.

## Entry point

Insert a core-style `Monitor` button in `#WorldInfo`'s title row, immediately
after the `Worlds/Lorebooks` heading with the row's normal compact spacing. Do
not right-align it, because sibling extensions may add controls later in the
same row. The button uses SillyTavern's `menu_button menu_button_icon` classes
so it belongs visually to the panel instead of floating over the application.
On mobile/coarse-pointer layouts, retain the 44px touch target but hide the
visible `Monitor` text and show only the icon.

Injection must be idempotent and tolerate the panel not being available at the
extension's first synchronous turn.

## Window

Use Weyland-Registrar's componentized window as the functional reference and
Weyland-Router/Registrar as the visual reference:

- scoped `wim-` identifiers and CSS variables;
- JetBrains Mono, near-black aubergine background, crimson `#b4263a` accents,
  rose text accents, compact typography, dark titlebar, and crimson-edged rows;
- a portal mounted as a sibling of `<body>`;
- an absolute, viewport-sized portal and absolute child window (no
  `position: fixed`);
- desktop: movable by the titlebar, natively resizable, viewport-clamped, and
  non-modal so the rest of SillyTavern remains usable;
- mobile/coarse pointer: `100dvw` by `100dvh`, no drag or resize, no rounded
  outer frame, safe-area-aware titlebar, and touch-sized Back/Close controls;
- explicit Close button and Escape-to-close on desktop;
- focus moves into the window on open and returns to the World Info Monitor
  button on close.

The window is a dialog-like tool but intentionally has no click-blocking
backdrop and no outside-click close.

## Views

### List

The list header shows:

- active entry count;
- refresh state (`Scanning…`, last generation captured, or no captured
  generation yet);
- a two-mode sort control:
  - **Lorebooks**: entries grouped by their source `world`, with lorebooks and
    entries alphabetized for predictable browsing;
  - **Prompt order**: a flat, numbered list ordered by the active Chat
    Completion prompt collection, then by World Info insertion anchor/depth and
    entry order.

Every row is a real button and shows the entry title, source lorebook,
activation strategy, insertion label, and sticky rounds when available.

Empty generations render a first-class `No World Info entries activated`
state. Switching chats clears the prior chat's captured results.

### Detail

Clicking or keyboard-activating a row opens a detail view in the same window.
The titlebar Back button returns to the list on desktop and mobile. The detail
shows:

- entry title and source lorebook;
- activation strategy, insertion position/depth, order, keys, and sticky
  rounds where available;
- **Final prompt content** in a selectable, pre-wrapped text block.

Core has already applied macro substitution before
`WORLD_INFO_ACTIVATED`. The monitor additionally applies the same
`getRegexedString(..., WORLD_INFO, {isPrompt:true, depth})` pass used by
`checkWorldInfo`, so detail content matches the per-entry text inserted by the
World Info pipeline. The OpenAI `wi_format` wrapper is not shown because it
wraps an entire combined position bucket rather than an individual entry.
Entries reduced to empty text by prompt regex are retained in the activated
list and explicitly marked as omitted after prompt filtering.

If entries refresh while a detail is open, the matching entry is re-resolved
by `world + uid`; if it no longer exists, return to the list.

## Ordering

SillyTavern's core prompt construction:

1. macro-substitutes activated entry content;
2. sorts each World Info bucket by ascending entry `order` in its final joined
   text (core implements this by sorting descending, then unshifting), except
   Example Message Top, whose second unshift restores descending order;
3. places Before/After Character and Example Message buckets at their live
   Prompt Manager markers;
4. places Author's Note World Info before main, after main, or in chat according
   to the captured Author's Note position; and
5. orders in-chat Author's Note and At Depth entries by depth and role.

Prompt-order mode obtains the live marker sequence from
`promptManager.getPromptCollection(lastGenerationType)`. Before/After Character
map to `worldInfoBefore`/`worldInfoAfter`, Example Message Top/Bottom map around
`dialogueExamples`, At Depth maps to `chatHistory`, and Author's Note maps
around `main` or into `chatHistory` using the position/depth/role snapshotted
for that generation. Structural fallback mirrors core's bucket unshifts,
equal-order reversals, role order, and the Example Message Top exception.
Stable fallbacks cover a disabled or missing marker and non-Chat-Completion
APIs.

For Chat Completion, `CHAT_COMPLETION_PROMPT_READY` provides the flattened final
`chat` array after Prompt Manager assembly and optional system-message
squashing. The monitor searches this read-only payload for each entry's
regex-processed content and uses the real message index plus substring offset
as the primary ordering rank. The structural marker/depth tuple remains the
fallback for duplicate content and Example Message transforms that prevent an
exact substring match. Exact and structural ranks are never mixed within one
list.

This mode orders the activated World Info entries relative to one another; it
does not attempt to reproduce or display non-World-Info prompt material.

## Refresh lifecycle

Keep `WORLD_INFO_ACTIVATED` as the authoritative payload. Remove both global
`console.log`/`console.debug` monkey-patches.

- `GENERATION_STARTED`: when `dryRun !== true` and the generation is a real
  roleplay response (not quiet/impersonate), mark a new capture as scanning.
- `WORLD_INFO_ACTIVATED`: clone the payload, enrich it without mutating core
  objects, transform final-prompt content, and render it.
- `CHAT_COMPLETION_PROMPT_READY`: ignore dry runs; capture exact final prompt
  occurrence ranks from its read-only `chat` payload.
- `GENERATE_AFTER_DATA`: finalize the pending capture. If no activation event
  arrived, commit an empty list. This is the reliable post-assembly boundary.
- `GENERATION_ENDED` or `GENERATION_STOPPED`: clean up a still-pending visible
  scanning state only; they are not the primary zero-entry detector.
- `CHAT_CHANGED`: clear captured entries so another chat's activation state is
  never displayed as current.

Dry-run prompt estimates never start or clear a capture.

The `/wi-triggered` slash command remains available and returns the latest
cloned activated entries for compatibility.

Runtime generation scopes gate every activation, prompt-ready, after-data, and
finish event. On Chat Completion, the prompt-ready `chat` array is correlated
by object identity with `generate_data.prompt`; other APIs use the current
assembly scope. A one-microtask finish grace period deduplicates SillyTavern's
paired `GENERATION_ENDED`/`GENERATION_STOPPED` stop sequence.

## Safety invariants

- Never mutate `context.chat` or the imported live `chat` array.
- Never mutate `chat_metadata`.
- Never mutate entry objects received from core; clone before enrichment.
- No tracking `Set`/lock is needed. Async sticky enrichment uses a monotonically
  increasing capture id so a slow older capture cannot replace a newer one.
- Every `data-view` value (`list`, `detail`) has explicit CSS visibility rules.
- All global listeners and drag/reclamp listeners have named cleanup paths.

## Testing

Pure `node:test` coverage:

- settings migration/backfill;
- entry cloning and display-name normalization;
- lorebook grouping without input mutation;
- dynamic prompt ordering for every insertion position and depth;
- real-vs-dry-run generation lifecycle, `GENERATE_AFTER_DATA` empty-generation
  capture, final-prompt occurrence ranking, stale async capture rejection, and
  chat-change clearing;
- drag clamping and mobile layout detection.

Browser verification:

- Monitor button placement in the real World Info panel;
- no old floating icon, badge artifact, tooltip, or config panel;
- desktop open/close/Escape, drag, resize, clamp, both list modes, row detail,
  Back, refresh during open detail, and focus return;
- mobile viewport: true full-screen layout, usable Back/Close targets, list
  scrolling, tap-to-detail, tap Back, orientation/viewport changes, and no
  sticky hover tooltip.
