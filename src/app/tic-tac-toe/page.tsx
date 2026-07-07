"use client";

import { useState } from "react";
import { motion } from "framer-motion";

type Player = "X" | "O";
type Cell = Player | null;
type Board = Cell[];

const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function calculateWinner(board: Board): { winner: Player; line: number[] } | null {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a]!, line };
    }
  }
  return null;
}

function isDraw(board: Board): boolean {
  return board.every((cell) => cell !== null);
}

export default function TicTacToePage() {
  const [board, setBoard] = useState<Board>(Array(9).fill(null));
  const [isXNext, setIsXNext] = useState(true);
  const [status, setStatus] = useState<"playing" | "won" | "draw">("playing");
  const [winLine, setWinLine] = useState<number[] | null>(null);

  const result = calculateWinner(board);

  const handleClick = (index: number) => {
    if (board[index] || status !== "playing") return;

    const newBoard = [...board];
    newBoard[index] = isXNext ? "X" : "O";
    setBoard(newBoard);

    const gameResult = calculateWinner(newBoard);
    if (gameResult) {
      setStatus("won");
      setWinLine(gameResult.line);
    } else if (isDraw(newBoard)) {
      setStatus("draw");
    } else {
      setIsXNext(!isXNext);
    }
  };

  const resetGame = () => {
    setBoard(Array(9).fill(null));
    setIsXNext(true);
    setStatus("playing");
    setWinLine(null);
  };

  const getStatusText = () => {
    if (status === "won") return `${result!.winner} wins!`;
    if (status === "draw") return "It's a draw!";
    return `Next player: ${isXNext ? "X" : "O"}`;
  };

  const isWinningCell = (index: number) => winLine?.includes(index) ?? false;

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)] p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-6"
      >
        <h1 className="text-3xl font-bold tracking-tight">Tic Tac Toe</h1>

        <div
          className={`text-lg font-medium ${
            status === "won"
              ? "text-green-500"
              : status === "draw"
                ? "text-yellow-500"
                : "text-[var(--color-text-tertiary)]"
          }`}
        >
          {getStatusText()}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {board.map((cell, index) => (
            <motion.button
              key={index}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleClick(index)}
              className={`w-20 h-20 flex items-center justify-center text-3xl font-bold rounded-xl border transition-all duration-200 ${
                isWinningCell(index)
                  ? "border-green-500 bg-green-500/10"
                  : "border-[var(--color-border)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-hover)]"
              }`}
              disabled={!!cell || status !== "playing"}
            >
              {cell && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 15 }}
                  className={cell === "X" ? "text-blue-500" : "text-red-500"}
                >
                  {cell}
                </motion.span>
              )}
            </motion.button>
          ))}
        </div>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={resetGame}
          className="px-6 py-2.5 rounded-xl bg-[var(--color-text-primary)] text-[var(--color-text-inverse)] font-medium text-sm transition-opacity hover:opacity-90"
        >
          Reset Game
        </motion.button>
      </motion.div>
    </main>
  );
}
