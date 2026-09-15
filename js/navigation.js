// The browser owns the history stack. These markers only identify entries that
// this document can safely traverse; they never form a second route stack.
const KEY = 'mandarineNavigation';
export const currentRoute = (host = window) => host.location.hash || '#home';

export function createNavigation(host = window) {
  const session = host.crypto.randomUUID();
  let sequence = 0;
  let pending = false;
  const scroll = new Map();
  const mark = (depth) => ({ session, id: ++sequence, depth, route: currentRoute(host) });
  let current = mark(0);
  const replace = () => host.history.replaceState({ ...host.history.state, [KEY]: current }, '');
  // Reload/direct entry is a new safe boundary. Saved activity work is separate.
  replace();
  host.history.scrollRestoration = 'manual';
  return {
    get entryId() { return current.id; },
    get canGoBack() { return current.depth > 0 && !pending; },
    get scrollPosition() { return scroll.get(current.id); },
    captureScroll() { scroll.set(current.id, host.scrollY || 0); },
    sync() {
      const entry = host.history.state?.[KEY];
      const route = currentRoute(host);
      if (entry?.session === session && entry.id === current.id && route === current.route) return false;
      scroll.set(current.id, host.scrollY || 0);
      if (entry?.session === session && entry.route === route) current = entry;
      else {
        // An older document's entry is another boundary, never a fake predecessor.
        current = mark(entry ? 0 : current.depth + 1);
        replace();
      }
      pending = false;
      return true;
    },
    back() {
      if (!this.canGoBack) return false;
      pending = true;
      host.history.back();
      return true;
    },
  };
}

let navigation;
export function initNavigation() { return navigation ||= createNavigation(); }
export function backButton() {
  return `<button type="button" class="btn quiet navigation-back" data-navigation-back ${navigation?.canGoBack ? '' : 'disabled'}>← 返回</button>`;
}
export function updateBackButtons(root = document) {
  root.querySelectorAll('[data-navigation-back]').forEach((button) => {
    button.disabled = !navigation?.canGoBack;
  });
}
