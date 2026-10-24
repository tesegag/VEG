const { Game } = require('../models');
const cartelaService = require('../services/cartelaService');
const bingoClaims = require('../game/bingoClaims');
const logger = require('../utils/logger');

async function sendFullState(socket, gameId) {
  const game = await Game.findOne({ gameId });
  if (!game) return;
  const { real, admin, total } = await cartelaService.countSold(gameId);
  socket.emit('game_state_update', {
    gameId: game.gameId,
    status: game.status,
    stake: game.stake,
    playersCount: real,
    totalCartelas: total,
    adminCartelas: admin,
    currentDrawIndex: game.currentDrawIndex,
    prizePool: game.prizePool ?? null,
    grossPrizePool: game.grossPrizePool ?? 0
  });
}

function registerGameHandlers(io, socket) {
  socket.on('join_game', async ({ gameId }) => {
    if (!gameId) return;
    socket.join(`game:${gameId}`);
    socket.currentGameId = gameId;
    logger.info('Socket joined game room', { userId: socket.userId, gameId });
    await sendFullState(socket, gameId);
  });

  socket.on('leave_game', ({ gameId }) => {
    if (gameId) socket.leave(`game:${gameId}`);
    socket.currentGameId = null;
  });

  // Lightweight presence signal only — the real, money-moving purchase goes
  // through POST /api/cartela/purchase (§8.6), which itself broadcasts the
  // persisted cartela_update once the atomic purchase succeeds. This event
  // just lets other players see "someone is looking at this cartela" live.
  socket.on('select_cartela', ({ gameId, cartelaId }) => {
    if (!gameId || !cartelaId) return;
    socket.to(`game:${gameId}`).emit('cartela_update', {
      gameId,
      cartelaId,
      status: 'previewing',
      ownerId: null
    });
  });

  // Manual BINGO claim (§ manual claim redesign): fired when the player
  // taps their BINGO button while it's live for that cartela. The engine
  // (engine.js, via bingoClaims.js) is the sole authority on whether a
  // claim window is actually open and whether this cartela is on it —
  // ownership is taken from the authenticated socket, never trusted from
  // the client payload, so a claim can only ever win the player's own
  // cartela.
  socket.on('claim_bingo', ({ gameId, cartelaId } = {}, ack) => {
    if (!gameId || cartelaId == null) {
      if (typeof ack === 'function') ack({ ok: false, error: 'INVALID_CLAIM' });
      return;
    }
    const accepted = bingoClaims.submitClaim(gameId, Number(cartelaId), socket.userId);
    logger.info('BINGO claim received', { userId: socket.userId, gameId, cartelaId, accepted });
    if (typeof ack === 'function') ack({ ok: accepted });
  });

  socket.on('refresh_state', async ({ gameId } = {}) => {
    await sendFullState(socket, gameId || socket.currentGameId);
  });
}

module.exports = registerGameHandlers;
