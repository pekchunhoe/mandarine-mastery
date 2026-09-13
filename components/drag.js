// One pointer implementation for touch, pen and mouse; every drag also has a
// button/tap route. Drag targets are resolved from rendered DOM only.
export function enableDrag(root, onDrop, signal) {
  let active = null,
    suppress = false;
  root.addEventListener(
    'pointerdown',
    (event) => {
      const tile = event.target.closest('[data-drag]');
      if (!tile || event.button !== 0) return;
      active = {
        tile,
        id: tile.dataset.drag,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        pointer: event.pointerId,
      };
    },
    { signal },
  );
  root.addEventListener(
    'pointermove',
    (event) => {
      if (!active) return;
      if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) > 8) {
        active.moved = true;
        active.tile.setPointerCapture(event.pointerId);
        active.tile.classList.add('dragging');
      }
      if (!active.moved) return;
      event.preventDefault();
      root.querySelectorAll('.drop-active').forEach((x) => x.classList.remove('drop-active'));
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-drop]');
      if (target && root.contains(target)) target.classList.add('drop-active');
    },
    { signal, passive: false },
  );
  const finish = (event) => {
    if (!active) return;
    const old = active;
    active = null;
    old.tile.classList.remove('dragging');
    root.querySelectorAll('.drop-active').forEach((x) => x.classList.remove('drop-active'));
    if (old.moved) {
      suppress = true;
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest('[data-drop]');
      if (event.type === 'pointerup' && target && root.contains(target))
        onDrop(old.id, target.dataset.drop);
      setTimeout(() => (suppress = false), 50);
    }
  };
  root.addEventListener('pointerup', finish, { signal });
  root.addEventListener('pointercancel', finish, { signal });
  root.addEventListener(
    'click',
    (e) => {
      if (suppress) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    { signal, capture: true },
  );
}
