import { getStore } from "@netlify/blobs";
import { Chess } from "chess.js";
import { randomBytes, randomInt, randomUUID } from "node:crypto";

// The Blobs store is opened per request: Netlify issues a fresh access token
// for every invocation, so a store created at module load would keep using an
// expired token once the function instance is reused.
let games;
const codeCharacters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function newCode() {
  return Array.from(randomBytes(6), byte => codeCharacters[byte % codeCharacters.length]).join("");
}

function validCode(code) {
  return typeof code === "string" && /^[A-HJ-NP-Z2-9]{6}$/.test(code);
}

async function loadGame(code) {
  if (!validCode(code)) return null;
  const game = await games.get(code, { type: "json" });
  if (!game) return null;
  if (!game.clock) {
    game.status = game.players.w && game.players.b ? "playing" : "waiting";
    game.result = null;
    game.finishReason = null;
    game.takebackRequestBy = null;
    game.clock = {
      initialMs: null,
      remaining: { w: null, b: null },
      startedAt: game.status === "playing" ? Date.now() : null
    };
    await games.setJSON(game.code, game);
  }
  return game;
}

function playerColor(game, token) {
  if (typeof token !== "string") return null;
  if (token === game.players.w) return "w";
  if (token === game.players.b) return "b";
  return null;
}

function currentColor(game) {
  return game.fen.split(" ")[1] === "b" ? "b" : "w";
}

function publicClock(game) {
  const now = Date.now();
  const remaining = { ...game.clock.remaining };
  const runningColor = game.status === "playing" && game.clock.startedAt !== null
    ? currentColor(game)
    : null;
  if (game.clock.initialMs !== null && runningColor) {
    remaining[runningColor] = Math.max(0, remaining[runningColor] - (now - game.clock.startedAt));
  }
  return {
    enabled: game.clock.initialMs !== null,
    remaining,
    runningColor,
    sampledAt: now
  };
}

async function finishIfFlagged(game) {
  if (game.status !== "playing" || game.clock.initialMs === null || game.clock.startedAt === null) return false;
  const color = currentColor(game);
  const elapsed = Date.now() - game.clock.startedAt;
  if (elapsed < game.clock.remaining[color]) return false;
  game.clock.remaining[color] = 0;
  game.clock.startedAt = null;
  game.status = "finished";
  game.result = color === "w" ? "b" : "w";
  game.finishReason = "timeout";
  await games.setJSON(game.code, game);
  return true;
}

function chargeRunningClock(game, now) {
  if (game.clock.initialMs === null || game.clock.startedAt === null) return;
  const color = currentColor(game);
  game.clock.remaining[color] = Math.max(0, game.clock.remaining[color] - (now - game.clock.startedAt));
  game.clock.startedAt = now;
}

function publicGame(game, color) {
  return {
    code: game.code,
    version: game.version,
    fen: game.fen,
    moves: game.moves,
    playerColor: color,
    players: { white: Boolean(game.players.w), black: Boolean(game.players.b) },
    status: game.status,
    result: game.result,
    finishReason: game.finishReason,
    takebackRequestBy: game.takebackRequestBy,
    clock: publicClock(game)
  };
}

export default async request => {
  games = getStore("chess-games");
  try {
    return await handleRequest(request);
  } catch (error) {
    console.error(error);
    return response({ error: "Auf dem Server ist ein Fehler aufgetreten. Bitte versuche es gleich noch einmal." }, 500);
  }
};

async function handleRequest(request) {
  if (request.method !== "POST") return response({ error: "Nur POST-Anfragen sind erlaubt." }, 405);

  let input;
  try {
    input = await request.json();
  } catch {
    return response({ error: "Die Anfrage enthält kein gültiges JSON." }, 400);
  }

  if (input.action === "create") {
    const timeMinutes = input.timeMinutes;
    if (timeMinutes !== null && (!Number.isInteger(timeMinutes) || timeMinutes < 1 || timeMinutes > 1440)) {
      return response({ error: "Die Bedenkzeit muss unbegrenzt oder eine ganze Zahl von 1 bis 1440 Minuten sein." }, 400);
    }
    if (!["random", "w", "b"].includes(input.creatorColor)) {
      return response({ error: "Bitte wähle eine gültige Farbe." }, 400);
    }
    let code;
    do {
      code = newCode();
    } while (await loadGame(code));

    const token = randomUUID();
    const chess = new Chess();
    const creatorColor = input.creatorColor === "random" ? (randomInt(2) === 0 ? "w" : "b") : input.creatorColor;
    const initialMs = timeMinutes === null ? null : timeMinutes * 60 * 1000;
    const game = {
      code,
      version: 0,
      fen: chess.fen(),
      moves: [],
      players: {
        w: creatorColor === "w" ? token : null,
        b: creatorColor === "b" ? token : null
      },
      status: "waiting",
      result: null,
      finishReason: null,
      takebackRequestBy: null,
      clock: {
        initialMs,
        remaining: { w: initialMs, b: initialMs },
        startedAt: null
      }
    };
    await games.setJSON(code, game);
    return response({ ...publicGame(game, creatorColor), token });
  }

  const game = await loadGame(input.code);
  if (!game) return response({ error: "Diese Partie wurde nicht gefunden. Prüfe den Einladungscode." }, 404);

  if (input.action === "join") {
    let color = playerColor(game, input.token);
    if (!color) {
      if (!game.players.w) color = "w";
      else if (!game.players.b) color = "b";
      else return response({ error: "Diese Partie hat bereits zwei Spieler." }, 409);
      input.token = randomUUID();
      game.players[color] = input.token;
      game.version += 1;
      if (game.players.w && game.players.b) {
        game.status = "playing";
        game.clock.startedAt = Date.now();
      }
      await games.setJSON(game.code, game);
    }
    return response({ ...publicGame(game, color), token: input.token });
  }

  const color = playerColor(game, input.token);
  if (!color) return response({ error: "Deine Spielberechtigung ist ungültig. Tritt der Partie erneut bei." }, 403);
  const flagged = await finishIfFlagged(game);

  if (input.action === "get") return response(publicGame(game, color));

  if (input.action === "move") {
    if (flagged || game.status === "finished") {
      return response({ error: "Die Partie ist bereits beendet.", game: publicGame(game, color) }, 409);
    }
    if (game.status !== "playing") return response({ error: "Warte, bis dein Freund der Partie beitritt." }, 409);
    if (!Number.isInteger(input.version) || input.version !== game.version) {
      return response({ error: "Die Partie wurde inzwischen aktualisiert. Der aktuelle Stand wird geladen." }, 409);
    }
    if (!input.move || !/^[a-h][1-8]$/.test(input.move.from) || !/^[a-h][1-8]$/.test(input.move.to)) {
      return response({ error: "Der Zug ist ungültig." }, 400);
    }

    const chess = new Chess(game.fen);
    if (chess.turn() !== color) return response({ error: "Der Gegner ist am Zug." }, 409);
    const moveOptions = { from: input.move.from, to: input.move.to };
    if (input.move.promotion) {
      if (!["q", "r", "b", "n"].includes(input.move.promotion)) return response({ error: "Ungültige Bauernumwandlung." }, 400);
      moveOptions.promotion = input.move.promotion;
    }
    const isLegal = chess.moves({ verbose: true }).some(candidate =>
      candidate.from === moveOptions.from &&
      candidate.to === moveOptions.to &&
      (candidate.promotion || undefined) === moveOptions.promotion
    );
    if (!isLegal) return response({ error: "Dieser Zug ist nach den Schachregeln nicht erlaubt." }, 400);
    const now = Date.now();
    chargeRunningClock(game, now);
    const move = chess.move(moveOptions);
    game.fen = chess.fen();
    game.version += 1;
    game.moves.push({
      from: move.from,
      to: move.to,
      ...(move.promotion ? { promotion: move.promotion.toUpperCase() } : {}),
      san: move.san
    });
    if (chess.isGameOver()) {
      game.status = "finished";
      game.result = chess.isCheckmate() ? color : "draw";
      game.finishReason = chess.isCheckmate() ? "checkmate" : "draw";
      game.clock.startedAt = null;
    }
    await games.setJSON(game.code, game);
    return response(publicGame(game, color));
  }

  if (["requestTakeback", "acceptTakeback", "declineTakeback", "cancelTakeback"].includes(input.action)) {
    if (flagged || game.status !== "playing") return response({ error: "Die Partie kann nicht mehr zurückgenommen werden." }, 409);
    const now = Date.now();
    chargeRunningClock(game, now);
    if (input.action === "requestTakeback") {
      if (game.moves.length === 0 || game.takebackRequestBy) {
        return response({ error: "Eine Rücknahme ist gerade nicht möglich." }, 409);
      }
      game.takebackRequestBy = color;
    } else if (input.action === "acceptTakeback") {
      if (!game.takebackRequestBy || game.takebackRequestBy === color) {
        return response({ error: "Es gibt keine Rücknahmeanfrage deines Mitspielers." }, 409);
      }
      game.moves.pop();
      const chess = new Chess();
      for (const move of game.moves) {
        chess.move({
          from: move.from,
          to: move.to,
          ...(move.promotion ? { promotion: move.promotion.toLowerCase() } : {})
        });
      }
      game.fen = chess.fen();
      game.takebackRequestBy = null;
    } else if (input.action === "declineTakeback") {
      if (!game.takebackRequestBy || game.takebackRequestBy === color) {
        return response({ error: "Es gibt keine Rücknahmeanfrage deines Mitspielers." }, 409);
      }
      game.takebackRequestBy = null;
    } else {
      if (game.takebackRequestBy !== color) {
        return response({ error: "Du kannst diese Rücknahmeanfrage nicht zurückziehen." }, 403);
      }
      game.takebackRequestBy = null;
    }
    game.version += 1;
    game.clock.startedAt = Date.now();
    await games.setJSON(game.code, game);
    return response(publicGame(game, color));
  }

  return response({ error: "Unbekannte Aktion." }, 400);
}
