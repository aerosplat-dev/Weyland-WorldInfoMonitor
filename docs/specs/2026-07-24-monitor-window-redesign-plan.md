# Weyland World Info Monitor window redesign implementation plan

**Design:** `docs/specs/2026-07-24-monitor-window-redesign-design.md`

## Task 1: Pure data and lifecycle modules

Create:

- `lib/settings.js` for the scoped settings key, defaults, migration from the
  old `group/order/mes` values, and save-ready sort mode;
- `lib/entries.js` for cloning/normalization, labels, grouping, and stable
  prompt-order sorting;
- `lib/captureState.js` for generation/chat lifecycle state with monotonically
  increasing capture ids;
- `package.json` (`private`, `type: module`);
- focused `test/*.test.js` coverage.

Run `node --test`.

## Task 2: Window and toolbar UI

Create:

- `template.html` with list/detail views and accessible titlebar controls;
- `lib/ui/toolbarButton.js` for idempotent insertion immediately beside the
  World Info title, with an icon-only mobile presentation;
- `lib/ui/dragResize.js` for tested desktop clamp/drag/reclamp behavior;
- `lib/ui/monitorWindow.js` for sibling-portal construction, event wiring,
  rendering, view switching, focus management, and responsive drag lifecycle;
- a fully rewritten `style.css` scoped to `wim-`.

Delete the obsolete `style.less` rather than maintaining a second source of
truth.

Every new `data-view` receives explicit desktop and mobile CSS.

## Task 3: Runtime orchestration

Rewrite `index.js` to:

- subscribe to generation, activation, final-prompt-ready, post-assembly,
  stop/end, and chat-change events;
- clone and asynchronously enrich activation payloads without stale-capture
  races;
- apply the core World Info regex transform for detail content;
- obtain the active Prompt Manager marker order and exact final-chat occurrence
  ranks for the prompt-order view;
- open the window through the World Info Monitor button;
- preserve `/wi-triggered`;
- remove body-mounted floating UI and global console monkey-patches.

Update `manifest.json` and `README.md` for the Weyland redesign.

Run `node --test` and syntax/import checks.

## Task 4: Independent task review and fixes

Dispatch a fresh reviewer for the implementation. It must inspect the actual
diff and explicitly verify:

- no `context.chat`/live `chat` mutation;
- no `chat_metadata` mutation;
- cloned event entries;
- stale async capture protection;
- all `data-view` CSS selectors;
- sibling portal and absence of `position: fixed`;
- teardown of drag/reclamp/global listeners;
- exact prompt-order comparator behavior.

Fix findings and rerun tests.

## Task 5: Live desktop/mobile verification

Use Playwright against the real running Weyland Tavern instance over its LAN
address and HTTP Basic Auth. Exercise the desktop and mobile checks in the
design without mutating stored World Info or chats. Use the currently captured
activation list or synthetic DOM-only rendering hooks where a generation would
otherwise change real data.

Fix findings and rerun tests.

## Task 6: Fresh whole-extension review

Dispatch a new reviewer that has not implemented or fixed the code. It must
read the entire extension and test suite, not only the diff, and distrust prior
reports. Fix all Critical/High/Medium correctness findings, rerun tests and
targeted Playwright checks, then commit only inside the extension's nested
repository.
