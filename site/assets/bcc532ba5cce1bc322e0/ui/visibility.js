const clips = value => ['auto', 'scroll', 'hidden', 'clip', 'overlay'].includes(value);
const finiteRect = rect => rect && [rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite);
const nearX = (rect, box, margin) => rect.right >= box.left - margin && rect.left <= box.right + margin;
const nearY = (rect, box, margin) => rect.bottom >= box.top - margin && rect.top <= box.bottom + margin;
function topLayer(element) {
  for (const selector of [':popover-open', ':modal']) {
    try { if (element.matches?.(selector)) return true; } catch { /* Unsupported selectors retain the normal clipping path. */ }
  }
  return false;
}

/** Read-only lazy-thumbnail eligibility. No decoding, loading, scrolling or focus changes. */
export function thumbnailIsVisible(element, { margin = 200 } = {}) {
  if (!element || element.isConnected === false || typeof element.getClientRects !== 'function' || !element.getClientRects().length) return false;
  const doc = element.ownerDocument, win = doc?.defaultView;
  if (!win) return false;
  const rect = element.getBoundingClientRect();
  if (!finiteRect(rect) || rect.right <= rect.left || rect.bottom <= rect.top) return false;
  const style = win.getComputedStyle?.(element);
  if (style?.display === 'none' || ['hidden', 'collapse'].includes(style?.visibility)) return false;
  const padding = Number.isFinite(margin) ? Math.max(0, margin) : 200;
  const viewport = win.visualViewport;
  const width = viewport?.width ?? win.innerWidth ?? doc.documentElement?.clientWidth;
  const height = viewport?.height ?? win.innerHeight ?? doc.documentElement?.clientHeight;
  const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
  if (![width, height, left, top].every(Number.isFinite) || width <= 0 || height <= 0) return false;
  if (!nearX(rect, { left, right: left + width }, padding) || !nearY(rect, { top, bottom: top + height }, padding)) return false;
  if (topLayer(element)) return true;
  const seen = new Set();
  let ancestor = element.parentElement ?? element.getRootNode?.()?.host;
  while (ancestor && !seen.has(ancestor)) {
    seen.add(ancestor);
    const computed = win.getComputedStyle?.(ancestor);
    const overflow = computed?.overflow?.split(/\s+/) ?? [];
    const clipX = clips(computed?.overflowX || overflow[0]), clipY = clips(computed?.overflowY || overflow[1] || overflow[0]);
    if (clipX || clipY) {
      const box = ancestor.getBoundingClientRect();
      if (!finiteRect(box)) return false;
      const clientLeft = box.left + (ancestor.clientLeft || 0), clientTop = box.top + (ancestor.clientTop || 0);
      const clientWidth = ancestor.clientWidth ?? box.right - clientLeft, clientHeight = ancestor.clientHeight ?? box.bottom - clientTop;
      if (clipX && (clientWidth <= 0 || !nearX(rect, { left: clientLeft, right: clientLeft + clientWidth }, padding))) return false;
      if (clipY && (clientHeight <= 0 || !nearY(rect, { top: clientTop, bottom: clientTop + clientHeight }, padding))) return false;
    }
    // Top-layer elements escape outer ancestors' overflow; their own scrolling still clips descendants.
    if (topLayer(ancestor)) break;
    ancestor = ancestor.parentElement ?? ancestor.getRootNode?.()?.host;
  }
  return true;
}
