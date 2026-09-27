const BUILD_VERSION = '__BUILD_VERSION__';
const VERSION_URL = new URL('../version.json', import.meta.url);
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const isProductionBuild = () => BUILD_VERSION !== '__BUILD_VERSION__';

export function watchForDeploymentUpdate(onUpdate) {
  if (!isProductionBuild() || typeof fetch !== 'function') return { check: () => {}, stop: () => {} };

  let stopped = false;
  let announced = false;
  const check = async () => {
    if (stopped || announced || navigator.onLine === false) return;
    try {
      const response = await fetch(VERSION_URL, { cache: 'no-store' });
      if (!response.ok) return;
      const { version } = await response.json();
      if (typeof version === 'string' && version && version !== BUILD_VERSION) {
        announced = true;
        onUpdate();
      }
    } catch {
      // Offline use keeps the cached app available; check again when connectivity returns.
    }
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') check();
  };
  const interval = setInterval(check, CHECK_INTERVAL_MS);
  window.addEventListener('focus', check);
  window.addEventListener('online', check);
  window.addEventListener('pageshow', onVisible);
  document.addEventListener('visibilitychange', onVisible);
  navigator.serviceWorker?.addEventListener('controllerchange', check);
  check();

  return {
    check,
    stop() {
      stopped = true;
      clearInterval(interval);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      window.removeEventListener('pageshow', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('controllerchange', check);
    },
  };
}
