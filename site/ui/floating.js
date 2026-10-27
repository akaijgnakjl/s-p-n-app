/** Native disclosures with viewport-bounded floating bodies. No application state or storage. */
export const FLOATING_SIZES = Object.freeze({
  menu: Object.freeze({ width: 240, height: 360 }),
  panel: Object.freeze({ width: 384, height: 560 }),
  wide: Object.freeze({ width: 640, height: 640 }),
  compact: Object.freeze({ width: 320, height: 480 }),
  target: Object.freeze({ width: 384, height: 640 })
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback) => Number.isFinite(value) ? value : fallback;

/** Rectangles use layout-viewport CSS pixels, including visualViewport offsets. */
export function computeFloatingPosition(anchor, panel, viewport, { gap = 8, margin = 12, align = 'start', maxWidth = Infinity, maxHeight = Infinity } = {}) {
  if (![anchor?.left, anchor?.right, anchor?.top, anchor?.bottom, panel?.width, panel?.height, viewport?.width, viewport?.height].every(Number.isFinite)
      || viewport.width <= 0 || viewport.height <= 0 || panel.width < 0 || panel.height < 0) throw new TypeError('浮動パネルの位置・寸法を確認してください。');
  const inset = Math.min(Math.max(0, number(margin, 12)), viewport.width / 4, viewport.height / 4);
  const leftEdge = number(viewport.left, 0) + inset, topEdge = number(viewport.top, 0) + inset;
  const rightEdge = number(viewport.left, 0) + viewport.width - inset, bottomEdge = number(viewport.top, 0) + viewport.height - inset;
  const width = Math.max(1, Math.min(panel.width, maxWidth, rightEdge - leftEdge));
  const desiredHeight = Math.max(1, Math.min(panel.height, maxHeight, bottomEdge - topEdge));
  const spacing = Math.max(0, number(gap, 8));
  const below = Math.max(0, bottomEdge - anchor.bottom - spacing), above = Math.max(0, anchor.top - spacing - topEdge);
  const placement = desiredHeight <= below ? 'below' : desiredHeight <= above ? 'above' : below >= above ? 'below' : 'above';
  // A keyboard can leave almost no room on either side. Still stay within the visible viewport.
  const available = (placement === 'below' ? below : above) || bottomEdge - topEdge;
  const height = Math.max(1, Math.min(desiredHeight, available));
  let left = align === 'end' ? anchor.right - width : anchor.left;
  const alternate = align === 'end' ? anchor.left : anchor.right - width;
  if ((left < leftEdge || left + width > rightEdge) && alternate >= leftEdge && alternate + width <= rightEdge) left = alternate;
  left = clamp(left, leftEdge, rightEdge - width);
  const top = clamp(placement === 'below' ? anchor.bottom + spacing : anchor.top - spacing - height, topEdge, bottomEdge - height);
  return { left, top, width, maxHeight: height, placement };
}

const ownedStyles = ['--ui-floating-left', '--ui-floating-top', '--ui-floating-width', '--ui-floating-max-height'];
const ownedAttributes = ['popover', 'data-floating-state', 'data-floating-kind', 'data-floating-mode', 'data-floating-placement'];

/**
 * Call sync({prefer: element}) after rendering and restoring details.open.
 * data-floating: menu/panel/wide/compact, or target (only <=760px).
 * data-floating-align="end" aligns the panel to the summary's right edge when possible.
 * close() updates details.open, so the existing native toggle persistence still runs.
 */
export function createFloatingDisclosures({ root = globalThis.document, selector = 'details[data-floating]', gap = 8, margin = 12 } = {}) {
  if (!root?.querySelectorAll) throw new TypeError('浮動パネルの親要素を確認してください。');
  const doc = root.nodeType === 9 ? root : root.ownerDocument, win = doc.defaultView;
  if (!win) throw new TypeError('浮動パネルのdocumentを確認してください。');
  const entries = new Map(), listeners = [];
  const media = win.matchMedia?.('(max-width:760px)');
  let active = null, sequence = 0, destroyed = false, syncing = false, syncQueued = false, frame = null;
  const add = (target, type, listener, options) => { target?.addEventListener?.(type, listener, options); listeners.push(() => target?.removeEventListener?.(type, listener, options)); };
  const direct = (element, predicate) => [...element.children].find(predicate);
  const visibleViewport = () => ({ left: win.visualViewport?.offsetLeft || 0, top: win.visualViewport?.offsetTop || 0, width: win.visualViewport?.width || doc.documentElement.clientWidth || win.innerWidth, height: win.visualViewport?.height || win.innerHeight || doc.documentElement.clientHeight });
  const connected = entry => entry.details.isConnected && entry.body.isConnected && entry.body.parentElement === entry.details && entry.summary.parentElement === entry.details;
  const enabled = entry => entry.details.dataset.floating !== 'target' || (media ? media.matches : win.innerWidth <= 760);
  const trigger = entry => entry.anchor || entry.summary;
  const contains = (entry, element) => Boolean(element && (entry.body.contains(element) || entry.summary.contains(element) || entry.anchor?.contains(element)));
  const popoverOpen = entry => { try { return entry.body.matches(':popover-open'); } catch { return false; } };

  function register(details) {
    const summary = direct(details, child => child.localName === 'summary');
    const body = direct(details, child => child.classList.contains('ui-disclosure-body'));
    if (!summary || !body) return null;
    const entry = { details, summary, body, anchor: null, enabled: false, shown: false, popover: false, targetDesktop: false, normalizeMobileTarget: false, order: 0,
      originalClass: body.classList.contains('ui-floating-panel'),
      attributes: new Map(ownedAttributes.map(key => [key, body.getAttribute(key)])),
      styles: new Map(ownedStyles.map(key => [key, [body.style.getPropertyValue(key), body.style.getPropertyPriority(key)]])) };
    entries.set(details, entry); return entry;
  }
  function hide(entry) {
    entry.shown = false;
    if (entry.popover) { try { if (popoverOpen(entry)) entry.body.hidePopover(); } catch { /* Removed elements may already have left the top layer. */ } }
    entry.body.setAttribute('data-floating-state', 'closed');
    if (active === entry) { active = null; resizeObserver?.disconnect(); }
  }
  function restore(entry) {
    hide(entry);
    for (const [key, value] of entry.attributes) { if (value === null) entry.body.removeAttribute(key); else entry.body.setAttribute(key, value); }
    for (const [key, [value, priority]] of entry.styles) { if (value) entry.body.style.setProperty(key, value, priority); else entry.body.style.removeProperty(key); }
    if (!entry.originalClass) entry.body.classList.remove('ui-floating-panel');
    entry.enabled = false; entry.popover = false; entry.anchor = null; entry.normalizeMobileTarget = false;
  }
  function enable(entry) {
    entry.enabled = true; entry.body.classList.add('ui-floating-panel');
    entry.body.setAttribute('data-floating-state', 'closed');
    entry.popover = typeof entry.body.showPopover === 'function' && typeof entry.body.hidePopover === 'function';
    if (entry.popover) entry.body.setAttribute('popover', 'manual');
    entry.body.setAttribute('data-floating-mode', entry.popover ? 'popover' : 'fixed');
  }
  function closeEntry(entry, restoreFocus = false) {
    const focusedInside = contains(entry, doc.activeElement), returnTo = trigger(entry);
    hide(entry);
    if (entry.details.open) entry.details.open = false;
    entry.anchor = null;
    if (restoreFocus && focusedInside && returnTo.isConnected) returnTo.focus({ preventScroll: true });
  }
  const editing = entry => entry.body.contains(doc.activeElement) && (['input', 'textarea', 'select'].includes(doc.activeElement?.localName) || doc.activeElement?.isContentEditable);
  function available(entry) {
    if (!connected(entry) || !entry.enabled || !entry.details.open) return false;
    if (entry.anchor && !entry.anchor.isConnected) return false;
    const source = trigger(entry);
    if (!source.getClientRects().length) return false;
    const viewport = visibleViewport(), anchor = source.getBoundingClientRect();
    const visible = anchor.bottom > viewport.top && anchor.top < viewport.top + viewport.height && anchor.right > viewport.left && anchor.left < viewport.left + viewport.width;
    return visible || (active === entry && editing(entry));
  }
  function position(entry) {
    if (!available(entry)) { closeEntry(entry); return; }
    const viewport = visibleViewport(), anchor = trigger(entry).getBoundingClientRect();
    const kind = Object.hasOwn(FLOATING_SIZES, entry.details.dataset.floating) ? entry.details.dataset.floating : 'panel';
    const base = FLOATING_SIZES[kind], mobile=media?media.matches:win.innerWidth<=760;
    const size = mobile ? {width:Math.min(base.width,kind==='menu'?224:360),height:Math.min(base.height,viewport.height*.62)} : base;
    const width = Math.min(size.width, Math.max(1, viewport.width - 2 * margin));
    entry.body.setAttribute('data-floating-kind', kind);
    entry.body.style.setProperty('--ui-floating-width', `${width}px`);
    entry.body.style.setProperty('--ui-floating-max-height', `${Math.min(size.height, Math.max(1, viewport.height - 2 * margin))}px`);
    const bounds = entry.body.getBoundingClientRect();
    const result = computeFloatingPosition(anchor, { width, height: bounds.height }, viewport, { gap, margin, align: entry.details.dataset.floatingAlign, maxWidth: size.width, maxHeight: size.height });
    for (const [key, value] of Object.entries({ left: result.left, top: result.top, width: result.width, 'max-height': result.maxHeight })) entry.body.style.setProperty(`--ui-floating-${key}`, `${value}px`);
    entry.body.setAttribute('data-floating-placement', result.placement);
  }
  function show(entry) {
    if (active && active !== entry) closeEntry(active);
    active = entry; entry.shown = true;
    entry.body.setAttribute('data-floating-state', 'open');
    if (entry.popover && !popoverOpen(entry)) {
      // Disclosures retain focus on their native summary, including content with autofocus.
      const before = doc.activeElement, autofocus = [...entry.body.querySelectorAll('[autofocus]')].map(element => [element, element.getAttribute('autofocus')]);
      for (const [element] of autofocus) element.removeAttribute('autofocus');
      try { entry.body.showPopover({ source: trigger(entry) }); }
      catch { entry.popover = false; entry.body.removeAttribute('popover'); entry.body.setAttribute('data-floating-mode', 'fixed'); }
      finally { for (const [element, value] of autofocus) element.setAttribute('autofocus', value); }
      if (before?.isConnected && doc.activeElement !== before) before.focus({ preventScroll: true });
    }
    position(entry);
    if (active === entry) { resizeObserver?.disconnect(); resizeObserver?.observe(trigger(entry)); resizeObserver?.observe(entry.body); }
  }
  function prepare() {
    if (destroyed) return 0;
    const found = new Set(root.querySelectorAll(selector));
    if (root.matches?.(selector)) found.add(root);
    for (const [details, entry] of entries) {
      if (!found.has(details) || !connected(entry)) { restore(entry); entries.delete(details); }
    }
    for (const details of found) {
      const entry = entries.get(details) || register(details);
      if (!entry) continue;
      const shouldEnable = enabled(entry);
      if (shouldEnable) {
        if (!entry.enabled) {
          // A desktop's always-visible target list must not become an unsolicited mobile overlay.
          if (entry.targetDesktop && details.dataset.floating === 'target') entry.normalizeMobileTarget = true;
          enable(entry);
        }
      } else if (entry.enabled) restore(entry); // Desktop target body returns to normal flow, retaining open.
      entry.targetDesktop = details.dataset.floating === 'target' && !shouldEnable;
    }
    return entries.size;
  }
  function sync({ prefer } = {}) {
    if (destroyed || syncing) return active?.details || null;
    syncing = true;
    try {
      prepare();
      for (const entry of entries.values()) if (entry.normalizeMobileTarget) { entry.normalizeMobileTarget = false; closeEntry(entry); }
      const candidates = [...entries.values()].filter(available);
      const preferred = candidates.find(entry => entry.details === prefer || entry.details.contains(prefer));
      const focused = candidates.find(entry => contains(entry, doc.activeElement));
      const chosen = preferred || (candidates.includes(active) ? active : null) || focused || candidates.sort((a, b) => a.order - b.order).at(-1);
      for (const entry of entries.values()) {
        if (entry.enabled && entry.details.open && entry !== chosen) closeEntry(entry);
        else if (entry.shown && entry !== chosen) hide(entry);
      }
      if (chosen) show(chosen);
      else if (active) hide(active);
      return active?.details || null;
    } finally { syncing = false; }
  }
  function queueSync() {
    if (destroyed || syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => { syncQueued = false; if (!destroyed) sync(); });
  }
  function schedulePosition() {
    if (destroyed || !active || frame !== null) return;
    frame = win.requestAnimationFrame(() => { frame = null; if (active && !destroyed) position(active); });
  }
  function outside(event) {
    if (!active) return;
    if (event.composedPath?.().some(element => element === active.body || element === active.summary) || contains(active, event.target)) return;
    closeEntry(active);
  }
  function recordTrigger(event) {
    for (const entry of entries.values()) if (entry.enabled && entry.summary.contains(event.target)) { entry.anchor = null; entry.order = ++sequence; break; }
  }
  function onKey(event) {
    if (event.key === 'Enter' || event.key === ' ') recordTrigger(event); // Let native summary activation run.
    if (event.key !== 'Escape' || event.isComposing || !active) return;
    event.preventDefault(); event.stopPropagation(); closeEntry(active, true);
  }
  function onToggle(event) {
    const entry = entries.get(event.target);
    if (entry?.enabled) { sync({ prefer: entry.details.open ? entry.details : undefined }); return; }
    // Browser-driven popover closure (e.g. a containing dialog closes) mirrors details state once.
    if (active && event.target === active.body && event.newState === 'closed' && !popoverOpen(active)) closeEntry(active);
  }
  const resizeObserver = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(schedulePosition) : null;
  const mutationObserver = typeof win.MutationObserver === 'function' ? new win.MutationObserver(queueSync) : null;
  mutationObserver?.observe(root.nodeType === 9 ? root.documentElement : root, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'data-floating', 'data-floating-align'] });
  add(doc, 'toggle', onToggle, true);
  add(doc, 'pointerdown', recordTrigger, true); add(doc, 'pointerdown', outside, true); add(doc, 'click', outside, true);
  add(doc, 'keydown', onKey, true);
  add(doc, 'scroll', event => { if (!active?.body.contains(event.target)) schedulePosition(); }, true);
  add(win, 'scroll', schedulePosition, { passive: true }); add(win, 'resize', queueSync, { passive: true });
  add(win.visualViewport, 'scroll', schedulePosition, { passive: true }); add(win.visualViewport, 'resize', schedulePosition, { passive: true });
  add(media, 'change', queueSync);
  // A newly opened modal may make an unrelated panel inert; never keep that panel above it.
  add(doc, 'focusin', event => { const dialog = event.target.closest?.('dialog[open]'); if (active && dialog && !dialog.contains(active.details)) closeEntry(active); }, true);
  sync();
  return {
    prepare, sync,
    returnTarget(element = doc.activeElement) { return active?.body.contains(element) ? trigger(active) : element; },
    open(details, { focus = false, anchor = null } = {}) {
      if (destroyed || !details?.matches?.(selector) || !(root.nodeType === 9 ? doc.documentElement.contains(details) : root.contains(details))) return false;
      if (anchor && (anchor.ownerDocument !== doc || !anchor.isConnected)) return false;
      const entry = entries.get(details) || register(details);
      if (!entry) return false;
      entry.anchor = anchor; entry.order = ++sequence;
      details.open = true; sync({ prefer: details });
      if (focus && trigger(entry).isConnected) trigger(entry).focus({ preventScroll: true });
      return details.open;
    },
    close({ restoreFocus = false } = {}) { for (const entry of entries.values()) if (entry.enabled && (entry.shown || entry.details.open)) closeEntry(entry, restoreFocus); },
    destroy() {
      if (destroyed) return;
      destroyed = true; mutationObserver?.disconnect(); resizeObserver?.disconnect();
      if (frame !== null) win.cancelAnimationFrame(frame);
      for (const remove of listeners) remove();
      for (const entry of entries.values()) { if (entry.enabled) { closeEntry(entry); restore(entry); } }
      entries.clear(); active = null;
    }
  };
}
