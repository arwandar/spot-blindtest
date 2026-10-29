import fs from "node:fs";
import path from "node:path";

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

const REDIRECT_URI =
  process.env.SPOTIFY_REDIRECT_URI || "http://localhost:5174/callback";

const TOKEN_STORAGE_FILE = path.join(process.cwd(), ".spotify_token.json");

export interface CurrentTrack {
  id: string;
  title: string;
  artists: string;
  album: string;
  coverUrl: string | null;
  isPlaying: boolean;
  progressMs: number;
  durationMs: number;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let storedTokens: StoredTokens | null = null;

// Charger les tokens sauvegardés au démarrage
try {
  if (fs.existsSync(TOKEN_STORAGE_FILE)) {
    const raw = fs.readFileSync(TOKEN_STORAGE_FILE, "utf-8");
    storedTokens = JSON.parse(raw);
    console.log("Tokens Spotify chargés depuis le cache local.");
  }
} catch (err) {
  console.warn("Impossible de lire .spotify_token.json:", err);
}

function saveTokens(tokens: StoredTokens) {
  storedTokens = tokens;
  try {
    fs.writeFileSync(TOKEN_STORAGE_FILE, JSON.stringify(tokens, null, 2), "utf-8");
  } catch (err) {
    console.warn("Impossible de sauvegarder .spotify_token.json:", err);
  }
}

function getBasicAuthHeader(): string {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Variables SPOTIFY_CLIENT_ID et SPOTIFY_CLIENT_SECRET manquantes.");
  }
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

/**
 * Génère l'URL d'autorisation Spotify pour connecter l'utilisateur principal.
 */
export function getSpotifyAuthUrl(): string {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    throw new Error("Variable SPOTIFY_CLIENT_ID manquante.");
  }

  const scopes = [
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
  ].join(" ");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: scopes,
    redirect_uri: REDIRECT_URI,
  });

  return `${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Échange le code d'autorisation contre un access_token et un refresh_token.
 */
export async function handleSpotifyAuthorizationCode(code: string): Promise<void> {
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: getBasicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erreur échange de code Spotify (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  saveTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  console.log("Utilisateur Spotify connecté avec succès !");
}

/**
 * Récupère un access_token utilisateur valide, en le rafraîchissant si nécessaire.
 */
export async function getUserAccessToken(): Promise<string | null> {
  if (!storedTokens || !storedTokens.refreshToken) {
    return null;
  }

  const now = Date.now();
  // Si le token expire dans plus d'une minute, on l'utilise
  if (storedTokens.accessToken && now < storedTokens.expiresAt - 60_000) {
    return storedTokens.accessToken;
  }

  // Rafraîchissement du token
  try {
    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: getBasicAuthHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: storedTokens.refreshToken,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erreur refresh_token Spotify (${response.status}):`, errorText);
      return null;
    }

    const data = await response.json();
    saveTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || storedTokens.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    });

    return data.access_token;
  } catch (err) {
    console.error("Échec lors du rafraîchissement du token Spotify:", err);
    return null;
  }
}

/**
 * Indique si un utilisateur Spotify est actuellement lié.
 */
export function isSpotifyUserConnected(): boolean {
  return storedTokens !== null && Boolean(storedTokens.refreshToken);
}

/**
 * Supprime la session Spotify connectée (réinitialise la partie).
 */
export function disconnectSpotifyUser(): void {
  storedTokens = null;
  try {
    if (fs.existsSync(TOKEN_STORAGE_FILE)) {
      fs.unlinkSync(TOKEN_STORAGE_FILE);
    }
    console.log("Session Spotify supprimée : réinitialisation de la partie.");
  } catch (err) {
    console.warn("Erreur lors de la suppression de .spotify_token.json:", err);
  }
}


/**
 * Récupère le morceau en cours de lecture sur le compte Spotify connecté.
 */
export async function getCurrentlyPlayingTrack(): Promise<CurrentTrack | null> {
  const token = await getUserAccessToken();
  if (!token) {
    return null;
  }

  const response = await fetch(`${SPOTIFY_API_BASE}/me/player/currently-playing`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 204 || response.status === 202) {
    // Rien n'est en lecture
    return null;
  }

  if (!response.ok) {
    const errText = await response.text();
    console.warn(`Erreur Spotify currently-playing [${response.status}]:`, errText);
    return null;
  }

  const data = await response.json();
  if (!data || !data.item) {
    return null;
  }

  const item = data.item;
  const artists = (item.artists || []).map((a: any) => a.name).join(", ");
  const coverUrl = item.album?.images?.[0]?.url || null;

  return {
    id: item.id,
    title: item.name,
    artists: artists || "Inconnu",
    album: item.album?.name || "Inconnu",
    coverUrl,
    isPlaying: Boolean(data.is_playing),
    progressMs: data.progress_ms || 0,
    durationMs: item.duration_ms || 0,
  };
}

/**
 * Passe au morceau suivant sur le lecteur Spotify de l'utilisateur.
 */
export async function skipToNextTrack(): Promise<boolean> {
  const token = await getUserAccessToken();
  if (!token) {
    return false;
  }

  const response = await fetch(`${SPOTIFY_API_BASE}/me/player/next`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 204 || response.ok) {
    return true;
  }

  const errText = await response.text();
  console.error(`Erreur skip to next [${response.status}]:`, errText);
  return false;
}
