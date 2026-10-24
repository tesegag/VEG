'use client';
import { useEffect, useState, useCallback } from 'react';

const LETTERS = ['B', 'I', 'N', 'G', 'O'];
export function letterFor(number) {
  return LETTERS[Math.floor((number - 1) / 15)];
}

/**
 * Joins a game room and keeps local state in sync with every server-pushed
 * event (§2.3). One hook instance = one game room subscription.
 */
export function useGameState(socket, connected, gameId, initialStake = null) {
  const [status, setStatus] = useState(null);
  const [stake, setStake] = useState(initialStake);
  const [playersCount, setPlayersCount] = useState(0);
  const [totalCartelas, setTotalCartelas] = useState(0);
  const [prizePool, setPrizePool] = useState(null);
  const [grossPrizePool, setGrossPrizePool] = useState(0);
  const [calledNumbers, setCalledNumbers] = useState([]);
  const [lastCalled, setLastCalled] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [winners, setWinners] = useState(null);
  const [cartelaEvents, setCartelaEvents] = useState({}); // cartelaId -> status
  // Manual BINGO claim window: { candidates: [{cartelaId, ownerId, patterns}], windowMs, openedAt } | null.
  // Cleared the instant the window closes/expires or the next number is called.
  const [bingoWindow, setBingoWindow] = useState(null);

  useEffect(() => {
    if (!socket || !connected || !gameId) return undefined;

    socket.emit('join_game', { gameId });

    const onState = (payload) => {
      if (payload.gameId && payload.gameId !== gameId) return;
      setStatus(payload.status);
      setStake(payload.stake ?? null);
      setPlayersCount(payload.playersCount ?? 0);
      setTotalCartelas(payload.totalCartelas ?? 0);
      setPrizePool(payload.prizePool ?? null);
      setGrossPrizePool(payload.grossPrizePool ?? 0);
    };
    const onNumberDrawn = (payload) => {
      setLastCalled(payload);
      setCalledNumbers((prev) => (prev.includes(payload.number) ? prev : [...prev, payload.number]));
      // A new number being called always means any prior claim window is
      // over (the server never lets a window outlive the next call).
      setBingoWindow(null);
    };
    const onCountdown = (payload) => setCountdown(payload.remainingSeconds);
    const onCartelaUpdate = (payload) => {
      const ids = payload.cartelaIds || (payload.cartelaId != null ? [payload.cartelaId] : []);
      setCartelaEvents((prev) => {
        const next = { ...prev };
        ids.forEach((id) => { next[id] = payload.status; });
        return next;
      });
    };
    const onWinner = (payload) => {
      setWinners(payload);
      setBingoWindow(null);
    };
    const onCycle = () => {
      setCalledNumbers([]);
      setBingoWindow(null);
    };
    const onBingoWindowOpen = (payload) => {
      setBingoWindow({ candidates: payload.candidates || [], windowMs: payload.windowMs, openedAt: Date.now() });
    };
    const onBingoWindowClosed = () => setBingoWindow(null);

    socket.on('game_state_update', onState);
    socket.on('number_drawn', onNumberDrawn);
    socket.on('countdown_update', onCountdown);
    socket.on('cartela_update', onCartelaUpdate);
    socket.on('winner_announcement', onWinner);
    socket.on('game_cycle_update', onCycle);
    socket.on('bingo_window_open', onBingoWindowOpen);
    socket.on('bingo_window_closed', onBingoWindowClosed);

    return () => {
      socket.emit('leave_game', { gameId });
      socket.off('game_state_update', onState);
      socket.off('number_drawn', onNumberDrawn);
      socket.off('countdown_update', onCountdown);
      socket.off('cartela_update', onCartelaUpdate);
      socket.off('winner_announcement', onWinner);
      socket.off('game_cycle_update', onCycle);
      socket.off('bingo_window_open', onBingoWindowOpen);
      socket.off('bingo_window_closed', onBingoWindowClosed);
    };
  }, [socket, connected, gameId]);

  const refresh = useCallback(() => {
    if (socket && gameId) socket.emit('refresh_state', { gameId });
  }, [socket, gameId]);

  // Taps BINGO for one of the player's own cartelas. The server is the sole
  // authority on whether this actually wins (open window + right cartela) —
  // this just fires the claim; a real win arrives via winner_announcement.
  const claimBingo = useCallback((cartelaId) => {
    if (!socket || !gameId) return;
    socket.emit('claim_bingo', { gameId, cartelaId });
  }, [socket, gameId]);

  return {
    status, stake, playersCount, totalCartelas, prizePool, grossPrizePool,
    calledNumbers, lastCalled, countdown, winners, cartelaEvents, bingoWindow, claimBingo, refresh
  };
}
