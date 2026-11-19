"use strict";

const PIECES = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟"
};
const PROMOTIONS = ["Q", "R", "B", "N"];
const FILES = "abcdefgh";
const boardElement = document.querySelector("#board");
const statusText = document.querySelector("#status-text");
const statusIcon = document.querySelector("#status-icon");
const moveList = document.querySelector("#moves-list");
const moveCount = document.querySelector("#move-count");
const undoButton = document.querySelector("#undo-button");
const promotionOverlay = document.querySelector("#promotion-overlay");
const promotionChoices = document.querySelector("#promotion-choices");
const homeScreen = document.querySelector("#home-screen");
const friendSetupScreen = document.querySelector("#friend-setup-screen");
const gameScreen = document.querySelector("#game-screen");
const homeButton = document.querySelector("#home-button");
const setupError = document.querySelector("#setup-error");
const onlinePanel = document.querySelector("#online-panel");
const joinRoomForm = document.querySelector("#join-room-form");
const roomCodeInput = document.querySelector("#room-code-input");
const roomInfo = document.querySelector("#room-info");
const roomCodeOutput = document.querySelector("#room-code-output");
const onlineStatus = document.querySelector("#online-status");
const onlineError = document.querySelector("#online-error");
const copyRoomButton = document.querySelector("#copy-room-button");
const timeMinutesInput = document.querySelector("#time-minutes");
const unlimitedTimeInput = document.querySelector("#unlimited-time");
const creatorColorInput = document.querySelector("#creator-color");
const autoFinishToggle = document.querySelector("#auto-finish-toggle");
const submitMoveButton = document.querySelector("#submit-move-button");
const takebackControls = document.querySelector("#takeback-controls");
const takebackMessage = document.querySelector("#takeback-message");
const acceptTakebackButton = document.querySelector("#accept-takeback-button");
const declineTakebackButton = document.querySelector("#decline-takeback-button");
const cancelTakebackButton = document.querySelector("#cancel-takeback-button");

function initialState() {
  return {
    board: [
      ["r", "n", "b", "q", "k", "b", "n", "r"],
      Array(8).fill("p"),
      Array(8).fill(null), Array(8).fill(null),
      Array(8).fill(null), Array(8).fill(null),
      Array(8).fill("P"),
      ["R", "N", "B", "Q", "K", "B", "N", "R"]
    ],
    turn: "w",
    castling: { K: true, Q: true, k: true, q: true },
    enPassant: null,
    history: [],
    lastMove: null
  };
}

let state = initialState();
let selected = null;
let selectedMoves = [];
let undoStack = [];
let pendingPromotion = null;
let pendingMove = null;
let gameMode = null;
let viewColor = "w";
let botThinking = false;
let botTimer = null;
let onlineRoom = null;
let roomVersion = 0;
let roomPolling = false;
let movePending = false;
let opponentJoined = false;
let pollTimer = null;
let clockSnapshot = null;
let clockTimer = null;
let takebackRequestBy = null;
let onlineGameStatus = null;
let onlineResult = null;
let onlineFinishReason = null;
const savedAutoFinish = window.localStorage.getItem("schach-auto-finish");
autoFinishToggle.checked = savedAutoFinish === null ? true : savedAutoFinish === "true";

const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const colorOf = piece => piece === null ? null : piece === piece.toUpperCase() ? "w" : "b";
const squareName = ([r, c]) => `${FILES[c]}${8 - r}`;
const opposite = color => color === "w" ? "b" : "w";

function clonePosition(position) {
  return {
    board: position.board.map(row => row.slice()),
    turn: position.turn,
    castling: { ...position.castling },
    enPassant: position.enPassant ? [...position.enPassant] : null,
    history: position.history.slice(),
    lastMove: position.lastMove ? {
      from: [...position.lastMove.from],
      to: [...position.lastMove.to]
    } : null
  };
}

function findKing(board, color) {
  const king = color === "w" ? "K" : "k";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === king) return [r, c];
    }
  }
  return null;
}

function isAttacked(board, r, c, byColor) {
  const pawnRow = r + (byColor === "w" ? 1 : -1);
  const pawn = byColor === "w" ? "P" : "p";
  for (const dc of [-1, 1]) {
    if (inside(pawnRow, c + dc) && board[pawnRow][c + dc] === pawn) return true;
  }

  const knight = byColor === "w" ? "N" : "n";
  for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
    if (inside(r + dr, c + dc) && board[r + dr][c + dc] === knight) return true;
  }

  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    let nr = r + dr;
    let nc = c + dc;
    let distance = 1;
    while (inside(nr, nc)) {
      const piece = board[nr][nc];
      if (piece) {
        if (colorOf(piece) === byColor) {
          const type = piece.toUpperCase();
          if (distance === 1 && type === "K") return true;
          if (type === "Q" || (dr === 0 || dc === 0 ? type === "R" : type === "B")) return true;
        }
        break;
      }
      nr += dr;
      nc += dc;
      distance++;
    }
  }
  return false;
}

function inCheck(position, color) {
  const king = findKing(position.board, color);
  return king ? isAttacked(position.board, king[0], king[1], opposite(color)) : false;
}

function pseudoMoves(position, r, c) {
  const { board, turn, castling, enPassant } = position;
  const piece = board[r][c];
  if (!piece || colorOf(piece) !== turn) return [];
  const type = piece.toUpperCase();
  const color = turn;
  const moves = [];
  const add = (toR, toC, extras = {}) => {
    if (!inside(toR, toC)) return;
    const target = board[toR][toC];
    if (target && (colorOf(target) === color || target.toUpperCase() === "K")) return;
    moves.push({ from: [r, c], to: [toR, toC], ...extras });
  };

  if (type === "P") {
    const direction = color === "w" ? -1 : 1;
    const startRow = color === "w" ? 6 : 1;
    const promotionRow = color === "w" ? 0 : 7;
    const one = r + direction;
    if (inside(one, c) && !board[one][c]) {
      if (one === promotionRow) {
        for (const promotion of PROMOTIONS) moves.push({ from: [r, c], to: [one, c], promotion });
      } else {
        add(one, c);
        const two = r + 2 * direction;
        if (r === startRow && !board[two][c]) moves.push({ from: [r, c], to: [two, c], doublePawn: true });
      }
    }
    for (const dc of [-1, 1]) {
      const nr = r + direction;
      const nc = c + dc;
      if (!inside(nr, nc)) continue;
      const target = board[nr][nc];
      if (target && colorOf(target) === opposite(color) && target.toUpperCase() !== "K") {
        if (nr === promotionRow) {
          for (const promotion of PROMOTIONS) moves.push({ from: [r, c], to: [nr, nc], promotion });
        } else {
          moves.push({ from: [r, c], to: [nr, nc] });
        }
      } else if (enPassant && enPassant[0] === nr && enPassant[1] === nc) {
        moves.push({ from: [r, c], to: [nr, nc], enPassant: true });
      }
    }
  } else if (type === "N") {
    for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) add(r + dr, c + dc);
  } else if (type === "K") {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr || dc) add(r + dr, c + dc);
      }
    }
    const home = color === "w" ? 7 : 0;
    const enemy = opposite(color);
    if (r === home && c === 4 && !inCheck(position, color)) {
      if (castling[color === "w" ? "K" : "k"] && board[home][5] === null && board[home][6] === null &&
          board[home][7] === (color === "w" ? "R" : "r") &&
          !isAttacked(board, home, 5, enemy) && !isAttacked(board, home, 6, enemy)) {
        moves.push({ from: [r, c], to: [home, 6], castle: "king" });
      }
      if (castling[color === "w" ? "Q" : "q"] && board[home][1] === null && board[home][2] === null &&
          board[home][3] === null && board[home][0] === (color === "w" ? "R" : "r") &&
          !isAttacked(board, home, 3, enemy) && !isAttacked(board, home, 2, enemy)) {
        moves.push({ from: [r, c], to: [home, 2], castle: "queen" });
      }
    }
  } else {
    const directions = [];
    if (type === "R" || type === "Q") directions.push([-1, 0], [1, 0], [0, -1], [0, 1]);
    if (type === "B" || type === "Q") directions.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
    for (const [dr, dc] of directions) {
      let nr = r + dr;
      let nc = c + dc;
      while (inside(nr, nc)) {
        const target = board[nr][nc];
        if (!target) {
          moves.push({ from: [r, c], to: [nr, nc] });
        } else {
          if (colorOf(target) !== color && target.toUpperCase() !== "K") add(nr, nc);
          break;
        }
        nr += dr;
        nc += dc;
      }
    }
  }
  return moves;
}

function applyMove(position, move) {
  const next = clonePosition(position);
  const board = next.board;
  const [fromR, fromC] = move.from;
  const [toR, toC] = move.to;
  const piece = board[fromR][fromC];
  const captured = move.enPassant ? board[fromR][toC] : board[toR][toC];

  if (piece === "K") next.castling.K = next.castling.Q = false;
  if (piece === "k") next.castling.k = next.castling.q = false;
  if (piece === "R" && fromR === 7 && fromC === 0) next.castling.Q = false;
  if (piece === "R" && fromR === 7 && fromC === 7) next.castling.K = false;
  if (piece === "r" && fromR === 0 && fromC === 0) next.castling.q = false;
  if (piece === "r" && fromR === 0 && fromC === 7) next.castling.k = false;
  if (captured === "R" && toR === 7 && toC === 0) next.castling.Q = false;
  if (captured === "R" && toR === 7 && toC === 7) next.castling.K = false;
  if (captured === "r" && toR === 0 && toC === 0) next.castling.q = false;
  if (captured === "r" && toR === 0 && toC === 7) next.castling.k = false;

  board[fromR][fromC] = null;
  if (move.enPassant) board[fromR][toC] = null;
  board[toR][toC] = move.promotion ? (next.turn === "w" ? move.promotion : move.promotion.toLowerCase()) : piece;
  if (move.castle === "king") {
    board[toR][5] = board[toR][7];
    board[toR][7] = null;
  } else if (move.castle === "queen") {
    board[toR][3] = board[toR][0];
    board[toR][0] = null;
  }
  next.enPassant = move.doublePawn ? [(fromR + toR) / 2, fromC] : null;
  next.lastMove = { from: [...move.from], to: [...move.to] };
  next.turn = opposite(position.turn);
  return next;
}

function legalMoves(position, r, c) {
  return pseudoMoves(position, r, c).filter(move => !inCheck(applyMove(position, move), position.turn));
}

function legalMovesForColor(position, r, c) {
  const color = colorOf(position.board[r][c]);
  if (!color) return [];
  const viewPosition = position.turn === color
    ? position
    : { ...position, turn: color, enPassant: null };
  return legalMoves(viewPosition, r, c);
}

function allLegalMoves(position) {
  const moves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (colorOf(position.board[r][c]) === position.turn) moves.push(...legalMoves(position, r, c));
    }
  }
  return moves;
}

function render() {
  boardElement.replaceChildren();
  const displayState = pendingMove ? applyMove(state, pendingMove) : state;
  const checkedKing = inCheck(state, state.turn) ? findKing(state.board, state.turn) : null;

  const rows = viewColor === "b" ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const columns = viewColor === "b" ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  for (const r of rows) {
    for (const c of columns) {
      const square = document.createElement("button");
      square.type = "button";
      square.className = `square ${(r + c) % 2 === 0 ? "light" : "dark"}`;
      square.setAttribute("role", "gridcell");
      square.dataset.row = String(r);
      square.dataset.col = String(c);
      const piece = displayState.board[r][c];
      square.setAttribute("aria-label", `${squareName([r, c])}${piece ? ` ${pieceName(piece)}` : ""}`);
      if (selected && selected[0] === r && selected[1] === c) square.classList.add("selected");
      const highlightedMove = pendingMove || state.lastMove;
      if (highlightedMove && [highlightedMove.from, highlightedMove.to].some(([lr, lc]) => lr === r && lc === c)) {
        square.classList.add(pendingMove ? "pending-move" : "last-move");
      }
      if (checkedKing && checkedKing[0] === r && checkedKing[1] === c) square.classList.add("in-check");

      const movesHere = selectedMoves.filter(move => move.to[0] === r && move.to[1] === c);
      if (movesHere.length) square.classList.add(state.board[r][c] || movesHere.some(move => move.enPassant) ? "legal-capture" : "legal-target");
      if (piece) {
        const pieceElement = document.createElement("span");
        pieceElement.className = `piece ${colorOf(piece) === "w" ? "white" : "black"}`;
        pieceElement.textContent = PIECES[piece];
        pieceElement.setAttribute("aria-hidden", "true");
        square.append(pieceElement);
      }
      square.addEventListener("click", onSquareClick);
      boardElement.append(square);
    }
  }

  const whitePlayer = document.querySelector("#white-player");
  const blackPlayer = document.querySelector("#black-player");
  whitePlayer.classList.toggle("player-top", viewColor === "b");
  whitePlayer.classList.toggle("player-bottom", viewColor === "w");
  blackPlayer.classList.toggle("player-top", viewColor === "w");
  blackPlayer.classList.toggle("player-bottom", viewColor === "b");

  const rankLabels = document.querySelector(".coordinates.ranks");
  const fileLabels = document.querySelector(".coordinates.files");
  rankLabels.replaceChildren(...(viewColor === "b" ? ["1", "2", "3", "4", "5", "6", "7", "8"] : ["8", "7", "6", "5", "4", "3", "2", "1"])
    .map(label => {
      const span = document.createElement("span");
      span.textContent = label;
      return span;
    }));
  fileLabels.replaceChildren(...(viewColor === "b" ? ["h", "g", "f", "e", "d", "c", "b", "a"] : ["a", "b", "c", "d", "e", "f", "g", "h"])
    .map(label => {
      const span = document.createElement("span");
      span.textContent = label;
      return span;
    }));

  const moves = allLegalMoves(state);
  const checked = inCheck(state, state.turn);
  const finished = moves.length === 0;
  const whiteTurn = state.turn === "w";
  const gameActive = !finished && onlineGameStatus !== "finished";
  document.querySelector("#white-player").classList.toggle("active", gameActive && whiteTurn);
  document.querySelector("#black-player").classList.toggle("active", gameActive && !whiteTurn);
  updatePlayerLabels();

  if (onlineRoom && onlineGameStatus === "finished" && onlineFinishReason === "timeout") {
    statusText.textContent = `Zeit abgelaufen – ${onlineResult === "w" ? "Weiß" : "Schwarz"} gewinnt`;
    statusIcon.textContent = "⌛";
  } else if (onlineRoom && onlineGameStatus === "finished" && onlineResult === "draw") {
    statusText.textContent = "Partie beendet – unentschieden";
    statusIcon.textContent = "½";
  } else if (onlineRoom && !opponentJoined) {
    statusText.textContent = "Warte auf deinen Mitspieler";
    statusIcon.textContent = "♟";
  } else if (onlineRoom && state.turn !== onlineRoom.color) {
    statusText.textContent = "Dein Mitspieler ist am Zug";
    statusIcon.textContent = onlineRoom.color === "w" ? "♟" : "♙";
  } else if (botThinking) {
    statusText.textContent = "Der Bot überlegt …";
    statusIcon.textContent = "♟";
  } else if (pendingMove) {
    statusText.textContent = "Zug bereit – absenden, wenn du zufrieden bist";
    statusIcon.textContent = whiteTurn ? "♙" : "♟";
  } else if (movePending) {
    statusText.textContent = "Zug wird übertragen …";
  } else if (finished && checked) {
    statusText.textContent = `Schachmatt – ${whiteTurn ? "Schwarz" : "Weiß"} gewinnt`;
    statusIcon.textContent = "♚";
  } else if (finished) {
    statusText.textContent = "Patt – unentschieden";
    statusIcon.textContent = "½";
  } else if (checked) {
    statusText.textContent = `${whiteTurn ? "Weiß" : "Schwarz"} steht im Schach`;
    statusIcon.textContent = whiteTurn ? "♔" : "♚";
  } else {
    statusText.textContent = `${whiteTurn ? "Weiß" : "Schwarz"} ist am Zug`;
    statusIcon.textContent = whiteTurn ? "♙" : "♟";
  }
  moveCount.textContent = `${state.history.length} ${state.history.length === 1 ? "Zug" : "Züge"}`;
  undoButton.disabled = botThinking || pendingMove !== null || movePending ||
    (onlineRoom ? state.history.length === 0 || takebackRequestBy !== null : undoStack.length === 0);
  undoButton.innerHTML = onlineRoom
    ? "<span aria-hidden=\"true\">↶</span> Rücknahme anfragen"
    : "<span aria-hidden=\"true\">↶</span> Zug zurück";
  submitMoveButton.hidden = pendingMove === null;
  submitMoveButton.disabled = movePending;
  document.querySelector("#new-game-button").innerHTML = onlineRoom
    ? "<span aria-hidden=\"true\">↩</span> Partie verlassen"
    : "<span aria-hidden=\"true\">＋</span> Neue Partie";
  renderTakebackControls();
  renderClocks();
  renderHistory();
}

function updatePlayerLabels() {
  const whiteDescription = onlineRoom
    ? (onlineRoom.color === "w" ? "Du · Weiß" : "Dein Mitspieler")
    : gameMode === "bot" ? "Du" : "Spielt am unteren Rand";
  const blackDescription = onlineRoom
    ? (onlineRoom.color === "b" ? "Du · Schwarz" : "Dein Mitspieler")
    : gameMode === "bot" ? "Computer" : "Spielt am oberen Rand";
  document.querySelector("#white-player .player-info small").textContent = whiteDescription;
  document.querySelector("#black-player .player-info small").textContent = blackDescription;
}

function renderTakebackControls() {
  const onlineRequest = onlineRoom && takebackRequestBy;
  takebackControls.hidden = !onlineRequest;
  acceptTakebackButton.hidden = !onlineRequest || takebackRequestBy === onlineRoom.color;
  declineTakebackButton.hidden = !onlineRequest || takebackRequestBy === onlineRoom.color;
  cancelTakebackButton.hidden = !onlineRequest || takebackRequestBy !== onlineRoom.color;
  if (onlineRequest) {
    takebackMessage.textContent = takebackRequestBy === onlineRoom.color
      ? "Warte auf die Antwort deines Mitspielers."
      : "Dein Mitspieler möchte einen Zug zurücknehmen.";
  }
}

function renderClocks() {
  for (const [color, selector] of [["w", "#white-clock"], ["b", "#black-clock"]]) {
    const element = document.querySelector(selector);
    if (!clockSnapshot || !clockSnapshot.enabled) {
      element.textContent = "∞";
      element.classList.remove("expired");
      continue;
    }
    let remaining = clockSnapshot.remaining[color];
    if (clockSnapshot.runningColor === color && clockSnapshot.sampledAt) {
      remaining -= Date.now() - clockSnapshot.sampledAt;
    }
    remaining = Math.max(0, remaining);
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    element.textContent = `${minutes}:${String(seconds).padStart(2, "0")}`;
    element.classList.toggle("expired", totalSeconds === 0);
  }
}

function pieceName(piece) {
  const names = { K: "König", Q: "Dame", R: "Turm", B: "Läufer", N: "Springer", P: "Bauer" };
  return `${colorOf(piece) === "w" ? "weiße" : "schwarze"} ${names[piece.toUpperCase()]}`;
}

function renderHistory() {
  moveList.replaceChildren();
  if (state.history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-moves";
    empty.textContent = "Die Partie beginnt mit deinem ersten Zug.";
    moveList.append(empty);
    return;
  }
  for (let i = 0; i < state.history.length; i += 2) {
    const row = document.createElement("div");
    row.className = "move-row";
    const number = document.createElement("span");
    number.className = "move-number";
    number.textContent = `${Math.floor(i / 2) + 1}.`;
    row.append(number);
    for (const notation of state.history.slice(i, i + 2)) {
      const cell = document.createElement("span");
      cell.className = "move-notation";
      cell.textContent = notation;
      row.append(cell);
    }
    moveList.append(row);
  }
  moveList.scrollTop = moveList.scrollHeight;
}

function onSquareClick(event) {
  if (pendingPromotion || movePending || botThinking) return;
  if (pendingMove) pendingMove = null;
  const square = event.currentTarget;
  const r = Number(square.dataset.row);
  const c = Number(square.dataset.col);
  const piece = state.board[r][c];
  const movesHere = selectedMoves.filter(move => move.to[0] === r && move.to[1] === c);
  const selectedPiece = selected ? state.board[selected[0]][selected[1]] : null;
  const canPlayTurn = onlineRoom
    ? state.turn === onlineRoom.color && opponentJoined && onlineGameStatus === "playing"
    : gameMode === "bot" && state.turn === "w";

  if (selected && movesHere.length && canPlayTurn && colorOf(selectedPiece) === state.turn) {
    if (movesHere.some(move => move.promotion)) {
      openPromotion(movesHere);
    } else {
      queueMove(movesHere[0]);
    }
    return;
  }
  if (piece) {
    selected = [r, c];
    selectedMoves = legalMovesForColor(state, r, c);
  } else if (selected && movesHere.length) {
    return;
  } else {
    selected = null;
    selectedMoves = [];
  }
  render();
}

function openPromotion(moves) {
  pendingPromotion = moves;
  promotionChoices.replaceChildren();
  const color = state.turn;
  for (const type of PROMOTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "promotion-choice";
    button.setAttribute("aria-label", pieceName(color === "w" ? type : type.toLowerCase()));
    button.textContent = PIECES[color === "w" ? type : type.toLowerCase()];
    button.addEventListener("click", () => {
      const move = pendingPromotion.find(candidate => candidate.promotion === type);
      pendingPromotion = null;
      promotionOverlay.hidden = true;
      queueMove(move);
    });
    promotionChoices.append(button);
  }
  promotionOverlay.hidden = false;
  promotionChoices.querySelector("button").focus();
}

function notationFor(move) {
  const piece = state.board[move.from[0]][move.from[1]];
  const capture = state.board[move.to[0]][move.to[1]] || move.enPassant;
  if (move.castle === "king") return "O-O";
  if (move.castle === "queen") return "O-O-O";
  const prefix = piece.toUpperCase() === "P" ? (capture ? FILES[move.from[1]] : "") : piece.toUpperCase();
  return `${prefix}${capture ? "×" : ""}${squareName(move.to)}${move.promotion ? `=${move.promotion}` : ""}`;
}

async function makeMove(move) {
  if (onlineRoom) {
    movePending = true;
    onlineError.textContent = "";
    render();
    try {
      const game = await sendGameRequest("move", {
        code: onlineRoom.code,
        token: onlineRoom.token,
        version: roomVersion,
        move: {
          from: squareName(move.from),
          to: squareName(move.to),
          ...(move.promotion ? { promotion: move.promotion.toLowerCase() } : {})
        }
      });
      syncFromServer(game, true);
    } catch (error) {
      onlineError.textContent = error.message;
      try {
        const latest = await sendGameRequest("get", { code: onlineRoom.code, token: onlineRoom.token });
        syncFromServer(latest, true);
      } catch (syncError) {
        onlineError.textContent = syncError.message;
      }
    } finally {
      movePending = false;
      pendingMove = null;
      selected = null;
      selectedMoves = [];
      render();
    }
    return;
  }

  applyLocalMove(move);
  if (gameMode === "bot" && state.turn === "b" && allLegalMoves(state).length > 0) {
    botThinking = true;
    render();
    botTimer = setTimeout(makeBotMove, 450);
  }
}

function queueMove(move) {
  if (autoFinishToggle.checked) {
    makeMove(move);
    return;
  }
  pendingMove = move;
  selected = null;
  selectedMoves = [];
  render();
}

function applyLocalMove(move) {
  undoStack.push(clonePosition(state));
  const notation = notationFor(move);
  state = applyMove(state, move);
  const replies = allLegalMoves(state);
  if (replies.length === 0 && inCheck(state, state.turn)) state.history.push(`${notation}#`);
  else if (inCheck(state, state.turn)) state.history.push(`${notation}+`);
  else state.history.push(notation);
  pendingMove = null;
  selected = null;
  selectedMoves = [];
  render();
}

function makeBotMove() {
  botTimer = null;
  botThinking = false;
  const moves = allLegalMoves(state);
  if (!moves.length) {
    render();
    return;
  }
  const values = { P: 1, N: 3, B: 3.2, R: 5, Q: 9, K: 0 };
  const scored = moves.map(move => {
    const captured = move.enPassant ? 1 : (state.board[move.to[0]][move.to[1]] || "").toUpperCase();
    const promotedValue = move.promotion ? values[move.promotion] - 1 : 0;
    const next = applyMove(state, move);
    const checkBonus = inCheck(next, next.turn) ? 0.6 : 0;
    return {
      move,
      score: (typeof captured === "number" ? captured : values[captured] || 0) * 2 +
        promotedValue + checkBonus + Math.random() * 0.8
    };
  }).sort((a, b) => b.score - a.score);
  applyLocalMove(scored[0].move);
}

undoButton.addEventListener("click", () => {
  if (onlineRoom) {
    requestTakeback();
    return;
  }
  if (!undoStack.length) return;
  state = undoStack.pop();
  if (gameMode === "bot" && state.turn === "b" && undoStack.length) state = undoStack.pop();
  selected = null;
  selectedMoves = [];
  pendingMove = null;
  render();
});

document.querySelector("#new-game-button").addEventListener("click", () => {
  if (onlineRoom) {
    if (!window.confirm("Möchtest du die Online-Partie verlassen? Dein Mitspieler kann weiterspielen.")) return;
    leaveOnlineGame();
    showScreen("home");
    return;
  }
  startBotGame();
});

async function sendGameRequest(action, data = {}) {
  const response = await fetch("/.netlify/functions/games", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...data })
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Der Server hat eine ungültige Antwort gesendet.");
  }
  if (!response.ok) throw new Error(result.error || "Die Anfrage ist fehlgeschlagen.");
  return result;
}

function showScreen(screen) {
  homeScreen.hidden = screen !== "home";
  friendSetupScreen.hidden = screen !== "setup";
  gameScreen.hidden = screen !== "game";
  homeButton.hidden = screen === "home";
}

function startBotGame() {
  clearTimeout(botTimer);
  botTimer = null;
  clearInterval(clockTimer);
  clockTimer = null;
  botThinking = false;
  gameMode = "bot";
  viewColor = "w";
  state = initialState();
  undoStack = [];
  selected = null;
  selectedMoves = [];
  pendingMove = null;
  pendingPromotion = null;
  onlineRoom = null;
  clockSnapshot = null;
  takebackRequestBy = null;
  onlineGameStatus = null;
  onlineResult = null;
  onlineFinishReason = null;
  onlinePanel.hidden = true;
  takebackControls.hidden = true;
  promotionOverlay.hidden = true;
  showScreen("game");
  render();
}

async function connectToRoom(code, action = "join", settings = {}) {
  code = code.trim().toUpperCase();
  if (action === "join" && !/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
    setupError.textContent = "Bitte gib einen gültigen sechsstelligen Einladungscode ein.";
    return;
  }
  setupError.textContent = "";
  onlineError.textContent = "";
  const errorTarget = gameScreen.hidden ? setupError : onlineError;
  try {
    const storedToken = code ? window.localStorage.getItem(`schach-room-${code}`) : null;
    const game = await sendGameRequest(action, {
      ...(action === "join" ? { code } : settings),
      ...(storedToken ? { token: storedToken } : {})
    });
    onlineRoom = { code: game.code, token: game.token, color: game.playerColor };
    gameMode = "online";
    viewColor = game.playerColor;
    movePending = false;
    roomVersion = 0;
    window.localStorage.setItem(`schach-room-${game.code}`, game.token);
    roomCodeInput.value = game.code;
    roomCodeOutput.textContent = game.code;
    roomInfo.hidden = false;
    onlinePanel.hidden = false;
    showScreen("game");
    const url = new URL(window.location.href);
    url.searchParams.set("room", game.code);
    window.history.replaceState(null, "", url);
    syncFromServer(game, true);
    clearInterval(pollTimer);
    pollTimer = setInterval(pollRoom, 1500);
    if (!clockTimer) clockTimer = setInterval(renderClocks, 250);
  } catch (error) {
    errorTarget.textContent = error.message;
  }
}

function parseSquare(square) {
  return [8 - Number(square[1]), FILES.indexOf(square[0])];
}

function syncFromServer(game, force = false) {
  clockSnapshot = game.clock;
  takebackRequestBy = game.takebackRequestBy;
  onlineGameStatus = game.status;
  onlineResult = game.result;
  onlineFinishReason = game.finishReason;
  if (!force && game.version === roomVersion) {
    updateRoomStatus(game);
    render();
    return;
  }
  const next = initialState();
  for (const serverMove of game.moves) {
    const from = parseSquare(serverMove.from);
    const to = parseSquare(serverMove.to);
    const move = legalMoves(next, from[0], from[1]).find(candidate =>
      candidate.to[0] === to[0] &&
      candidate.to[1] === to[1] &&
      (candidate.promotion || "").toLowerCase() === (serverMove.promotion || "").toLowerCase()
    );
    if (!move) {
      onlineError.textContent = "Der übertragene Spielstand konnte nicht nachvollzogen werden.";
      return;
    }
    const updated = applyMove(next, move);
    updated.history.push(serverMove.san);
    Object.assign(next, updated);
  }
  state = next;
  roomVersion = game.version;
  undoStack = [];
  selected = null;
  selectedMoves = [];
  pendingMove = null;
  updateRoomStatus(game);
  render();
}

function updateRoomStatus(game) {
  opponentJoined = game.players.white && game.players.black;
  onlineStatus.textContent = game.status === "finished"
    ? "Diese Partie ist beendet."
    : opponentJoined
      ? `Verbunden · Du spielst ${onlineRoom.color === "w" ? "Weiß" : "Schwarz"}.`
      : "Warte auf deinen Mitspieler. Teile den Link.";
}

async function pollRoom() {
  if (!onlineRoom || roomPolling) return;
  roomPolling = true;
  try {
    const game = await sendGameRequest("get", { code: onlineRoom.code, token: onlineRoom.token });
    onlineError.textContent = "";
    syncFromServer(game);
  } catch (error) {
    onlineError.textContent = error.message;
  } finally {
    roomPolling = false;
  }
}

async function requestTakeback(action = "requestTakeback") {
  if (!onlineRoom) return;
  try {
    const game = await sendGameRequest(action, { code: onlineRoom.code, token: onlineRoom.token });
    syncFromServer(game, true);
    onlineError.textContent = "";
  } catch (error) {
    onlineError.textContent = error.message;
  }
}

function leaveOnlineGame() {
  clearInterval(pollTimer);
  clearInterval(clockTimer);
  pollTimer = null;
  clockTimer = null;
  onlineRoom = null;
  gameMode = null;
  viewColor = "w";
  roomVersion = 0;
  opponentJoined = false;
  movePending = false;
  clockSnapshot = null;
  takebackRequestBy = null;
  onlineGameStatus = null;
  onlineResult = null;
  onlineFinishReason = null;
  roomInfo.hidden = true;
  onlinePanel.hidden = true;
  onlineStatus.textContent = "";
  onlineError.textContent = "";
  setupError.textContent = "";
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  window.history.replaceState(null, "", url);
}

document.querySelector("#bot-mode-button").addEventListener("click", startBotGame);
document.querySelector("#friend-mode-button").addEventListener("click", () => {
  setupError.textContent = "";
  showScreen("setup");
});
document.querySelector("#setup-back-button").addEventListener("click", () => showScreen("home"));
homeButton.addEventListener("click", () => {
  if (onlineRoom && !window.confirm("Möchtest du die Online-Partie verlassen? Dein Mitspieler kann weiterspielen.")) return;
  if (onlineRoom) leaveOnlineGame();
  clearTimeout(botTimer);
  clearInterval(clockTimer);
  clockTimer = null;
  botThinking = false;
  gameMode = null;
  showScreen("home");
});

document.querySelector("#friend-setup-form").addEventListener("submit", event => {
  event.preventDefault();
  const timeMinutes = unlimitedTimeInput.checked ? null : Number(timeMinutesInput.value);
  if (timeMinutes !== null && (!Number.isInteger(timeMinutes) || timeMinutes < 1 || timeMinutes > 1440)) {
    setupError.textContent = "Gib eine ganze Minutenzahl zwischen 1 und 1440 ein.";
    return;
  }
  connectToRoom("", "create", {
    timeMinutes,
    creatorColor: creatorColorInput.value
  });
});
unlimitedTimeInput.addEventListener("change", () => {
  timeMinutesInput.disabled = unlimitedTimeInput.checked;
});

joinRoomForm.addEventListener("submit", event => {
  event.preventDefault();
  connectToRoom(roomCodeInput.value);
});
roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
});
copyRoomButton.addEventListener("click", async () => {
  if (!onlineRoom) return;
  const url = new URL(window.location.href);
  url.searchParams.set("room", onlineRoom.code);
  try {
    await navigator.clipboard.writeText(url.href);
    onlineStatus.textContent = "Einladungslink wurde kopiert. Schick ihn deinem Freund.";
  } catch {
    onlineError.textContent = `Kopiere diesen Link: ${url.href}`;
  }
});

autoFinishToggle.addEventListener("change", () => {
  window.localStorage.setItem("schach-auto-finish", String(autoFinishToggle.checked));
  if (autoFinishToggle.checked && pendingMove) makeMove(pendingMove);
  else render();
});
submitMoveButton.addEventListener("click", () => {
  if (pendingMove) makeMove(pendingMove);
});
acceptTakebackButton.addEventListener("click", () => requestTakeback("acceptTakeback"));
declineTakebackButton.addEventListener("click", () => requestTakeback("declineTakeback"));
cancelTakebackButton.addEventListener("click", () => requestTakeback("cancelTakeback"));

const invitedRoom = new URLSearchParams(window.location.search).get("room");
if (invitedRoom) {
  roomCodeInput.value = invitedRoom.toUpperCase();
  showScreen("setup");
  connectToRoom(invitedRoom);
}

render();
