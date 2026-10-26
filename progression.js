(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EmberProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const STORAGE_KEY = 'ember-circuit-progress-v2';
  const VERSION = 2;
  const RECENT_RUN_LIMIT = 20;
  const CHALLENGES = [
    { id: 'clear100', name: '清场行家', description: '任意一局击败 100 名敌人', field: 'bestKills', target: 100, reward: 'arc' },
    { id: 'reach180', name: '余烬不熄', description: '任意一局生存 180 秒', field: 'bestTime', target: 180, reward: 'ember' },
    { id: 'beatboss', name: '破晓时刻', description: '任意战场击败最终核心', field: 'wins', target: 1, reward: 'dawn' }
  ];
  const TRAILS = [
    { id: 'default', name: '初始余迹', color: '#93ffe2' },
    { id: 'arc', name: '电弧余迹', color: '#42e8d1' },
    { id: 'ember', name: '熔心余迹', color: '#ff9853' },
    { id: 'dawn', name: '破晓余迹', color: '#fff0bb' }
  ];

  function number(value, integer) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
    const safe = Math.min(value, Number.MAX_SAFE_INTEGER);
    return integer ? Math.floor(safe) : safe;
  }

  function runId(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function emptyState() {
    return { version: VERSION, bestKills: 0, bestTime: 0, bestCombo: 0, wins: 0, runs: 0, selectedTrail: 'default', recentRunIds: [] };
  }

  function hasTrail(state, id) {
    return id === 'default' || CHALLENGES.some(item => item.reward === id && state[item.field] >= item.target);
  }

  // Derived challenge/reward flags are never trusted from storage. Saving only
  // best results keeps these goals independent and prevents additive grinding.
  function normalize(saved) {
    const state = emptyState();
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || saved.version !== VERSION) return state;
    for (const key of ['bestKills', 'bestCombo', 'runs', 'wins']) state[key] = number(saved[key], true);
    state.bestTime = number(saved.bestTime, false);
    state.wins = Math.min(state.wins, state.runs);
    if (Array.isArray(saved.recentRunIds)) {
      // Retain the last occurrence if a damaged save contains duplicate IDs.
      const ids = saved.recentRunIds.map(runId).filter(Boolean);
      state.recentRunIds = ids.filter((id, index) => ids.lastIndexOf(id) === index).slice(-RECENT_RUN_LIMIT);
    }
    if (TRAILS.some(item => item.id === saved.selectedTrail) && hasTrail(state, saved.selectedTrail)) {
      state.selectedTrail = saved.selectedTrail;
    }
    return state;
  }

  /**
   * Create an independent local archive. Omit storage to use localStorage;
   * pass null for memory-only operation, or inject a Storage-like object.
   * Blocked storage falls back to this store's in-memory session state.
   */
  function createStore(storage) {
    let backing = storage;
    if (backing === undefined) {
      try { backing = root && root.localStorage; } catch (_) { backing = null; }
    }
    let state = emptyState();
    try {
      if (backing && typeof backing.getItem === 'function') {
        state = normalize(JSON.parse(backing.getItem(STORAGE_KEY)));
      }
    } catch (_) { /* Empty memory state is usable when storage is unavailable or corrupt. */ }

    function save() {
      try {
        if (backing && typeof backing.setItem === 'function') backing.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (_) { /* The state is already committed in memory, including deduplication IDs. */ }
    }

    // Each call makes new nested objects so consumers cannot mutate the store.
    function read() {
      return {
        version: VERSION,
        bestKills: state.bestKills,
        bestTime: state.bestTime,
        bestCombo: state.bestCombo,
        wins: state.wins,
        runs: state.runs,
        selectedTrail: state.selectedTrail,
        challenges: CHALLENGES.map(item => ({
          id: item.id, name: item.name, description: item.description,
          value: Math.min(state[item.field], item.target), target: item.target,
          unlocked: state[item.field] >= item.target, reward: item.reward
        })),
        trails: TRAILS.map(item => ({ id: item.id, name: item.name, color: item.color, unlocked: hasTrail(state, item.id) }))
      };
    }

    /**
     * Record one terminal result. A stable, unique runId must identify the run.
     * Repeated IDs among the last 20 finished runs are no-ops, even after reload.
     * newlyUnlocked contains challenge objects whose reward is a trail ID.
     * Arena is deliberately irrelevant: every challenge works in either arena.
     */
    function recordRun(result) {
      const unchanged = () => ({ progress: read(), newlyUnlocked: [] });
      if (!result || typeof result !== 'object' || Array.isArray(result)) return unchanged();
      if (result.mode !== 'won' && result.mode !== 'dead') return unchanged();
      const id = runId(result.runId);
      if (!id || state.recentRunIds.includes(id)) return unchanged();
      const before = read();
      state.bestKills = Math.max(state.bestKills, number(result.kills, true));
      state.bestTime = Math.max(state.bestTime, number(result.time, false));
      state.bestCombo = Math.max(state.bestCombo, number(result.maxCombo, true));
      state.runs = Math.min(Number.MAX_SAFE_INTEGER, state.runs + 1);
      if (result.mode === 'won') state.wins = Math.min(Number.MAX_SAFE_INTEGER, state.wins + 1);
      state.recentRunIds.push(id);
      state.recentRunIds = state.recentRunIds.slice(-RECENT_RUN_LIMIT);
      save();
      const progress = read();
      const newlyUnlocked = progress.challenges.filter((item, index) => item.unlocked && !before.challenges[index].unlocked)
        .map(item => ({ ...item }));
      return { progress, newlyUnlocked };
    }

    // Cosmetics are opt-in, and do not alter game statistics or arena access.
    function selectTrail(id) {
      if (TRAILS.some(item => item.id === id) && hasTrail(state, id) && state.selectedTrail !== id) {
        state.selectedTrail = id;
        save();
      }
      return read();
    }

    return { read, recordRun, selectTrail };
  }

  return { createStore };
});
