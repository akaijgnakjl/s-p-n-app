// Replaced by the static build. The versioned module locates the app's root scope.
const APP_VERSION = '0.9.8';
const BUILD_ID = '6422eb7112f4b5919a56';
const APP_BASE_RELATIVE = './';
const APP_BASE = new URL(APP_BASE_RELATIVE, import.meta.url);

function requestWorker(worker, data, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (error, result) => {
      clearTimeout(timer);
      channel.port1.close();
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('圏外の準備状態を確認できません。もう一度お試しください。')), timeout);
    channel.port1.onmessage = event => event.data?.error ? finish(new Error(event.data.error)) : finish(null, event.data);
    try { worker.postMessage(data, [channel.port2]); }
    catch (error) { finish(error); }
  });
}

function settledWorker(worker, { activated = false } = {}) {
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      worker.removeEventListener('statechange', inspect);
      error ? reject(error) : resolve();
    };
    const inspect = () => {
      if (worker.state === 'redundant') finish(new Error('新しい版を準備できませんでした。通信できる場所で再度お試しください。'));
      else if (worker.state === 'activated' || (!activated && worker.state === 'installed')) finish();
    };
    const timer = setTimeout(() => finish(new Error('圏外の準備が完了しませんでした。通信できる場所で再度お試しください。')), 30000);
    worker.addEventListener('statechange', inspect);
    inspect();
  });
}

/** Tracks app assets only. This module never reads, sends, clears, or migrates work data. */
export function createOfflineManager({ onChange = () => {} } = {}) {
  const supported = globalThis.isSecureContext === true && Boolean(globalThis.navigator?.serviceWorker) && ['http:', 'https:'].includes(APP_BASE.protocol);
  let state = {
    supported, status: supported ? 'not-ready' : 'unsupported', ready: false,
    online: globalThis.navigator?.onLine !== false,
    currentVersion: APP_VERSION, currentBuildId: BUILD_ID,
    preparedVersion: '', preparedBuildId: '', assetCount: 0,
    updateAvailable: false, updateVersion: '', updateBuildId: '', reloadRequired: false,
    error: '', message: '',
  };
  let registration;
  let started = false;
  let destroyed = false;
  let busy = '';
  let refreshTail = Promise.resolve();
  const observed = new Set();
  const workerListeners = new Map();

  function publish(patch = {}) {
    state = { ...state, ...patch, online: globalThis.navigator?.onLine !== false };
    state.status = !supported ? 'unsupported' : busy || (state.reloadRequired ? 'reload-ready' : state.updateAvailable ? 'update-ready' : state.ready ? 'ready' : state.error ? 'error' : 'not-ready');
    if (!supported) state.message = '圏外の準備はHTTPS接続の対応ブラウザーで行ってください。';
    else if (busy === 'preparing') state.message = '圏外で使う準備をしています…';
    else if (busy === 'checking') state.message = '更新と圏外の準備を確認しています…';
    else if (busy === 'applying') state.message = '更新を適用しています…';
    else if (state.reloadRequired) state.message = '新しい版を準備しました。作業ZIPを保存してから再読み込みしてください。';
    else if (state.ready) state.message = `圏外で使えます（${state.preparedVersion}）。${state.updateAvailable ? '新しい版を準備中です。作業ZIPを保存してから更新してください。' : ''}`;
    else state.message = state.error || (state.online ? '圏外で使う準備ができていません。通信できる場所で準備してください。' : '圏外で使えるか確認できません。通信できる場所で準備してください。');
    if (!destroyed) onChange({ ...state });
    return { ...state };
  }

  function watchWorker(worker) {
    if (!worker || workerListeners.has(worker)) return;
    let wasActivated = worker.state === 'activated';
    const listener = () => {
      if (worker.state === 'activated') wasActivated = true;
      if (worker.state === 'redundant' && !wasActivated) publish({ error: '新しい版を準備できませんでした。通信できる場所で再度お試しください。' });
      if (!destroyed) void refresh();
    };
    worker.addEventListener('statechange', listener);
    workerListeners.set(worker, listener);
  }

  function watchRegistration(value) {
    if (!value || observed.has(value)) return;
    observed.add(value);
    value.addEventListener('updatefound', updateFound);
    watchWorker(value.installing);
  }

  function updateFound() { watchWorker(registration?.installing); if (!destroyed) void refresh(); }

  async function inspect() {
    if (!supported) return publish();
    registration = await navigator.serviceWorker.getRegistration(APP_BASE.href);
    watchRegistration(registration);
    let active;
    let waiting;
    let error = '';
    try { if (registration?.active) active = await requestWorker(registration.active, { type: 'GET_OFFLINE_STATUS' }); }
    catch (reason) { error = reason.message; }
    try { if (registration?.waiting) waiting = await requestWorker(registration.waiting, { type: 'GET_OFFLINE_STATUS' }); }
    catch (reason) { error ||= reason.message; }
    const update = waiting?.ready && waiting.buildId !== BUILD_ID ? waiting : active?.ready && active.buildId !== BUILD_ID ? active : null;
    return publish({
      ready: Boolean(active?.ready), preparedVersion: active?.ready ? active.version : '',
      preparedBuildId: active?.ready ? active.buildId : '', assetCount: active?.assetCount ?? 0,
      updateAvailable: Boolean(update), updateVersion: update?.version ?? '', updateBuildId: update?.buildId ?? '',
      reloadRequired: Boolean(active?.ready && active.buildId !== BUILD_ID), error: error || state.error,
    });
  }

  function refresh() {
    const task = refreshTail.then(inspect).catch(error => publish({ ready: false, error: error.message }));
    refreshTail = task;
    return task;
  }

  const networkChanged = () => { publish(); void refresh(); };
  const workerChanged = () => { void refresh(); };
  const workerMessage = event => { if (['OFFLINE_ACTIVATED', 'OFFLINE_ASSETS_CHANGED'].includes(event.data?.type)) void refresh(); };

  async function operation(status, action) {
    if (!supported) return publish();
    if (busy) throw new Error('準備または更新の処理中です。完了まで待ってください。');
    busy = status;
    publish({ error: '' });
    try { await action(); }
    catch (error) {
      publish({ error: error.message });
      throw error;
    } finally {
      busy = '';
      await refresh();
    }
    return { ...state };
  }

  return {
    getState() { return { ...state }; },
    async start() {
      if (!started && supported) {
        started = true;
        window.addEventListener('online', networkChanged);
        window.addEventListener('offline', networkChanged);
        navigator.serviceWorker.addEventListener('controllerchange', workerChanged);
        navigator.serviceWorker.addEventListener('message', workerMessage);
      }
      return await refresh();
    },
    refresh,
    prepare() {
      return operation('preparing', async () => {
        registration = await navigator.serviceWorker.register(new URL('sw.js', APP_BASE).href, { scope: APP_BASE.href, updateViaCache: 'none' });
        watchRegistration(registration);
        const worker = registration.installing;
        if (worker) await settledWorker(worker);
        if (!registration.active && worker) await settledWorker(worker, { activated: true });
        if (!registration.active) throw new Error('圏外の準備ができませんでした。通信できる場所でやり直してください。');
        await requestWorker(registration.active, { type: 'PREPARE_OFFLINE' }, 30000);
      });
    },
    checkForUpdate() {
      return operation('checking', async () => {
        registration = registration ?? await navigator.serviceWorker.getRegistration(APP_BASE.href);
        if (!registration) throw new Error('先に「圏外で使う準備」を行ってください。');
        watchRegistration(registration);
        await registration.update();
        if (registration.installing) await settledWorker(registration.installing);
      });
    },
    applyUpdate() {
      return operation('applying', async () => {
        registration = await navigator.serviceWorker.getRegistration(APP_BASE.href);
        const waiting = registration?.waiting;
        if (!waiting) {
          if (state.reloadRequired) return;
          throw new Error('適用できる更新はありません。');
        }
        const info = await requestWorker(waiting, { type: 'GET_OFFLINE_STATUS' });
        if (!info.ready) throw new Error('新しい版の準備が終わっていません。通信できる場所で更新を確認してください。');
        await requestWorker(waiting, { type: 'ACTIVATE_UPDATE' });
        await settledWorker(waiting, { activated: true });
      });
    },
    destroy() {
      destroyed = true;
      if (started) {
        window.removeEventListener('online', networkChanged);
        window.removeEventListener('offline', networkChanged);
        navigator.serviceWorker.removeEventListener('controllerchange', workerChanged);
        navigator.serviceWorker.removeEventListener('message', workerMessage);
      }
      for (const value of observed) value.removeEventListener('updatefound', updateFound);
      for (const [worker, listener] of workerListeners) worker.removeEventListener('statechange', listener);
    },
  };
}
