// Page-turn transitions between sheets on the stage. dir > 0: current page turns away (forward);
// dir < 0: previous page turns back over the current one; dir === 0: settle in place.
let inflight = Promise.resolve();

const done = (el) => new Promise((resolve) => {
  const t = setTimeout(resolve, 1000);
  el.addEventListener('animationend', () => { clearTimeout(t); resolve(); }, { once: true });
});

export function turn(stage, oldSheet, newSheet, dir) {
  const run = async () => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    stage.append(newSheet);
    if (!oldSheet || !dir || reduce) {
      oldSheet?.remove();
      newSheet.classList.add('settle');
      setTimeout(() => newSheet.classList.remove('settle'), 500);
      return;
    }
    if (dir > 0) {
      oldSheet.classList.add('top', 'flip-out');
      await done(oldSheet);
      oldSheet.remove();
    } else {
      newSheet.classList.add('top', 'flip-in');
      await done(newSheet);
      newSheet.classList.remove('top', 'flip-in');
      oldSheet.remove();
    }
  };
  inflight = inflight.then(run, run);
  return inflight;
}

/** Horizontal swipe (touch / pen) on an element → callback(+1 | -1). */
export function onSwipe(el, cb) {
  let start = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    start = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  el.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - start.t < 800) cb(dx < 0 ? 1 : -1);
    start = null;
  });
}
