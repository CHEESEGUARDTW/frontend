// ===========================================================
//  CheeseGuard v2.1 — API Key Security Extension
//  TurboWarp Custom Extension by TheOfficialCheeseFish
//
//  Change SERVER_URL to your deployed Render URL.
//  Players just paste their key — nothing else needed.
// ===========================================================

(function (Scratch) {
  "use strict";

  // ── CHANGE THIS TO YOUR RENDER URL ────────────────────────────────────────
  const SERVER_URL = "https://backend-qr9o.onrender.com";
  // ─────────────────────────────────────────────────────────────────────────

  let _apiKey      = "";
  let _sessionId   = "";
  let _authed      = false;
  let _authStatus  = "NOT_AUTHED";
  let _lastVerdict = "NONE";

  const _violationQueue = [];
  const _kickQueue      = [];
  const _rateBuckets    = {};
  const _statSnaps      = {};
  const _statLimits     = {};
  let   _lastPos        = null;
  let   _maxPosDelta    = 9999;
  let   _pollInterval   = null;
  let   _pollMs         = 3000;

  // ── HELPERS ───────────────────────────────────────────────────────────────

  async function _post(path, body) {
    try {
      const res = await fetch(SERVER_URL + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": _apiKey,
          ...(_sessionId ? { "x-session-id": _sessionId } : {})
        },
        body: JSON.stringify({ ...body, ts: Date.now() })
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) { return null; }
  }

  function _now() { return Date.now(); }

  function _checkRate(cat) {
    const b = _rateBuckets[cat];
    if (!b) return true;
    const now = _now();
    if (now - b.windowStart > b.windowMs) { b.count = 0; b.windowStart = now; }
    if (b.count >= b.limit) return false;
    b.count++;
    return true;
  }

  function _pushViolation(reason, player) {
    _violationQueue.push({ reason, player: player || "local" });
  }

  function _startPoll() {
    if (_pollInterval) clearInterval(_pollInterval);
    _pollInterval = setInterval(async () => {
      if (!_authed) return;
      try {
        const res = await fetch(`${SERVER_URL}/poll`, {
          headers: { "x-api-key": _apiKey, "x-session-id": _sessionId }
        });
        if (!res.ok) return;
        const data = await res.json();
        (data.violations || []).forEach(v => _pushViolation(v.reason, v.playerId));
        (data.kicks      || []).forEach(k => _kickQueue.push(k));
      } catch (_) {}
    }, _pollMs);
  }

  function _stopPoll() {
    if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
  }

  // ── EXTENSION ─────────────────────────────────────────────────────────────

  class CheeseGuard {
    getInfo() {
      return {
        id: "cheeseGuard",
        name: "CheeseGuard 🛡️",
        color1: "#1a1a2e",
        color2: "#e94560",
        color3: "#0f3460",
        blocks: [

          { blockType: Scratch.BlockType.LABEL, text: "── Authentication ──" },

          {
            opcode: "authenticate",
            blockType: Scratch.BlockType.COMMAND,
            text: "authenticate with key [KEY]",
            arguments: {
              KEY: { type: Scratch.ArgumentType.STRING, defaultValue: "cg-xxxx-xxxx" }
            }
          },
          {
            opcode: "logout",
            blockType: Scratch.BlockType.COMMAND,
            text: "end session"
          },
          {
            opcode: "isAuthed",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "authenticated?"
          },
          {
            opcode: "authStatus",
            blockType: Scratch.BlockType.REPORTER,
            text: "auth status"
          },
          {
            opcode: "sessionId",
            blockType: Scratch.BlockType.REPORTER,
            text: "session ID"
          },

          { blockType: Scratch.BlockType.LABEL, text: "── Server Polling ──" },

          {
            opcode: "setPollRate",
            blockType: Scratch.BlockType.COMMAND,
            text: "poll server every [MS] ms",
            arguments: { MS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 3000 } }
          },
          {
            opcode: "stopPoll",
            blockType: Scratch.BlockType.COMMAND,
            text: "stop polling"
          },

          { blockType: Scratch.BlockType.LABEL, text: "── Action Reporting ──" },

          {
            opcode: "reportAction",
            blockType: Scratch.BlockType.COMMAND,
            text: "report action [ACTION] data [DATA]",
            arguments: {
              ACTION: { type: Scratch.ArgumentType.STRING, defaultValue: "SHOOT" },
              DATA:   { type: Scratch.ArgumentType.STRING, defaultValue: "{}" }
            }
          },
          {
            opcode: "validateAction",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "server approves action [ACTION] data [DATA]",
            arguments: {
              ACTION: { type: Scratch.ArgumentType.STRING, defaultValue: "PICKUP" },
              DATA:   { type: Scratch.ArgumentType.STRING, defaultValue: "{}" }
            }
          },
          {
            opcode: "lastVerdict",
            blockType: Scratch.BlockType.REPORTER,
            text: "last server verdict"
          },

          { blockType: Scratch.BlockType.LABEL, text: "── Rate Limiting ──" },

          {
            opcode: "setRateLimit",
            blockType: Scratch.BlockType.COMMAND,
            text: "limit [CAT] to [N] per [MS] ms",
            arguments: {
              CAT: { type: Scratch.ArgumentType.STRING, defaultValue: "SHOOT" },
              N:   { type: Scratch.ArgumentType.NUMBER, defaultValue: 5 },
              MS:  { type: Scratch.ArgumentType.NUMBER, defaultValue: 1000 }
            }
          },
          {
            opcode: "checkRate",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "[CAT] within rate limit?",
            arguments: { CAT: { type: Scratch.ArgumentType.STRING, defaultValue: "SHOOT" } }
          },

          { blockType: Scratch.BlockType.LABEL, text: "── Position Validation ──" },

          {
            opcode: "setMaxDelta",
            blockType: Scratch.BlockType.COMMAND,
            text: "set max move distance to [D]",
            arguments: { D: { type: Scratch.ArgumentType.NUMBER, defaultValue: 10 } }
          },
          {
            opcode: "snapshotPos",
            blockType: Scratch.BlockType.COMMAND,
            text: "snapshot position X [X] Y [Y]",
            arguments: {
              X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }
            }
          },
          {
            opcode: "validatePos",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "position X [X] Y [Y] is valid?",
            arguments: {
              X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 }
            }
          },

          { blockType: Scratch.BlockType.LABEL, text: "── Stat Validation ──" },

          {
            opcode: "setStatLimit",
            blockType: Scratch.BlockType.COMMAND,
            text: "max change for stat [KEY] is [D]",
            arguments: {
              KEY: { type: Scratch.ArgumentType.STRING, defaultValue: "health" },
              D:   { type: Scratch.ArgumentType.NUMBER, defaultValue: 10 }
            }
          },
          {
            opcode: "snapshotStat",
            blockType: Scratch.BlockType.COMMAND,
            text: "snapshot stat [KEY] = [V]",
            arguments: {
              KEY: { type: Scratch.ArgumentType.STRING, defaultValue: "health" },
              V:   { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 }
            }
          },
          {
            opcode: "validateStat",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "stat [KEY] changing to [V] is valid?",
            arguments: {
              KEY: { type: Scratch.ArgumentType.STRING, defaultValue: "health" },
              V:   { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 }
            }
          },

          { blockType: Scratch.BlockType.LABEL, text: "── Violations & Kicks ──" },

          {
            opcode: "onViolation",
            blockType: Scratch.BlockType.HAT,
            text: "when violation detected",
            isEdgeActivated: false
          },
          {
            opcode: "onKick",
            blockType: Scratch.BlockType.HAT,
            text: "when player kicked",
            isEdgeActivated: false
          },
          {
            opcode: "violationReason",
            blockType: Scratch.BlockType.REPORTER,
            text: "violation reason"
          },
          {
            opcode: "violationPlayer",
            blockType: Scratch.BlockType.REPORTER,
            text: "violation player"
          },
          {
            opcode: "kickedPlayer",
            blockType: Scratch.BlockType.REPORTER,
            text: "kicked player ID"
          },
          {
            opcode: "kickReason",
            blockType: Scratch.BlockType.REPORTER,
            text: "kick reason"
          },
          {
            opcode: "flagViolation",
            blockType: Scratch.BlockType.COMMAND,
            text: "flag violation [REASON] for player [ID]",
            arguments: {
              REASON: { type: Scratch.ArgumentType.STRING, defaultValue: "CHEAT" },
              ID:     { type: Scratch.ArgumentType.STRING, defaultValue: "player1" }
            }
          },
          {
            opcode: "kickPlayer",
            blockType: Scratch.BlockType.COMMAND,
            text: "kick player [ID] reason [REASON]",
            arguments: {
              ID:     { type: Scratch.ArgumentType.STRING, defaultValue: "player1" },
              REASON: { type: Scratch.ArgumentType.STRING, defaultValue: "CHEATING" }
            }
          },
          {
            opcode: "banPlayer",
            blockType: Scratch.BlockType.COMMAND,
            text: "ban player [ID] for [MINS] mins reason [REASON]",
            arguments: {
              ID:     { type: Scratch.ArgumentType.STRING, defaultValue: "player1" },
              MINS:   { type: Scratch.ArgumentType.NUMBER, defaultValue: 60 },
              REASON: { type: Scratch.ArgumentType.STRING, defaultValue: "HACKING" }
            }
          }

        ]
      };
    }

    // AUTH
    async authenticate({ KEY }) {
      _apiKey     = String(KEY).trim();
      _authed     = false;
      _authStatus = "AUTHENTICATING";
      const res   = await _post("/auth", { key: _apiKey });
      if (res && res.ok) {
        _sessionId  = res.sessionId || "";
        _authed     = true;
        _authStatus = "OK";
        _startPoll();
      } else {
        _authStatus = res ? (res.error || "REJECTED") : "UNREACHABLE";
      }
    }
    logout() {
      _post("/logout", { sessionId: _sessionId });
      _authed = false; _sessionId = ""; _authStatus = "NOT_AUTHED";
      _stopPoll();
    }
    isAuthed()    { return _authed; }
    authStatus()  { return _authStatus; }
    sessionId()   { return _sessionId; }

    // POLLING
    setPollRate({ MS }) { _pollMs = Math.max(500, Number(MS)); if (_authed) _startPoll(); }
    stopPoll()          { _stopPoll(); }

    // ACTIONS
    reportAction({ ACTION, DATA }) {
      _post("/action", { action: String(ACTION), data: String(DATA), sessionId: _sessionId });
    }
    async validateAction({ ACTION, DATA }) {
      const res    = await _post("/validate", { action: String(ACTION), data: String(DATA), sessionId: _sessionId });
      _lastVerdict = res ? (res.verdict || "UNKNOWN") : "SERVER_ERROR";
      if (res && !res.valid) _pushViolation(`INVALID:${ACTION}`, _sessionId);
      return !!(res && res.valid);
    }
    lastVerdict() { return _lastVerdict; }

    // RATE
    setRateLimit({ CAT, N, MS }) {
      _rateBuckets[String(CAT)] = { count: 0, windowStart: _now(), limit: Math.max(1, Number(N)), windowMs: Math.max(100, Number(MS)) };
    }
    checkRate({ CAT }) { return _checkRate(String(CAT)); }

    // POSITION
    setMaxDelta({ D })    { _maxPosDelta = Math.max(0, Number(D)); }
    snapshotPos({ X, Y }) { _lastPos = { x: Number(X), y: Number(Y) }; }
    validatePos({ X, Y }) {
      const nx = Number(X), ny = Number(Y);
      if (!_lastPos) { _lastPos = { x: nx, y: ny }; return true; }
      const dist = Math.hypot(nx - _lastPos.x, ny - _lastPos.y);
      if (dist > _maxPosDelta) {
        _pushViolation(`TELEPORT delta=${dist.toFixed(1)}`, _sessionId);
        _post("/violation", { reason: "TELEPORT", delta: dist, from: _lastPos, to: { x: nx, y: ny }, sessionId: _sessionId });
        return false;
      }
      _lastPos = { x: nx, y: ny };
      return true;
    }

    // STATS
    setStatLimit({ KEY, D }) { _statLimits[String(KEY)] = Math.abs(Number(D)); }
    snapshotStat({ KEY, V }) { _statSnaps[String(KEY)] = Number(V); }
    validateStat({ KEY, V }) {
      const k = String(KEY), nv = Number(V);
      const limit = _statLimits[k];
      if (limit === undefined) return true;
      const last = _statSnaps[k];
      if (last === undefined) { _statSnaps[k] = nv; return true; }
      const delta = Math.abs(nv - last);
      if (delta > limit) {
        _pushViolation(`STAT_SPIKE:${k} d=${delta}`, _sessionId);
        _post("/violation", { reason: "STAT_SPIKE", key: k, delta, from: last, to: nv, sessionId: _sessionId });
        return false;
      }
      _statSnaps[k] = nv;
      return true;
    }

    // VIOLATIONS & KICKS
    onViolation()     { return _violationQueue.length > 0; }
    onKick()          { return _kickQueue.length > 0; }
    violationReason() { const v = _violationQueue[_violationQueue.length - 1]; return v ? v.reason : ""; }
    violationPlayer() { const v = _violationQueue.shift(); return v ? v.player : ""; }
    kickedPlayer()    { const k = _kickQueue[_kickQueue.length - 1]; return k ? k.playerId : ""; }
    kickReason()      { const k = _kickQueue.shift(); return k ? k.reason : ""; }

    flagViolation({ REASON, ID }) {
      _pushViolation(String(REASON), String(ID));
      _post("/violation", { reason: String(REASON), targetId: String(ID), sessionId: _sessionId });
    }
    kickPlayer({ ID, REASON }) {
      _post("/kick", { playerId: String(ID), reason: String(REASON), sessionId: _sessionId });
    }
    banPlayer({ ID, MINS, REASON }) {
      _post("/ban", { playerId: String(ID), durationMins: Number(MINS), reason: String(REASON), sessionId: _sessionId });
    }
  }

  Scratch.extensions.register(new CheeseGuard());

})(Scratch);
