import express from "express";
import ViteExpress from "vite-express";
import { WebSocketServer, WebSocket } from "ws";
import {
  getSpotifyAuthUrl,
  handleSpotifyAuthorizationCode,
  isSpotifyUserConnected,
  disconnectSpotifyUser,
  getCurrentlyPlayingTrack,
  skipToNextTrack,
  CurrentTrack,
} from "./spotify.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Routes d'authentification Spotify ---

// 1. Démarrer l'association du compte Spotify
app.get("/api/spotify/login", (_req, res) => {
  try {
    const authUrl = getSpotifyAuthUrl();
    res.redirect(authUrl);
  } catch (err: any) {
    res.status(500).send(`Erreur Spotify Login: ${err.message}`);
  }
});

// 2. Callback OAuth2 après approbation par l'utilisateur
app.get("/callback", async (req, res) => {
  const code = req.query.code as string;
  const error = req.query.error as string;

  if (error) {
    return res.status(400).send(`Erreur retournée par Spotify: ${error}`);
  }

  if (!code) {
    return res.status(400).send("Code d'autorisation manquant.");
  }

  try {
    await handleSpotifyAuthorizationCode(code);
    // Notifier immédiatement les clients connectés que Spotify est actif
    broadcast({
      type: "SPOTIFY_STATUS",
      connected: true,
    });
    // Rediriger vers l'application
    res.redirect("/");
  } catch (err: any) {
    res.status(500).send(`Échec de la connexion Spotify: ${err.message}`);
  }
});

// Statut rapide
app.get("/api/spotify/status", (_req, res) => {
  res.json({
    connected: isSpotifyUserConnected(),
  });
});

// Démarrage du serveur HTTP
const server = ViteExpress.listen(app, 5174, () => {
  console.log("Server is listening on port 5174...");
});

// --- Serveur WebSocket pour le Blindtest ---

// On isole le WebSocket sur /ws pour ne pas entrer en conflit avec le HMR de Vite
const wss = new WebSocketServer({ server, path: "/ws" });

// Regroupement par identifiant de joueur : playerId -> Set<WebSocket>
// Permet de compter 1 joueur même si React monte deux fois (StrictMode) ou si le joueur a 2 onglets
const players = new Map<string, Set<WebSocket>>();

interface TrackValidations {
  artist: boolean;
  title: boolean;
}

interface TrackHints {
  artist: string[]; // Liste des playerIds ayant révélé l'artiste
  title: string[];  // Liste des playerIds ayant révélé le titre
  cover: string[];  // Liste des playerIds ayant révélé la pochette
}

let pollTimer: NodeJS.Timeout | null = null;
let resetSessionTimer: NodeJS.Timeout | null = null;
let lastTrack: CurrentTrack | null = null;
let validations: TrackValidations = {
  artist: false,
  title: false,
};
let hints: TrackHints = {
  artist: [],
  title: [],
  cover: [],
};

function getPlayersCount(): number {
  return players.size;
}

function broadcast(payload: object) {
  const data = JSON.stringify(payload);
  for (const sockets of players.values()) {
    for (const client of sockets) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }
}

function broadcastUsersCount() {
  broadcast({
    type: "USERS_COUNT",
    count: getPlayersCount(),
  });
}

async function checkSpotifyPlayback() {
  if (!isSpotifyUserConnected() || getPlayersCount() === 0) {
    return;
  }

  try {
    const current = await getCurrentlyPlayingTrack();
    const hasTrackIdChanged = (!lastTrack && current) || (lastTrack && current && lastTrack.id !== current.id);
    const hasChanged =
      (!lastTrack && current) ||
      (lastTrack && !current) ||
      (lastTrack && current && (lastTrack.id !== current.id || lastTrack.isPlaying !== current.isPlaying));

    if (hasTrackIdChanged) {
      // Nouvelle chanson : réinitialisation des validations et des indices révélés
      validations = { artist: false, title: false };
      hints = { artist: [], title: [], cover: [] };
    }

    if (hasChanged) {
      lastTrack = current;
      broadcast({
        type: "TRACK_UPDATE",
        track: current,
        validations,
        hints,
        spotifyConnected: true,
      });
    }
  } catch (err) {
    console.warn("Erreur polling Spotify playback:", err);
  }
}

function startPolling() {
  if (pollTimer) return;
  console.log("Démarrage du polling Spotify (au moins 1 joueur connecté)");
  // Polling toutes les 1.5s
  pollTimer = setInterval(checkSpotifyPlayback, 1500);
  // Premier appel immédiat
  checkSpotifyPlayback();
}

function stopPolling() {
  if (pollTimer) {
    console.log("Arrêt du polling Spotify (0 joueur connecté)");
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function scheduleSessionReset() {
  stopPolling();
  if (resetSessionTimer) clearTimeout(resetSessionTimer);

  // Petit délai de 5s pour permettre un rafraîchissement de page (F5) sans perdre la session
  resetSessionTimer = setTimeout(() => {
    if (getPlayersCount() === 0) {
      console.log("0 joueur connecté depuis 5s : réinitialisation complète de la partie.");
      lastTrack = null;
      validations = { artist: false, title: false };
      hints = { artist: [], title: [], cover: [] };
      disconnectSpotifyUser();
    }
    resetSessionTimer = null;
  }, 5000);
}

function cancelSessionReset() {
  if (resetSessionTimer) {
    clearTimeout(resetSessionTimer);
    resetSessionTimer = null;
  }
}

// Heartbeat pour nettoyer les sockets zombies toutes les 30s
const heartbeatInterval = setInterval(() => {
  for (const [playerId, sockets] of players.entries()) {
    for (const client of sockets) {
      if ((client as any).isAlive === false) {
        client.terminate();
        sockets.delete(client);
      } else {
        (client as any).isAlive = false;
        client.ping();
      }
    }
    if (sockets.size === 0) {
      players.delete(playerId);
    }
  }
}, 30000);

wss.on("close", () => clearInterval(heartbeatInterval));

wss.on("connection", async (ws, req) => {
  // Extraire l'identifiant du joueur depuis la query string
  const url = new URL(req.url || "", "http://localhost");
  const playerId = url.searchParams.get("playerId") || `anon_${Math.random().toString(36).substring(2, 9)}`;

  // Annuler la réinitialisation si un joueur arrive ou se reconnecte
  cancelSessionReset();

  if (!players.has(playerId)) {
    players.set(playerId, new Set());
  }
  players.get(playerId)!.add(ws);

  (ws as any).isAlive = true;
  ws.on("pong", () => {
    (ws as any).isAlive = true;
  });

  console.log(`Connexion pour [${playerId}]. Joueurs uniques connectés : ${getPlayersCount()}`);

  // Démarrer le polling si nécessaire
  startPolling();

  // Envoyer l'état initial au nouveau joueur
  ws.send(
    JSON.stringify({
      type: "INIT",
      spotifyConnected: isSpotifyUserConnected(),
      track: lastTrack,
      validations,
      hints,
      usersCount: getPlayersCount(),
    }),
  );

  broadcastUsersCount();

  ws.on("message", async (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());

      if (message.type === "NEXT_TRACK") {
        console.log(`Action: Passage à la chanson suivante demandé par ${playerId}`);
        const success = await skipToNextTrack();
        if (success) {
          // Laisser un court délai à Spotify pour zapper avant de récupérer le nouveau morceau
          setTimeout(async () => {
            await checkSpotifyPlayback();
          }, 800);
        }
      } else if (message.type === "VALIDATE_ITEM") {
        const item = message.item as "artist" | "title";
        if (item === "artist" || item === "title") {
          validations[item] = Boolean(message.validated ?? true);
          console.log(`Action: [${playerId}] a validé ${item} : ${validations[item]}`);
          broadcast({
            type: "VALIDATION_UPDATE",
            validations,
          });
        }
      } else if (message.type === "REVEAL_HINT") {
        const item = message.item as "artist" | "title" | "cover";
        if (item === "artist" || item === "title" || item === "cover") {
          if (!hints[item].includes(playerId)) {
            hints[item].push(playerId);
            console.log(`Action: [${playerId}] a révélé l'indice ${item}`);
            broadcast({
              type: "HINTS_UPDATE",
              hints,
            });
          }
        }
      }
    } catch (err) {
      console.warn("Message WebSocket invalide reçu:", err);
    }
  });

  const handleDisconnect = () => {
    const sockets = players.get(playerId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        players.delete(playerId);
      }
    }
    console.log(`Déconnexion pour [${playerId}]. Joueurs uniques restants : ${getPlayersCount()}`);
    broadcastUsersCount();

    if (getPlayersCount() === 0) {
      scheduleSessionReset();
    }
  };

  ws.on("close", handleDisconnect);
  ws.on("error", (err) => {
    console.error(`Erreur WebSocket [${playerId}]:`, err);
    handleDisconnect();
  });
});

