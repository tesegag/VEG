const { EventEmitter } = require('events');
const logger = require('../utils/logger');

/**
 * Bridges the manual-BINGO-claim flow between the Socket.IO layer
 * (gameHandlers.js, where a `claim_bingo` event arrives from a specific
 * player's socket) and the game engine (engine.js, which is waiting inside
 * an async loop for a claim to arrive while a bingo window is open).
 *
 * One EventEmitter per process is enough — every claim carries its gameId,
 * and only one bingo window is ever open per gameId at a time.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(0);

/**
 * Called from the socket handler when a player taps "BINGO". Returns true
 * if a live window for this exact gameId/cartelaId/ownerId combination was
 * open and this claim won it, false otherwise (no window open, wrong
 * cartela, wrong owner, or the window already resolved).
 */
function submitClaim(gameId, cartelaId, ownerId) {
  const result = { accepted: false };
  emitter.emit(`claim:${gameId}`, { cartelaId, ownerId, result });
  return result.accepted;
}

/**
 * Waits up to windowMs for a valid claim against one of `candidates`
 * (each `{cartelaId, ownerId, patterns}`). Resolves with the matching
 * candidate the instant a valid claim arrives, or null if the window
 * times out first. Only the first valid claim wins the race — once
 * settled, later claims for this gameId are ignored by this window.
 */
function waitForClaim(gameId, candidates, windowMs) {
  return new Promise((resolve) => {
    const byCartelaId = new Map(candidates.map((c) => [c.cartelaId, c]));
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      emitter.removeListener(`claim:${gameId}`, onClaim);
      resolve(null);
    }, windowMs);

    function onClaim({ cartelaId, ownerId, result }) {
      if (settled) return;
      const candidate = byCartelaId.get(cartelaId);
      if (!candidate || candidate.ownerId !== ownerId) return;

      result.accepted = true;
      settled = true;
      clearTimeout(timer);
      emitter.removeListener(`claim:${gameId}`, onClaim);
      logger.info('BINGO claim accepted', { gameId, cartelaId, ownerId });
      resolve(candidate);
    }

    emitter.on(`claim:${gameId}`, onClaim);
  });
}

module.exports = { submitClaim, waitForClaim };
