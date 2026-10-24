'use client';
import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthGate from '../../../components/AuthGate';
import { useWebSocket } from '../../../hooks/useWebSocket';
import { useGameState } from '../../../hooks/useGameState';
import { api } from '../../../lib/api';
import { hapticFeedback, notifyHaptic } from '../../../lib/telegram';

// --- CONSTANTS ---
const LETTERS = ['B', 'I', 'N', 'G', 'O'];
const COLUMN_ACCENTS = {
  B: { text: 'text-sky-400', solid: 'bg-sky-500', soft: 'bg-sky-500/15 border-sky-500/40', ring: 'ring-sky-400' },
  I: { text: 'text-violet-400', solid: 'bg-violet-500', soft: 'bg-violet-500/15 border-violet-500/40', ring: 'ring-violet-400' },
  N: { text: 'text-pink-400', solid: 'bg-pink-500', soft: 'bg-pink-500/15 border-pink-500/40', ring: 'ring-pink-400' },
  G: { text: 'text-emerald-400', solid: 'bg-emerald-500', soft: 'bg-emerald-500/15 border-emerald-500/40', ring: 'ring-emerald-400' },
  O: { text: 'text-amber-400', solid: 'bg-amber-500', soft: 'bg-amber-500/15 border-amber-400/40', ring: 'ring-amber-400' }
};

function letterFor(n) {
  return LETTERS[Math.floor((n - 1) / 15)];
}

const EMPTY_SET = new Set();
// A called number can only be manually daubed within this window of being
// called — after it elapses, tapping does nothing (the number is "expired").
const DAUB_WINDOW_MS = 5000;

function LiveContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const gameId = searchParams.get('gameId');
  const { socket, connected } = useWebSocket();
  const gameState = useGameState(socket, connected, gameId);

  const [myCartelas, setMyCartelas] = useState([]);
  const [cartelasLoaded, setCartelasLoaded] = useState(false);
  const [manualMarks, setManualMarks] = useState({}); // cartelaId -> Set of manually-daubed numbers
  const [expiredNumbers, setExpiredNumbers] = useState(EMPTY_SET); // numbers whose 5s daub window has elapsed
  const [navigatedAway, setNavigatedAway] = useState(false);
  const daubTimers = useRef(new Map()); // number -> timeout id, so we never double-schedule

  useEffect(() => {
    if (!gameId) return;
    // Fresh round — clear any daub state and pending timers from the previous one.
    setManualMarks({});
    setExpiredNumbers(new Set());
    daubTimers.current.forEach((id) => clearTimeout(id));
    daubTimers.current.clear();
    api
      .getMyCartelas(gameId)
      .then(({ cartelas }) => setMyCartelas(cartelas))
      .catch(() => {})
      .finally(() => setCartelasLoaded(true));
  }, [gameId]);

  // Manual daubing (fully replaces auto-daub): the instant a number is
  // called, it becomes tappable for exactly DAUB_WINDOW_MS. Once that timer
  // fires, the number is locked — a tap after that does nothing, even
  // though the number was genuinely called.
  useEffect(() => {
    const n = gameState.lastCalled?.number;
    if (n == null || daubTimers.current.has(n)) return;
    const id = setTimeout(() => {
      setExpiredNumbers((prev) => (prev.has(n) ? prev : new Set(prev).add(n)));
      daubTimers.current.delete(n);
    }, DAUB_WINDOW_MS);
    daubTimers.current.set(n, id);
  }, [gameState.lastCalled]);

  useEffect(() => {
    const timers = daubTimers.current;
    return () => timers.forEach((id) => clearTimeout(id));
  }, []);

  const handleRefresh = () => {
    if (!gameId) return;
    setCartelasLoaded(false);
    api
      .getMyCartelas(gameId)
      .then(({ cartelas }) => setMyCartelas(cartelas))
      .catch(() => {})
      .finally(() => setCartelasLoaded(true));
  };

  // Restored to the original flow: SETTLING/COMPLETED (or a winner payload)
  // routes to the dedicated winner-announcement page, same as before.
  useEffect(() => {
    if (navigatedAway) return;
    if (gameState.winners || gameState.status === 'COMPLETED' || gameState.status === 'SETTLING') {
      notifyHaptic('success');
      setNavigatedAway(true);
      router.replace(`/game/winner?gameId=${gameId}`);
    }
  }, [gameState.winners, gameState.status, gameId, router, navigatedAway]);

  const markedSet = useMemo(() => new Set(gameState.calledNumbers), [gameState.calledNumbers]);
  const netPrizePool = gameState.grossPrizePool ? Math.floor(gameState.grossPrizePool * 0.85) : 0;
  const isSpectator = cartelasLoaded && myCartelas.length === 0;

  // Fully manual daubing: a tap only does something for a number that has
  // been called AND is still inside its DAUB_WINDOW_MS window. Once that
  // window elapses the number is locked — no amount of tapping marks it.
  // Server-side winner detection always runs off the actually-called
  // numbers regardless (§4.7/§6.6) — daubing is purely visual/interactive.
  const toggleManualDaub = (cartelaId, number) => {
    if (!markedSet.has(number) || expiredNumbers.has(number)) return;
    hapticFeedback('light');
    setManualMarks((prev) => {
      const current = new Set(prev[cartelaId]);
      current.add(number); // one-way: once daubed within the window, stays daubed
      return { ...prev, [cartelaId]: current };
    });
  };

  const handleBingoTap = (cartelaId) => {
    hapticFeedback('medium');
    gameState.claimBingo(cartelaId);
  };

  // Get last 10 called numbers for recent calls display
  const recentCalls = useMemo(() => {
    return [...gameState.calledNumbers].reverse().slice(0, 10);
  }, [gameState.calledNumbers]);

  return (
    <div className="flex flex-col h-screen max-h-screen bg-[#0F1115] overflow-hidden">
      {/* --- 1. TOP HEADER & STATS --- */}
      <header className="px-3 py-2.5 bg-[#1A1D24] border-b border-[#2A2F3A] flex items-center gap-2 shrink-0">
        <div className="flex items-center gap-3 flex-1">
          <StatChip label="Game" value={gameId?.slice(-8) || '—'} tone="sky" compact />
          <StatChip label="መደብ" value={gameState.stake ?? '—'} tone="sky" compact />
          <StatChip label="Players" value={gameState.playersCount ?? 0} tone="gold" compact />
          <StatChip label="ደራሽ" value={netPrizePool ? `${netPrizePool.toLocaleString()} ብር` : '—'} tone="gold" compact />
          <StatChip label="Called" value={gameState.calledNumbers.length} tone="emerald" compact />
        </div>
      </header>

      {/* --- 2. MAIN SPLIT LAYOUT --- */}
      <div className="flex flex-1 overflow-hidden p-2 gap-2">
        {/* Caller board - full height */}
        <div className="flex-1 bg-[#1A1D24] rounded-xl border border-[#2A2F3A] p-2 overflow-hidden flex flex-col">
          <CallerBoard calledNumbers={gameState.calledNumbers} lastCalled={gameState.lastCalled} />
        </div>

        {/* Right panel - current ball, recent calls + cartelas */}
        <div className="w-[45%] flex flex-col gap-2 overflow-hidden">
          {/* Current Ball + Recent calls row */}
          <div className="shrink-0 bg-[#1A1D24] rounded-xl border border-[#2A2F3A] p-2 flex items-center gap-3">
            {/* Circular number calling display */}
            <CurrentBallDisplay lastCalled={gameState.lastCalled} />

            {/* Recent calls strip */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[9px] text-mute font-medium uppercase tracking-wide">Recent</span>
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400/60" />
                <span className="text-[9px] text-amber-400 font-mono">#{gameState.calledNumbers.length}</span>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                {recentCalls.length === 0 ? (
                  <span className="text-mute text-[10px]">Waiting for first call...</span>
                ) : (
                  recentCalls.map((n) => {
                    const accent = COLUMN_ACCENTS[letterFor(n)];
                    return (
                      <div
                        key={n}
                        className={`shrink-0 px-2.5 h-6 rounded-full border flex items-center justify-center text-[10px] font-bold font-mono ${accent.soft} ${accent.text}`}
                      >
                        {n}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Cartelas - scrollable */}
          <div className="flex-1 overflow-y-auto pr-1 pb-1 space-y-2">
            {!cartelasLoaded ? (
              <p className="text-center text-mute text-sm py-10">Loading cartela…</p>
            ) : isSpectator ? (
              <NoCartelasBoughtPlaceholder />
            ) : (
              myCartelas.map((c) => (
                <CartelaCard
                  key={c.cartelaId}
                  cartela={c}
                  calledSet={markedSet}
                  expiredSet={expiredNumbers}
                  manualMarked={manualMarks[c.cartelaId] || EMPTY_SET}
                  onCellTap={(number) => toggleManualDaub(c.cartelaId, number)}
                  onBingoTap={() => handleBingoTap(c.cartelaId)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      {/* --- 3. BOTTOM BUTTONS --- */}
      <div className="flex gap-2 p-3 bg-[#1A1D24] border-t border-[#2A2F3A] shrink-0">
        <button
          onClick={() => router.push(`/game/lobby?stake=${gameState.stake}`)}
          className="flex-1 py-3 rounded-lg text-sm font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30 active:scale-[0.98] transition-transform"
        >
          Back
        </button>
        <button
          onClick={handleRefresh}
          className="flex-1 py-3 rounded-lg text-sm font-bold bg-[#2E3440] text-ivory border border-[#3A4050] active:scale-[0.98] transition-transform"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}

// --- COMPONENT: STAT CHIP ---
function StatChip({ label, value, tone, compact }) {
  const tones = {
    slate: 'bg-[#252A34] border-[#3A4050] text-ivory',
    sky: 'bg-sky-500/10 border-sky-500/30 text-sky-300',
    gold: 'bg-gradient-to-br from-amber-500/20 to-amber-600/10 border-amber-400/40 text-amber-300',
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
  };
  return (
    <div className={`rounded-lg border px-2 py-1 text-center ${tones[tone]} ${compact ? 'flex-1' : ''}`}>
      <p className="text-[8px] uppercase tracking-wide opacity-70 font-medium">{label}</p>
      <p className={`font-mono font-extrabold leading-none ${compact ? 'text-xs' : 'text-sm'}`}>{value}</p>
    </div>
  );
}

// --- COMPONENT: CURRENT BALL DISPLAY (Circular) ---
function CurrentBallDisplay({ lastCalled }) {
  if (!lastCalled) {
    return (
      <div className="w-14 h-14 rounded-full flex flex-col items-center justify-center shrink-0 bg-gradient-to-br from-[#2E3440] to-[#252A34] border-2 border-[#3A4050]">
        <span className="text-white/40 font-extrabold text-[10px]">?</span>
        <span className="text-white/40 font-extrabold text-sm">--</span>
      </div>
    );
  }

  const accent = COLUMN_ACCENTS[lastCalled.letter];

  return (
    <div className="relative shrink-0">
      <div className={`w-14 h-14 rounded-full flex flex-col items-center justify-center bg-gradient-to-br ${accent.solid} shadow-lg ring-4 ${accent.ring}/30 transition-all duration-300 animate-popIn`}>
        <span className="text-white/90 font-extrabold text-[10px]">{lastCalled.letter}</span>
        <span className="text-white font-extrabold text-xl leading-none">{lastCalled.number}</span>
      </div>
      {/* Glow effect ring */}
      <div className={`absolute inset-0 rounded-full ${accent.ring}/20 animate-ping pointer-events-none`} style={{ animationDuration: '2s' }} />
    </div>
  );
}

// --- COMPONENT: MASTER CALLER BOARD ---
function CallerBoard({ calledNumbers, lastCalled }) {
  const markedSet = new Set(calledNumbers);
  const lastCallNum = lastCalled?.number;
  const rows = Array.from({ length: 15 }, (_, i) => i + 1);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="grid grid-cols-5 gap-[3px] mb-[3px] shrink-0">
        {LETTERS.map((l) => (
          <div
            key={l}
            className={`text-center text-sm font-extrabold py-1.5 rounded ${COLUMN_ACCENTS[l].solid} text-white shadow-sm`}
          >
            {l}
          </div>
        ))}
      </div>

      <div
        className="grid grid-cols-5 gap-[3px] flex-1 min-h-0"
        style={{ gridTemplateRows: 'repeat(15, minmax(0, 1fr))' }}
      >
        {rows.flatMap((rowNum) => {
          return Array.from({ length: 5 }, (_, colIndex) => {
            const num = rowNum + colIndex * 15;
            const isCalled = markedSet.has(num);
            const isLast = lastCallNum === num;
            const accent = COLUMN_ACCENTS[LETTERS[colIndex]];
            return (
              <div
                key={num}
                className={[
                  'w-full h-full flex items-center justify-center text-xs font-mono font-bold rounded bg-[#252A34] text-ivory transition-all duration-200',
                  isCalled ? 'bg-amber-300 text-[#111]' : '',
                  isLast ? `!bg-white !text-[#111] scale-105 shadow-lg ring-2 ${accent.ring} z-10` : ''
                ].join(' ')}
              >
                {num}
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}

// --- COMPONENT: NO CARTELAS BOUGHT (spectator state) ---
// Shown in the space where the player's cartela card(s) would normally sit,
// for a player who reached the live round without buying a cartela. They
// can still watch every number get called live — matching the "Watching
// Only" pattern from Beteseb Bingo — instead of being locked out entirely.
function NoCartelasBoughtPlaceholder() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center px-3 py-8 bg-[#1A1D24] rounded-xl border border-[#2A2F3A]">
      <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-2xl mb-3">
        🎟️
      </div>
      <p className="text-ivory font-bold text-sm mb-2">WATCHING ONLY</p>
      <p className="text-mute text-xs leading-relaxed">
        You can still watch this round live.
        <br />
        A new round starts automatically when it ends.
      </p>
    </div>
  );
}

// --- COMPONENT: CARTELA CARD ---
// Fully manual daubing: a called number is tappable for DAUB_WINDOW_MS only.
// Tapping in time daubs it (amber); missing the window locks it — same
// plain look as any other undaubed cell, deliberately with no extra visual
// cue, since the whole point of manual mode is that nothing hints at what
// to tap or that a window is closing. Server-side winner detection runs
// off the real called numbers regardless (§4.7/§6.6) — daubing itself is
// purely visual — but actually winning now requires a manual BINGO tap.
function CartelaCard({ cartela, calledSet, expiredSet, manualMarked, onCellTap, onBingoTap }) {
  return (
    <div
      className={`rounded-xl border p-2 ${
        cartela.isWinner ? 'border-amber-400 bg-amber-400/10 shadow-lg shadow-amber-400/10' : 'border-[#2A2F3A] bg-[#1A1D24]'
      }`}
    >
      <div className="flex justify-between items-center mb-2 px-1">
        <span className="text-amber-400 text-xs font-extrabold">#{cartela.cartelaId}</span>
        {cartela.isWinner && <span className="text-[10px] text-amber-400 font-extrabold animate-pulse">🏆 WINNER</span>}
      </div>

      <div className="grid grid-cols-5 gap-[3px]">
        {/* B I N G O headers with bold fonts and colored cells */}
        {LETTERS.map((l) => {
          const accent = COLUMN_ACCENTS[l];
          return (
            <div
              key={l}
              className={`text-center text-xs font-extrabold py-1 rounded ${accent.solid} text-white shadow-sm`}
            >
              {l}
            </div>
          );
        })}

        {cartela.grid.map((row, r) =>
          row.map((cell, c) => {
            const isFree = cell === null;
            const isCalled = isFree || calledSet.has(cell);
            const isDaubed = isFree || manualMarked.has(cell);
            const isExpired = !isFree && expiredSet.has(cell);
            // Tappable only while the number is called, not yet daubed, and
            // still inside its 5s window. No styling distinguishes this
            // from a plain uncalled cell — the player has to know.
            const isClickable = !isFree && isCalled && !isDaubed && !isExpired;
            const colAccent = COLUMN_ACCENTS[LETTERS[c]];

            return (
              <div
                key={`${r}-${c}`}
                onClick={isClickable ? () => onCellTap(cell) : undefined}
                role={isClickable ? 'button' : undefined}
                className={[
                  'aspect-square rounded flex items-center justify-center text-xs font-mono font-bold transition-colors',
                  isFree
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : isDaubed
                    ? 'bg-amber-400 text-ink'
                    : `bg-[#252A34] ${colAccent.text}${isClickable ? ' cursor-pointer' : ''}`
                ].join(' ')}
              >
                {isFree ? '★' : cell}
              </div>
            );
          })
        )}
      </div>

      <BingoButton onTap={onBingoTap} />
    </div>
  );
}

// --- COMPONENT: BINGO BUTTON ---
// Sits under every purchased cartela, always the same plain blue, always
// tappable — no color change, glow, disabled state, countdown, or
// animation to hint whether a claim window is actually open for this
// cartela right now. Every tap just sends the claim; the server is the
// sole authority on whether it actually lands (a tap with no open window
// for this cartela is simply a no-op there).
function BingoButton({ onTap }) {
  return (
    <button
      onClick={onTap}
      className="w-full mt-2 py-2.5 rounded-lg text-sm font-extrabold tracking-wide bg-sky-500 text-white active:scale-[0.97] transition-transform"
    >
      BINGO
    </button>
  );
}

export default function LivePage() {
  return (
    <AuthGate hideNav>
      <LiveContent />
    </AuthGate>
  );
}
