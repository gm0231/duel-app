'use strict';
/* duel-worker.js — main-thread proxy for the engine worker
   (engine-worker.js), plus the createClientDuel factory client.js uses.
   Same dual-host style as engine.js: a browser global, or module.exports
   under Node (the identity test drives WorkerDuel over a worker_threads
   transport directly).
   WorkerDuel exposes the subset of E.Duel's surface client.js touches:
   state / stats / over / run() / refreshFieldStats(). this.state is ONE
   canonical object for the whole duel — incoming snapshots are merged
   into it key-by-key (never replaced), so references the client holds
   always see the latest mirror. names/cardData are re-attached from the
   local DATA (the worker excludes those static references from
   snapshots); graveResync starts as an empty Set, as in GameState. */
(function (global) {

class WorkerDuel {
  // transport: { post(obj), onMessage(fn) }
  // opts: the E.Duel opts (seed/pace/deckP0/deckP1/humanTeam/onLog/
  //       onUpdate/humanAnswerer + worker-only fast/digest). Only the
  //       serializable part is sent to the worker in the start message.
  constructor(transport, DATA, opts) {
    this.transport = transport;
    this.data = DATA;
    this.opts = opts || {};
    this.state = {
      names: DATA.names || {},
      cardData: DATA.cards || {},
      graveResync: new Set(),
    };
    this.stats = null;
    this.over = false;
    this._runResolve = null;
    this._runReject = null;
    this._promptWaiting = false;   // a 'prompt' from the worker is unanswered
    this._refreshWaiters = [];     // resolve fns for an in-flight 'refresh'
    transport.onMessage((msg) => this._onMessage(msg));
  }

  _ingest(snap) {
    if (!snap) return;
    for (const k of Object.keys(snap)) this.state[k] = snap[k];
  }

  async _onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'update':
        this._ingest(msg.state);
        if (this.opts.onUpdate) this.opts.onUpdate(this.state);
        break;
      case 'prompt': {
        this._ingest(msg.state);
        this._promptWaiting = true;
        let bytes;
        try {
          bytes = this.opts.humanAnswerer
            ? await this.opts.humanAnswerer(msg.prompt, this.state)
            : new Uint8Array(0);
        } finally {
          this._promptWaiting = false;
        }
        this.transport.post({ type: 'answer', id: msg.id, bytes });
        break;
      }
      case 'refreshed': {
        this._ingest(msg.state);
        const waiters = this._refreshWaiters.splice(0);
        for (const res of waiters) res();
        break;
      }
      case 'done':
        this._ingest(msg.state);
        this.stats = msg.stats;
        this.over = true;
        if (msg.digest) this.digest = msg.digest;
        if (this._runResolve) this._runResolve(msg.stats);
        break;
      case 'error':
        this.over = true;
        if (this._runReject) this._runReject(new Error(msg.message || 'engine worker error'));
        break;
    }
  }

  run() {
    const o = this.opts;
    const wire = {}; // serializable opts only — no functions cross over
    for (const k of ['seed', 'pace', 'deckP0', 'deckP1', 'humanTeam', 'fast', 'digest'])
      if (o[k] !== undefined) wire[k] = o[k];
    const p = new Promise((resolve, reject) => { this._runResolve = resolve; this._runReject = reject; });
    this.transport.post({ type: 'start', data: this.data, opts: wire });
    return p;
  }

  // While a prompt is being answered, the worker is idle and can service
  // a live-stat refresh; answer with the refreshed snapshot. At any other
  // time the latest snapshot is already refreshFieldStats()-ed on the
  // worker side (the onUpdate / humanAnswerer wrappers refresh before
  // sending), so resolve immediately. Returns a Promise — callers must
  // not treat this as synchronous.
  refreshFieldStats() {
    if (!this._promptWaiting) return Promise.resolve();
    return new Promise((resolve) => {
      this._refreshWaiters.push(resolve);
      this.transport.post({ type: 'refresh' });
    });
  }
}

// Wrap a browser Worker as a transport.
function workerTransport(worker) {
  return {
    post: (obj) => worker.postMessage(obj),
    onMessage: (fn) => { worker.onmessage = (ev) => fn(ev.data); },
  };
}

// createClientDuel(DATA, opts, env?) -> Promise<Duel-like>
// Browser with Worker: engine runs in engine-worker.js behind WorkerDuel.
// No Worker (jsdom test harnesses etc.): full fallback to the in-process
// E.Duel, exactly as before — OcgCoreModule() + new E.Duel(M, DATA, opts).
// env is a test seam: {WorkerCtor, OcgCoreModule, Engine} overrides.
async function createClientDuel(DATA, opts, env) {
  env = env || {};
  const WorkerCtor = 'WorkerCtor' in env ? env.WorkerCtor
    : (typeof Worker !== 'undefined' ? Worker : undefined);
  if (WorkerCtor) {
    const worker = new WorkerCtor('engine-worker.js');
    return new WorkerDuel(workerTransport(worker), DATA, opts);
  }
  const factory = env.OcgCoreModule ||
    (typeof OcgCoreModule !== 'undefined' ? OcgCoreModule : global.OcgCoreModule);
  const E = env.Engine || global.Engine;
  const M = await factory();
  return new E.Duel(M, DATA, opts);
}

const DuelWorker = { WorkerDuel, createClientDuel, workerTransport };
if (typeof module !== 'undefined') module.exports = DuelWorker;
else { global.WorkerDuel = WorkerDuel; global.createClientDuel = createClientDuel; global.DuelWorker = DuelWorker; }

})(typeof window !== 'undefined' ? window : globalThis);
