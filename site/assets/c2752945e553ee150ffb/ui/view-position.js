/** Scroll continuity across replacement renders. No focus, business state, or storage. */
export const clampScroll = (value, maximum) => Math.max(0, Math.min(Math.max(0, Number.isFinite(maximum) ? maximum : 0), Number.isFinite(value) ? value : 0));

/** Prefer a visible stable row, including a partially visible first row, then other anchors. */
export function selectScrollAnchor(candidates, { top = 0, bottom = Infinity } = {}) {
  return candidates.filter(item => Number.isFinite(item.top) && Number.isFinite(item.bottom) && item.bottom > top && item.top < bottom)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.top - b.top)[0] || null;
}

const anchorTypes = [
  { selector: 'tr[data-open-photo]', attributes: ['data-open-photo'], priority: 0 },
  { selector: '[data-record-id][data-report-key]', attributes: ['data-record-id', 'data-report-key'], closest: 'tr', priority: 0 },
  { selector: '[data-record-id][data-capture]', attributes: ['data-record-id', 'data-capture'], closest: '.slot-row', priority: 0 },
  { selector: '[data-target]', attributes: ['data-target'], priority: 1 },
  { selector: '[data-go-record]', attributes: ['data-go-record'], closest: 'li', priority: 1 },
  { selector: '[data-go-report]', attributes: ['data-go-report'], closest: 'li', priority: 1 },
  { selector: '[data-inline-target]', attributes: ['data-inline-target'], priority: 1 },
  { selector: '[data-disclosure]', attributes: ['data-disclosure'], priority: 2 },
  { selector: '[id]', attributes: ['id'], priority: 3 }
];
const containerTypes = [
  { kind: 'photo', selector: '.photo-table-wrap' },
  { kind: 'report', selector: '.report-table-wrap' },
  { kind: 'output-records', selector: '.output-record-list' },
  { kind: 'output-issues', selector: '.output-issues ul' }
];
const containerSelector = containerTypes.map(type => type.selector).join(',');
const focusedTypes = [
  { selector: '[data-organize-filter]', attributes: ['data-organize-filter'] },
  { selector: '[data-output-record]', attributes: ['data-output-record'] },
  { selector: '[data-record-id][data-report-key]', attributes: ['data-record-id', 'data-report-key'] },
  { selector: '[data-name-draft]', attributes: ['data-name-draft'] },
  { selector: '[data-select-photo]', attributes: ['data-select-photo'] },
  { selector: '[id]', attributes: ['id'] }
];

export function createViewPosition({ root = globalThis.document } = {}) {
  if (!root?.querySelectorAll) throw new TypeError('表示位置の親要素を確認してください。');
  const doc = root.nodeType === 9 ? root : root.ownerDocument, win = doc.defaultView;
  if (!win) throw new TypeError('表示位置のdocumentを確認してください。');
  let revision = 0, interaction = 0, frame = null, destroyed = false;
  const listeners = [];
  const add = (type, fn, options) => { doc.addEventListener(type, fn, options); listeners.push(() => doc.removeEventListener(type, fn, options)); };
  const viewportHeight = () => win.innerHeight || doc.documentElement.clientHeight;
  const allContainers = () => [...root.querySelectorAll(containerSelector)];
  const keyedContainers = () => {
    const counts = new Map();
    return allContainers().map(element => {
      const { kind } = containerTypes.find(type => element.matches(type.selector));
      const index = counts.get(kind) || 0; counts.set(kind, index + 1);
      return { element, key: `${kind}:${index}` };
    });
  };
  const excluded = element => Boolean(element.closest('dialog,.ui-floating-panel,[hidden]')) || !element.getClientRects().length;

  function captureFocusedAnchor() {
    const element = doc.activeElement;
    if (!element || !(['input', 'select', 'textarea', 'button'].includes(element.localName) || element.isContentEditable)
        || !(root.nodeType === 9 ? element.ownerDocument === doc && element.isConnected !== false : root.contains(element)) || excluded(element)) return null;
    const bounds = element.getBoundingClientRect(), viewportTop = win.visualViewport?.offsetTop || 0;
    const viewportLeft = win.visualViewport?.offsetLeft || 0, viewportBottom = viewportTop + (win.visualViewport?.height || viewportHeight());
    const viewportRight = viewportLeft + (win.visualViewport?.width || win.innerWidth || doc.documentElement.clientWidth);
    if (bounds.bottom <= viewportTop || bounds.top >= viewportBottom || bounds.right <= viewportLeft || bounds.left >= viewportRight) return null;
    const wrap = element.closest(containerSelector), clip = wrap?.getBoundingClientRect();
    if (clip && (bounds.bottom <= clip.top || bounds.top >= clip.bottom || bounds.right <= clip.left || bounds.left >= clip.right)) return null;
    const type = focusedTypes.find(candidate => candidate.attributes.every(key => element.getAttribute(key) !== null));
    let descriptor;
    if (type) descriptor = { selector: type.selector, attributes: type.attributes.map(key => [key, element.getAttribute(key)]), closest: null };
    else {
      const form = element.closest('form'), name = element.getAttribute('name');
      if (!form?.id || name === null) return null;
      descriptor = { selector: '[name]', attributes: [['name', name]], closest: null, formId: form.id };
    }
    return { descriptor, top: bounds.top };
  }
  function captureAnchor(scope, viewport) {
    const candidates = [], seen = new Set();
    for (const type of anchorTypes) {
      for (const trigger of scope.querySelectorAll(type.selector)) {
        const element = type.closest ? trigger.closest(type.closest) : trigger;
        if (!element || seen.has(element) || excluded(element)) continue;
        seen.add(element);
        const bounds = element.getBoundingClientRect(), wrap = element.closest(containerSelector);
        const clip = wrap?.getBoundingClientRect();
        if (clip && (bounds.bottom <= clip.top || bounds.top >= clip.bottom)) continue;
        candidates.push({ descriptor: { selector: type.selector, attributes: type.attributes.map(key => [key, trigger.getAttribute(key)]), closest: type.closest || null }, priority: type.priority, top: bounds.top, bottom: bounds.bottom });
      }
    }
    const chosen = selectScrollAnchor(candidates, viewport);
    return chosen ? { descriptor: chosen.descriptor, top: chosen.top - viewport.top } : null;
  }
  function findAnchor(scope, anchor) {
    if (!anchor?.descriptor) return null;
    const descriptor = anchor.descriptor;
    const trigger = [...scope.querySelectorAll(descriptor.selector)].find(element => descriptor.attributes.every(([key, value]) => element.getAttribute(key) === value) && (!descriptor.formId || element.closest('form')?.id === descriptor.formId));
    const element = descriptor.closest ? trigger?.closest(descriptor.closest) : trigger;
    return element && !excluded(element) ? element : null;
  }
  function windowMaximum() {
    const html = doc.documentElement, body = doc.body;
    return { x: Math.max(0, Math.max(html.scrollWidth || 0, body?.scrollWidth || 0) - (html.clientWidth || win.innerWidth)), y: Math.max(0, Math.max(html.scrollHeight || 0, body?.scrollHeight || 0) - (win.innerHeight || html.clientHeight)) };
  }
  function capture(contextKey) {
    if (destroyed) return null;
    revision++; if (frame !== null) { win.cancelAnimationFrame(frame); frame = null; }
    const containers = keyedContainers().map(({ element, key }) => {
      const bounds = element.getBoundingClientRect();
      return { key, x: element.scrollLeft, y: element.scrollTop, anchor: captureAnchor(element, { top: bounds.top, bottom: bounds.bottom }) };
    });
    const focused = captureFocusedAnchor(), row = captureAnchor(root, { top: 0, bottom: viewportHeight() });
    return { contextKey, window: { x: win.scrollX, y: win.scrollY, anchor: focused || row, fallbackAnchor: focused ? row : null }, containers };
  }
  function apply(snapshot) {
    let anchored = false;
    const available = keyedContainers();
    for (const saved of snapshot.containers || []) {
      const element = available.find(item => item.key === saved.key)?.element;
      if (!element) continue;
      element.scrollLeft = clampScroll(saved.x, element.scrollWidth - element.clientWidth);
      element.scrollTop = clampScroll(saved.y, element.scrollHeight - element.clientHeight);
      const anchor = findAnchor(element, saved.anchor);
      if (anchor) {
        const delta = anchor.getBoundingClientRect().top - element.getBoundingClientRect().top - saved.anchor.top;
        element.scrollTop = clampScroll(element.scrollTop + delta, element.scrollHeight - element.clientHeight); anchored = true;
      }
    }
    const maximum = windowMaximum();
    let savedAnchor = snapshot.window?.anchor, anchor = findAnchor(root, savedAnchor);
    if (!anchor) { savedAnchor = snapshot.window?.fallbackAnchor; anchor = findAnchor(root, savedAnchor); }
    let y = snapshot.window?.y || 0;
    if (anchor) { y = win.scrollY + anchor.getBoundingClientRect().top - savedAnchor.top; anchored = true; }
    win.scrollTo(clampScroll(snapshot.window?.x, maximum.x), clampScroll(y, maximum.y));
    return anchored;
  }
  function positions() { return [win.scrollX, win.scrollY, ...keyedContainers().flatMap(({ element }) => [element.scrollLeft, element.scrollTop])]; }
  function restore(snapshot, contextKey) {
    revision++; if (frame !== null) { win.cancelAnimationFrame(frame); frame = null; }
    if (destroyed || !snapshot || snapshot.contextKey !== contextKey || !snapshot.window) return false;
    const anchored = apply(snapshot), token = revision, userToken = interaction, expected = positions();
    if (anchored && typeof win.requestAnimationFrame === 'function') {
      frame = win.requestAnimationFrame(() => {
        frame = null;
        const current = positions();
        if (!destroyed && token === revision && userToken === interaction && current.length === expected.length && current.every((value, index) => Math.abs(value - expected[index]) < 1)) apply(snapshot);
      });
    }
    return true;
  }
  for (const type of ['pointerdown', 'wheel', 'touchstart', 'keydown']) add(type, () => { interaction++; }, { capture: true, passive: type !== 'keydown' });
  return {
    capture, restore,
    destroy() { if (destroyed) return; destroyed = true; revision++; if (frame !== null) win.cancelAnimationFrame(frame); for (const remove of listeners) remove(); }
  };
}
