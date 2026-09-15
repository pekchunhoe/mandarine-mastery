import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNavigation } from '../js/navigation.js';

// Model native history, including its asynchronous traversal and forward branch.
function fixture(route = '#home') {
  const entries = [{ route, state: null }];
  let index = 0, queued = null, uuid = 0;
  const host = {
    location: { hash: route }, scrollY: 0,
    crypto: { randomUUID: () => `document-${++uuid}` },
    history: {
      get state() { return entries[index].state; },
      replaceState(state) { entries[index].state = state; },
      back() { queued = -1; },
    },
  };
  let nav = createNavigation(host);
  const visit = (route) => {
    if (route !== host.location.hash) {
      entries.splice(index + 1);
      entries.push({ route, state: null });
      index++;
      host.location.hash = route;
    }
    return nav.sync();
  };
  const traverse = (delta) => {
    index = Math.max(0, Math.min(entries.length - 1, index + delta));
    host.location.hash = entries[index].route;
    return nav.sync();
  };
  return {
    host, entries, visit, traverse,
    get nav() { return nav; },
    back() { assert.ok(nav.back()); traverse(queued); queued = null; },
    reload() { nav = createNavigation(host); },
  };
}

test('A → B → Back → A and safe root', () => {
  const f = fixture();
  assert.equal(f.nav.back(), false);
  f.visit('#activities');
  f.back();
  assert.equal(f.host.location.hash, '#home');
  assert.equal(f.nav.canGoBack, false);
});

test('five pages unwind one at a time without loops or skipped screens', () => {
  const f = fixture();
  const routes = ['#home', '#activities', '#activity/guidedEssay', '#activity/story', '#library'];
  routes.slice(1).forEach(f.visit);
  for (const route of routes.slice(0, -1).reverse()) {
    f.back();
    assert.equal(f.host.location.hash, route);
    assert.equal(f.nav.sync(), false); // companion hashchange/popstate event
  }
  assert.equal(f.nav.canGoBack, false);
});

test('forward navigation after Back discards the old branch', () => {
  const f = fixture();
  f.visit('#activities'); f.visit('#library'); f.back(); f.visit('#stats'); f.back();
  assert.equal(f.host.location.hash, '#activities');
  f.traverse(1);
  assert.equal(f.host.location.hash, '#stats');
  assert.deepEqual(f.entries.map((entry) => entry.route), ['#home', '#activities', '#stats']);
});

test('same route, rerenders and duplicate browser events add no history', () => {
  const f = fixture();
  f.visit('#activities');
  for (let i = 0; i < 10; i++) assert.equal(f.visit('#activities'), false);
  assert.equal(f.entries.length, 2);
  f.back();
  assert.equal(f.nav.canGoBack, false);
});

test('native Back and Forward share the custom Back history', () => {
  const f = fixture();
  f.visit('#activities'); f.visit('#activity/essay?theme=2');
  f.traverse(-1); f.traverse(1); f.back(); f.back();
  assert.equal(f.host.location.hash, '#home');
});

test('direct hash and refresh create safe boundaries without storage', () => {
  const f = fixture('#activity/essay');
  assert.equal(f.nav.canGoBack, false);
  f.visit('#library'); f.reload();
  assert.equal(f.nav.back(), false);
  f.traverse(-1); // browser may visit an earlier document marker
  assert.equal(f.nav.canGoBack, false);
  f.visit('#stats'); f.back();
  assert.equal(f.host.location.hash, '#activity/essay');
  assert.equal(f.nav.back(), false);
});

test('rapid custom Back requests enqueue only one browser traversal', () => {
  const f = fixture();
  f.visit('#activities'); f.visit('#library');
  assert.equal(f.nav.back(), true);
  for (let i = 0; i < 10; i++) assert.equal(f.nav.back(), false);
  f.traverse(-1);
  assert.equal(f.host.location.hash, '#activities');
  assert.equal(f.nav.canGoBack, true);
});

test('scroll is kept per browser entry, including repeated visits to a route', () => {
  const f = fixture();
  f.host.scrollY = 420; f.visit('#library');
  f.host.scrollY = 900; f.visit('#home');
  f.host.scrollY = 0; f.back();
  assert.equal(f.nav.scrollPosition, 900);
  f.host.scrollY = 900; f.back();
  assert.equal(f.nav.scrollPosition, 420);
});
