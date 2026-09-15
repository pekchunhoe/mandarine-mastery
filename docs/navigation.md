# One-step page navigation

The shared `← 返回` button calls native `history.back()`. The activity menu
continues to link directly to `#activities`.

## Router integration

- `js/navigation.js` marks browser entries with a document identifier, entry ID,
  and depth using `replaceState`. Browser history owns the stack and its forward
  branch. There is no independent route stack or fixed Back destination.
- `js/app.js` consumes native `popstate` and `hashchange` through the same entry
  check, so one traversal renders once. Same-route links and ordinary rerenders
  add no entries. A pending traversal disables Back until the event arrives.
- The activity toolbar, shared page headings, results, error screens, and
  vocabulary manager use the same semantic button. Existing focus styling is
  retained and the button has a minimum 44px touch height.
- Full-page helpers participate in browser history. Existing return context
  describes the helper visit and is cleared when leaving it. Dialogs and
  floating vocabulary lookup never change page history.

## Student work

Activity screens are detached and retained by browser entry within the current
document, including their DOM, event handlers, answers, hint counters, selected
options, and result screens. Session timers pause while away. Writing renderers
flush their existing autosaves before suspension and page unload. Returning to
an entry reattaches the original activity, without replaying completion or XP.

Normal navigation to an activity uses the current practice settings; Back and
Forward restore the earlier attempt. Explicit learning-state reset or import
invalidates retained screens and in-memory snapshots.

## Refresh and scope

Reload and direct URL entry start a new safe boundary with Back disabled. Native
browser navigation still works, but custom Back never assumes that an earlier
external/document entry belongs to the current app session. Existing saved
drafts and activity snapshots recover after reload; transient quiz choices and
live screen state are retained only within the document. Persistent recovery
requires available browser storage. Scroll is restored per browser entry.

## Verification

Run the app with `npm run dev`, then:

```sh
npm test
npm run test:navigation-browser
npm run test:browser
npm run test:extended
npm run test:vocabulary-browser
npm run test:vocabulary-dialog
npm run build
```

The navigation suite covers direct entry, multiple Back steps, native Forward,
branch replacement, duplicate events, menu navigation, helper returns, guided
essay and Story Chain preservation, quiz answers, results, reset, storage denial,
scroll, rapid clicks, keyboard activation, and responsive activity toolbars.
Phone portrait widths: 320, 360, 375, 390, 412, and 430px. It also covers phone
landscape, tablet portrait/landscape, and desktop sizes using Chromium/Edge.
