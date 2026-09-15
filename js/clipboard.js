// Shared plain-text copying, originally used by guided essay writing.
export async function copyText(
  text,
  { navigatorRef = globalThis.navigator, documentRef = globalThis.document } = {},
) {
  if (!text) return false;
  try {
    if (navigatorRef?.clipboard?.writeText) {
      await navigatorRef.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Some mobile browsers expose Clipboard API but deny it in this context.
  }
  if (!documentRef?.createElement || !documentRef.body?.appendChild || !documentRef.execCommand)
    return false;
  const focused = documentRef.activeElement;
  let field;
  try {
    field = documentRef.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    Object.assign(field.style, {
      position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none',
    });
    documentRef.body.appendChild(field);
    field.focus({ preventScroll: true });
    field.select();
    return documentRef.execCommand('copy');
  } catch {
    return false;
  } finally {
    field?.remove();
    focused?.focus?.({ preventScroll: true });
  }
}
