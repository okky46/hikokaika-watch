type TrackingLayout = 'list' | 'cards';
const storageKey = 'tracking-list-layout';
const isLayout = (value: string | null | undefined): value is TrackingLayout =>
  value === 'list' || value === 'cards';

export function setupTrackingView(doc: Document = document) {
  const win = doc.defaultView;
  const results = doc.getElementById('tracking-results');
  const controls = doc.querySelector<HTMLElement>('[data-tracking-view-controls]');
  if (!win || !results || !controls) return;
  const buttons = [...controls.querySelectorAll<HTMLButtonElement>('[data-tracking-layout]')];
  let saved: string | null = null;
  try { saved = win.localStorage.getItem(storageKey); } catch {}
  const initial = isLayout(saved) ? saved : win.matchMedia('(max-width: 760px)').matches ? 'cards' : 'list';
  const show = (layout: TrackingLayout) => {
    results.dataset.layout = layout;
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.trackingLayout === layout));
    }
  };
  show(initial);
  controls.hidden = false;
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const layout = button.dataset.trackingLayout;
      if (!isLayout(layout)) return;
      show(layout);
      try { win.localStorage.setItem(storageKey, layout); } catch {}
    });
  }
}
