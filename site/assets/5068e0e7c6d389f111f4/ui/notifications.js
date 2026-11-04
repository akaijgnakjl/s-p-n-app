/** Presentation only. Business operations and their retry/cancel handlers stay in the controller. */
const TONES = new Set(['success', 'info', 'warning', 'error']);
const toneLabel = tone => ({ success: '完了', info: '案内', warning: '注意', error: 'エラー' })[tone];
const realTimers = {
  now: () => globalThis.performance?.now() ?? Date.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: timer => globalThis.clearTimeout(timer),
};

/** Choose a visible rail without covering a modal's actions, a selection bar, or the active input. */
export function notificationPlacement({ height, visualTop = 0, visualHeight = height, desiredHeight = 240, header, footer, selection, focus, notification } = {}) {
  const visibleBottom = Math.min(height, visualTop + visualHeight);
  let top = Math.max(16, visualTop + 8), end = Math.max(top, visibleBottom - 16);
  if (header && header.bottom > visualTop && header.bottom < visibleBottom) top = Math.max(top, header.bottom + 8);
  if (footer && footer.top > top && footer.top < end) end = footer.top - 8;
  if (selection && selection.bottom > visualTop && selection.top < visibleBottom) {
    if (selection.top - top >= 44) end = Math.min(end, selection.top - 8);
    else top = Math.max(top, selection.bottom + 8);
  }
  const horizontalOverlap = !notification || !focus || focus.right > notification.left && focus.left < notification.right;
  const start = end - Math.min(desiredHeight, Math.max(0, end - top));
  if (focus && horizontalOverlap && focus.bottom > start && focus.top < end) {
    const above = Math.min(end, focus.top - 8), below = Math.max(top, focus.bottom + 8);
    if (above - top >= end - below) end = Math.max(top, above);
    else top = Math.min(end, below);
  }
  return { top, bottom: Math.max(0, height - end), maxHeight: Math.max(0, end - top) };
}

/** Small, deterministic toast lifecycle; no DOM or storage is needed to test timing. */
export function createToastStore({ duration = 6000, maxToasts = 3, timers = realTimers, onChange = () => {}, onAnnounce = () => {} } = {}) {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isSafeInteger(maxToasts) || maxToasts < 1 || maxToasts > 6) throw new Error('通知の表示時間・件数を確認してください。');
  const records = [], globalPauses = new Set();
  let serial = 0, pendingTransient = null, destroyed = false;
  const snapshot = () => records.map(record => ({
    id: record.id, tone: record.tone, persistent: record.persistent,
    remaining: record.timer === null ? record.remaining : Math.max(0, record.deadline - timers.now()),
    paused: record.pauses.size > 0, messages: record.messages.map(message => ({ ...message })),
  }));
  const emit = () => { if (!destroyed) onChange(snapshot()); };
  function stop(record) {
    if (record.timer === null) return;
    record.remaining = Math.max(0, record.deadline - timers.now());
    timers.clearTimeout(record.timer); record.timer = null;
  }
  function start(record) {
    if (record.persistent || record.pauses.size || record.timer !== null || destroyed) return;
    record.deadline = timers.now() + record.remaining;
    record.timer = timers.setTimeout(() => dismiss(record.id), record.remaining);
  }
  function remove(record) {
    stop(record); records.splice(records.indexOf(record), 1);
  }
  function notify(message, { tone = 'success', persistent = false } = {}) {
    if (destroyed) return null;
    if (typeof message !== 'string' || !TONES.has(tone)) throw new Error('通知の文言・種類を確認してください。');
    if (!message.trim()) return null;
    // エラー・注意も含めて自動で隠す。見逃した通知は「通知」ボタンの一覧で確認する。
    persistent = Boolean(persistent);
    const duplicate = records.find(record => record.messages.some(item => item.text === message && item.tone === tone));
    if (duplicate) {
      duplicate.messages.find(item => item.text === message && item.tone === tone).count++;
      stop(duplicate); duplicate.remaining = duration; duplicate.persistent ||= persistent;
      start(duplicate); emit(); return duplicate.id;
    }
    if (records.length >= maxToasts) {
      const transient = records.find(record => !record.persistent && !record.pauses.size);
      if (transient) remove(transient);
      else if (persistent) {
        // Preserve every warning/error without growing the number of floating cards.
        const group = records[records.length - 1];
        stop(group); group.persistent = true;
        group.messages.push({ text: message, tone, count: 1 });
        if (({ info: 0, success: 0, warning: 1, error: 2 })[tone] > ({ info: 0, success: 0, warning: 1, error: 2 })[group.tone]) group.tone = tone;
        emit(); onAnnounce(message, tone); return group.id;
      } else {
        // Success bursts are bounded; the latest result can appear after a persistent card is closed.
        pendingTransient = { message, tone, persistent }; return null;
      }
    }
    const record = {
      id: `toast-${++serial}`, tone, persistent, messages: [{ text: message, tone, count: 1 }],
      remaining: duration, deadline: 0, timer: null, pauses: new Set(globalPauses),
    };
    records.push(record); start(record); emit(); onAnnounce(message, tone); return record.id;
  }
  function dismiss(id) {
    const record = records.find(item => item.id === id);
    if (!record || destroyed) return;
    remove(record);
    if (pendingTransient && records.length < maxToasts) {
      const next = pendingTransient; pendingTransient = null;
      notify(next.message, next); return;
    }
    emit();
  }
  function pause(id, reason = 'interaction') {
    const record = records.find(item => item.id === id);
    if (!record || record.pauses.has(reason) || destroyed) return;
    stop(record); record.pauses.add(reason); emit();
  }
  function resume(id, reason = 'interaction') {
    const record = records.find(item => item.id === id);
    if (!record || !record.pauses.delete(reason) || destroyed) return;
    start(record); emit();
  }
  function setPaused(reason, paused) {
    if (paused) globalPauses.add(reason); else globalPauses.delete(reason);
    for (const record of records) paused ? pause(record.id, reason) : resume(record.id, reason);
  }
  function destroy() {
    for (const record of records) stop(record);
    records.length = 0; pendingTransient = null; destroyed = true;
  }
  function clear() {
    for (const record of records) stop(record);
    records.length = 0; pendingTransient = null; emit();
  }
  return { notify, dismiss, pause, resume, setPaused, getState: snapshot, clear, destroy };
}

/** All legacy controller IDs stay on stable nodes; visual messages have one announcer per priority. */
export function renderNotificationShell() {
  const close = '<button type="button" class="ui-notification-dismiss" data-notification-dismiss data-notification-control aria-label="この通知を閉じる">×</button>';
  return `<section id="notificationCenter" class="ui-notifications" popover="manual" aria-label="作業の通知" hidden><div id="notificationHistory" class="ui-notification-history" hidden><div class="ui-notification-history-head"><strong>通知の一覧</strong><button type="button" class="button" data-notification-history-close>閉じる</button></div><ol data-notification-history-list></ol></div><div id="notificationToasts" class="ui-toast-stack"><div id="notice" class="ui-toast" aria-live="off" hidden><div data-notification-messages></div>${close}</div></div><div id="storageNotice" class="ui-toast" data-tone="warning" aria-live="off" hidden><div data-notification-messages></div>${close}</div><div id="draftNotice" class="ui-notification-drafts" aria-live="off" hidden><p data-notification-draft-text></p><div class="ui-notification-draft-actions" data-notification-draft-actions></div></div><div id="progressNotice" class="ui-notification-progress" aria-live="off" hidden><span data-notification-progress></span><button type="button" id="cancelOperation" data-notification-control hidden>処理を取り消す</button></div><div id="resumeStatus" class="ui-save-status" data-state="idle" aria-live="off" hidden><span id="resumeStatusText"></span><button type="button" id="retrySessionSave" data-notification-control hidden>一時保存を再試行</button></div><span id="notificationStatus" class="ui-notification-announcer" role="status" aria-atomic="true"></span><span id="notificationAlert" class="ui-notification-announcer" role="alert" aria-atomic="true"></span></section>`;
}

/** Mount after renderNotificationShell. Existing retry/cancel onclick handlers are never replaced. */
export function createNotifications({ root = globalThis.document, duration = 2000, maxToasts = 3, timers = realTimers } = {}) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument;
  const find = id => root.nodeType === 9 ? root.getElementById(id) : root.id === id ? root : root.querySelector(`#${id}`);
  const region = find('notificationCenter'), stack = find('notificationToasts'), stable = find('notice');
  const storage = find('storageNotice'), drafts = find('draftNotice'), progress = find('progressNotice'), session = find('resumeStatus');
  const sessionText = find('resumeStatusText'), retry = find('retrySessionSave'), cancel = find('cancelOperation');
  const status = find('notificationStatus'), alert = find('notificationAlert');
  if ([region, stack, stable, storage, drafts, progress, session, sessionText, retry, cancel, status, alert].some(node => !node)) throw new Error('通知領域の初期化に必要な要素がありません。');
  const win = doc.defaultView ?? globalThis, nodes = new Map(), dialogOrder = new Map(), cardSignatures = new WeakMap();
  const cleanups = [];
  let order = 0, destroyed = false, storageMessage = '', storageDismissed = false, sessionFailed = false, draftSignature = '';
  // 一覧（任意の要素）。古い固定領域にも対応するため、無ければ一覧なしで動く。
  const history = find('notificationHistory'), historyList = history?.querySelector('[data-notification-history-list]'), historyButton = find('notificationHistoryButton');
  const log = [], peekTimers = new Map();
  let historyOpen = false;
  let popoverSupported = typeof region.showPopover === 'function', layoutFrame = null;
  const announcementVersion = { status: 0, alert: 0 };
  const listen = (node, event, callback, options) => { node.addEventListener(event, callback, options); cleanups.push(() => node.removeEventListener(event, callback, options)); };
  function announce(message, tone) {
    const channel = tone === 'error' || tone === 'warning' ? 'alert' : 'status';
    const element = channel === 'alert' ? alert : status, version = ++announcementVersion[channel];
    element.textContent = '';
    Promise.resolve().then(() => { if (!destroyed && announcementVersion[channel] === version) element.textContent = message; });
  }
  function isPopoverOpen() { try { return region.matches(':popover-open'); } catch { return false; } }
  function topDialog() {
    const open = [...doc.querySelectorAll('dialog[open]')];
    for (const dialog of dialogOrder.keys()) if (!open.includes(dialog)) dialogOrder.delete(dialog);
    for (const dialog of open) if (!dialogOrder.has(dialog)) dialogOrder.set(dialog, ++order);
    return open.sort((a, b) => dialogOrder.get(b) - dialogOrder.get(a))[0] ?? null;
  }
  function visibleRect(element) {
    if (!element || element.hidden || !element.getClientRects().length) return null;
    const rect = element.getBoundingClientRect(); return rect.width && rect.height ? rect : null;
  }
  function layout(dialog) {
    const active = doc.activeElement, focusedInput = active?.matches?.('input,textarea,select,[contenteditable="true"]') && !region.contains(active);
    const floating = [...doc.querySelectorAll('[data-floating-state="open"]')].map(visibleRect).find(Boolean);
    const rect = region.getBoundingClientRect();
    const placement = notificationPlacement({
      height: win.innerHeight, visualTop: win.visualViewport?.offsetTop ?? 0, visualHeight: win.visualViewport?.height ?? win.innerHeight,
      desiredHeight: Math.max(rect.height, region.scrollHeight, 80), notification: rect,
      header: visibleRect(dialog?.querySelector('.preview-toolbar,.drawer-header,.dialog-heading')),
      footer: visibleRect(dialog?.querySelector('.dialog-actions')),
      selection: dialog ? null : [...doc.querySelectorAll('.selection-bar')].map(visibleRect).find(Boolean),
      focus: focusedInput ? visibleRect(active) : floating,
    });
    region.style.setProperty('--notifications-top', `${placement.top}px`);
    region.style.setProperty('--notifications-bottom', `${placement.bottom}px`);
    region.style.setProperty('--notifications-max-height', `${placement.maxHeight}px`);
    region.dataset.overlay = String(Boolean(dialog));
  }
  function refresh() {
    if (destroyed) return;
    const dialog = topDialog(), host = dialog ?? doc.body;
    if (region.parentElement !== host) {
      // Moving a populated live region can repeat old announcements in screen readers.
      announcementVersion.status++; announcementVersion.alert++;
      status.textContent = ''; alert.textContent = '';
      if (popoverSupported && isPopoverOpen()) region.hidePopover();
      host.append(region);
    }
    // 保存状況・下書き・端末保存の注意は、変化した時に2秒だけ見せ、あとは一覧を開いた時だけ出す。
    const shown = node => !node.hidden && (historyOpen || node.dataset.peek === '1');
    const visible = historyOpen || nodes.size > 0 || shown(storage) || shown(drafts) || !progress.hidden || shown(session);
    region.dataset.history = historyOpen ? 'open' : 'closed';
    if (history) history.hidden = !historyOpen;
    region.hidden = !visible;
    layout(dialog);
    if (!visible) { if (popoverSupported && isPopoverOpen()) region.hidePopover(); return; }
    if (popoverSupported && !isPopoverOpen()) {
      try { region.showPopover(); }
      catch { popoverSupported = false; region.removeAttribute('popover'); }
    }
  }
  function requestLayout() {
    if (layoutFrame !== null || destroyed) return;
    if (typeof win.requestAnimationFrame !== 'function') { refresh(); return; }
    layoutFrame = win.requestAnimationFrame(() => { layoutFrame = null; refresh(); });
  }
  function paintCard(node, record) {
    node.hidden = false; node.dataset.tone = record.tone;
    node.setAttribute('role', 'group'); node.setAttribute('aria-label', `${toneLabel(record.tone)}の通知`);
    const signature = JSON.stringify([record.tone, record.messages]);
    if (cardSignatures.get(node) === signature) return;
    cardSignatures.set(node, signature);
    const content = node.querySelector('[data-notification-messages]');
    content.replaceChildren(...record.messages.map(message => {
      const paragraph = doc.createElement('p'); paragraph.textContent = message.text;
      if (record.messages.length > 1) paragraph.dataset.tone = message.tone;
      if (message.count > 1) {
        const count = doc.createElement('span'); count.className = 'ui-toast-count'; count.textContent = `（${message.count}回）`; count.setAttribute('aria-hidden', 'true'); paragraph.append(count);
      }
      return paragraph;
    }));
    node.querySelector('[data-notification-dismiss]').setAttribute('aria-label', record.messages.length > 1 ? `この${record.messages.length}件の通知を閉じる` : 'この通知を閉じる');
  }
  function createCard() {
    const node = doc.createElement('div'); node.className = 'ui-toast'; node.setAttribute('aria-live', 'off');
    const content = doc.createElement('div'); content.setAttribute('data-notification-messages', '');
    const dismiss = doc.createElement('button'); dismiss.type = 'button'; dismiss.className = 'ui-notification-dismiss'; dismiss.textContent = '×';
    dismiss.setAttribute('data-notification-dismiss', ''); dismiss.setAttribute('data-notification-control', '');
    node.append(content, dismiss); return node;
  }
  const store = createToastStore({ duration, maxToasts, timers, onAnnounce: announce, onChange(records) {
    const ids = new Set(records.map(record => record.id));
    for (const [id, node] of nodes) if (!ids.has(id)) {
      if (node === stable) { node.hidden = true; node.removeAttribute('data-toast-id'); }
      else node.remove();
      nodes.delete(id);
    }
    for (const record of records) {
      let node = nodes.get(record.id);
      if (!node) {
        node = [...nodes.values()].includes(stable) ? createCard() : stable;
        node.dataset.toastId = record.id; nodes.set(record.id, node);
        if (node.parentElement !== stack) stack.append(node);
      }
      paintCard(node, record);
    }
    refresh();
  } });
  const cardFor = target => target?.closest?.('[data-toast-id]');
  const toneText = { success: '完了', info: '案内', warning: '注意', error: 'エラー' };
  function renderHistory() {
    if (historyButton) { historyButton.textContent = log.length ? `通知 ${log.length}` : '通知'; historyButton.setAttribute('aria-expanded', String(historyOpen)); }
    if (!historyList || !historyOpen) return;
    historyList.replaceChildren(...(log.length ? [...log].reverse() : [{ text: 'まだ通知はありません。', tone: 'info', at: '' }]).map(entry => {
      const item = doc.createElement('li'); item.dataset.tone = entry.tone;
      item.textContent = entry.at ? `${entry.at}　${toneText[entry.tone]}：${entry.text}` : entry.text;
      return item;
    }));
  }
  function record(text, tone) {
    if (!text) return;
    const now = new Date(), at = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const last = log[log.length - 1];
    if (last && last.text === text && last.tone === tone) last.at = at; else log.push({ text, tone, at });
    if (log.length > 100) log.shift();
    renderHistory();
  }
  function peek(node) {
    node.dataset.peek = '1';
    timers.clearTimeout(peekTimers.get(node));
    peekTimers.set(node, timers.setTimeout(() => { delete node.dataset.peek; peekTimers.delete(node); refresh(); }, duration));
  }
  function setHistoryOpen(open) { if (destroyed) return; historyOpen = Boolean(open); renderHistory(); refresh(); }
  if (historyButton) listen(historyButton, 'click', () => setHistoryOpen(!historyOpen));
  renderHistory();
  listen(region, 'click', event => {
    if (event.target.closest?.('[data-notification-history-close]')) { setHistoryOpen(false); return; }
    const close = event.target.closest?.('[data-notification-dismiss]');
    if (!close) return;
    const card = cardFor(close);
    if (card) store.dismiss(card.dataset.toastId);
    else if (storage.contains(close)) { storageDismissed = true; storage.hidden = true; refresh(); }
  });
  listen(region, 'mouseover', event => {
    const card = cardFor(event.target);
    if (card && !card.contains(event.relatedTarget)) store.pause(card.dataset.toastId, 'pointer');
  });
  listen(region, 'mouseout', event => {
    const card = cardFor(event.target);
    if (card && !card.contains(event.relatedTarget)) store.resume(card.dataset.toastId, 'pointer');
  });
  listen(region, 'focusin', event => { const card = cardFor(event.target); if (card) store.pause(card.dataset.toastId, 'focus'); });
  listen(region, 'focusout', event => {
    const card = cardFor(event.target);
    if (card && !card.contains(event.relatedTarget)) store.resume(card.dataset.toastId, 'focus');
  });
  listen(doc, 'visibilitychange', () => store.setPaused('hidden', doc.hidden));
  store.setPaused('hidden', Boolean(doc.hidden));
  listen(win, 'resize', requestLayout);
  if (win.visualViewport?.addEventListener) {
    listen(win.visualViewport, 'resize', requestLayout);
    listen(win.visualViewport, 'scroll', requestLayout);
  }
  listen(doc, 'focusin', requestLayout, true);
  listen(doc, 'focusout', requestLayout, true);
  listen(doc, 'scroll', requestLayout, true);
  listen(doc, 'close', requestLayout, true);
  listen(doc, 'toggle', requestLayout, true);
  if (win.MutationObserver) {
    const observer = new win.MutationObserver(changes => {
      for (const change of changes) if (change.target.tagName === 'DIALOG') {
        if (change.target.open) dialogOrder.set(change.target, ++order); else dialogOrder.delete(change.target);
      }
      refresh();
    });
    observer.observe(doc.body, { subtree: true, attributes: true, attributeFilter: ['open', 'data-floating-state'] });
    cleanups.push(() => observer.disconnect());
  }
  function setStorageWarning(message = '') {
    if (destroyed) return;
    if (message === storageMessage && storageDismissed) return;
    const changed = message !== storageMessage;
    storageMessage = message; storageDismissed = false; storage.hidden = !message;
    if (message) paintCard(storage, { tone: 'warning', messages: [{ text: message, tone: 'warning', count: 1 }] });
    if (changed && message) { record(message, 'warning'); peek(storage); }
    refresh(); if (changed && message) announce(message, 'warning');
  }
  function setSessionStatus({ visible = true, state = 'saved', text = '' } = {}) {
    if (destroyed) return;
    if (!['idle', 'pending', 'saved', 'failed'].includes(state)) throw new Error('一時保存の表示状態を確認してください。');
    const changed = session.dataset.state !== state || sessionText.textContent !== text;
    session.hidden = !visible; session.dataset.state = state; sessionText.textContent = text; sessionText.title = text;
    retry.hidden = !visible || state !== 'failed';
    const recovered = visible && state === 'saved' && sessionFailed;
    if (!visible) sessionFailed = false;
    if (visible && state === 'failed') sessionFailed = true;
    if (visible && state === 'failed' && changed) { record(text, 'error'); peek(session); }
    if (recovered) { record('一時保存を再開しました。', 'success'); peek(session); }
    refresh();
    if (visible && state === 'failed' && changed) announce(text, 'error');
    else if (recovered) { sessionFailed = false; announce('一時保存を再開しました。', 'success'); }
  }
  function setDraftNotice({ text = '', actionsHTML = '', visible = true } = {}) {
    if (destroyed) return;
    if (visible && drafts.hidden) { record(text, 'info'); peek(drafts); }
    drafts.hidden = !visible;
    const signature = JSON.stringify([text, actionsHTML]);
    if (signature !== draftSignature) {
      draftSignature = signature;
      drafts.querySelector('[data-notification-draft-text]').textContent = text;
      const actions = drafts.querySelector('[data-notification-draft-actions]');
      // actionsHTML comes from the caller's shared UI helpers, never from persisted draft text.
      actions.innerHTML = actionsHTML;
      actions.querySelectorAll('button').forEach(button => { button.type = 'button'; });
    }
    refresh();
  }
  function showProgress(message, { cancellable, announce: announceUpdate = false } = {}) {
    if (destroyed) return;
    const initial = progress.hidden; progress.hidden = false;
    progress.querySelector('[data-notification-progress]').textContent = message;
    if (cancellable !== undefined) cancel.hidden = !cancellable;
    refresh(); if (initial || announceUpdate) announce(message, 'info');
  }
  function clearProgress() { if (!destroyed) { progress.hidden = true; cancel.hidden = true; refresh(); } }
  function destroy() {
    if (destroyed) return;
    destroyed = true; store.destroy(); cleanups.forEach(cleanup => cleanup());
    for (const timer of peekTimers.values()) timers.clearTimeout(timer); peekTimers.clear();
    if (layoutFrame !== null) win.cancelAnimationFrame?.(layoutFrame);
    if (popoverSupported && isPopoverOpen()) region.hidePopover();
    region.hidden = true;
  }
  refresh();
  const notify = (message, options = {}) => { const id = store.notify(message, options); if (typeof message === 'string' && message.trim()) record(message.trim(), options.tone || 'success'); return id; };
  return { notify, openHistory: () => setHistoryOpen(true), closeHistory: () => setHistoryOpen(false), getHistory: () => log.map(entry => ({ ...entry })), clearToasts: store.clear, setStorageWarning, setSessionStatus, setDraftNotice, showProgress, clearProgress, refresh, destroy, getState: store.getState };
}
