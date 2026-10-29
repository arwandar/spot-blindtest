import React, { useEffect, useState, useRef } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Container,
  IconButton,
  Stack,
  ThemeProvider,
  Typography,
  createTheme,
  Alert,
  Tooltip,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import BlurOnIcon from "@mui/icons-material/BlurOn";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import PersonIcon from "@mui/icons-material/Person";
import GroupIcon from "@mui/icons-material/Group";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import AlbumIcon from "@mui/icons-material/Album";
import { useSnackbar } from "notistack";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#1DB954", // Vert Spotify
    },
    background: {
      default: "#121212",
      paper: "#1e1e1e",
    },
  },
});

interface Track {
  id: string;
  title: string;
  artists: string;
  album: string;
  coverUrl: string | null;
  isPlaying: boolean;
  progressMs: number;
  durationMs: number;
}

// Récupération ou génération d'un identifiant unique de joueur par navigateur
function getPlayerId(): string {
  let id = localStorage.getItem("blindtest_player_id");
  if (!id) {
    id = "player_" + Math.random().toString(36).substring(2, 10);
    localStorage.setItem("blindtest_player_id", id);
  }
  return id;
}

const App: React.FC = () => {
  const { enqueueSnackbar } = useSnackbar();

  const [wsConnected, setWsConnected] = useState(false);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [usersCount, setUsersCount] = useState(1);
  const [track, setTrack] = useState<Track | null>(null);

  // Validations PARTAGÉES (trouvé pour tous les joueurs)
  const [validations, setValidations] = useState<{ artist: boolean; title: boolean }>({
    artist: false,
    title: false,
  });

  // Indices RÉVÉLÉS par les joueurs : { artist: string[], title: string[], cover: string[] }
  const [hints, setHints] = useState<{ artist: string[]; title: string[]; cover: string[] }>({
    artist: [],
    title: [],
    cover: [],
  });

  // États de révélation PROPRES à cet utilisateur (irréversibles pour la chanson)
  const [showArtist, setShowArtist] = useState(false);
  const [showTitle, setShowTitle] = useState(false);
  // 3 états pour la pochette : "hidden" (masquée) -> "blurred" (floutée) -> "revealed" (nette)
  const [coverState, setCoverState] = useState<"hidden" | "blurred" | "revealed">("hidden");

  const wsRef = useRef<WebSocket | null>(null);
  const currentTrackIdRef = useRef<string | null>(null);

  useEffect(() => {
    let isDisposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const connect = () => {
      if (isDisposed) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const playerId = getPlayerId();
      const wsUrl = `${protocol}//${window.location.host}/ws?playerId=${playerId}`;

      socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (isDisposed) {
          socket?.close();
          return;
        }
        setWsConnected(true);
        console.log("Connecté au WebSocket Blindtest");
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === "INIT") {
            setSpotifyConnected(data.spotifyConnected);
            setUsersCount(data.usersCount || 1);
            if (data.validations) {
              setValidations(data.validations);
            }
            if (data.hints) {
              setHints(data.hints);
            }
            if (data.track) {
              setTrack(data.track);
              currentTrackIdRef.current = data.track.id;
            }
          } else if (data.type === "SPOTIFY_STATUS") {
            setSpotifyConnected(data.connected);
          } else if (data.type === "USERS_COUNT") {
            setUsersCount(data.count);
          } else if (data.type === "VALIDATION_UPDATE") {
            if (data.validations) {
              setValidations(data.validations);
            }
          } else if (data.type === "HINTS_UPDATE") {
            if (data.hints) {
              setHints(data.hints);
            }
          } else if (data.type === "TRACK_UPDATE") {
            const newTrack: Track | null = data.track;
            // Si la chanson a changé, on réinitialise les révélations locales !
            if (newTrack && newTrack.id !== currentTrackIdRef.current) {
              setShowArtist(false);
              setShowTitle(false);
              setCoverState("hidden");
              currentTrackIdRef.current = newTrack.id;
              enqueueSnackbar("Nouvelle chanson en cours !", { variant: "info" });
            }
            if (data.validations) {
              setValidations(data.validations);
            }
            if (data.hints) {
              setHints(data.hints);
            } else if (newTrack && newTrack.id !== currentTrackIdRef.current) {
              setHints({ artist: [], title: [], cover: [] });
            }
            setTrack(newTrack);
            if (data.spotifyConnected !== undefined) {
              setSpotifyConnected(data.spotifyConnected);
            }
          }
        } catch (err) {
          console.error("Erreur parsing WebSocket:", err);
        }
      };

      socket.onclose = () => {
        setWsConnected(false);
        if (!isDisposed) {
          console.log("WebSocket déconnecté, reconnexion dans 2s...");
          reconnectTimeout = setTimeout(connect, 2000);
        }
      };

      socket.onerror = (err) => {
        console.error("Erreur WebSocket:", err);
        socket?.close();
      };
    };

    connect();

    return () => {
      isDisposed = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (socket) socket.close();
    };
  }, [enqueueSnackbar]);

  const myPlayerId = getPlayerId();

  const handleNextTrack = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "NEXT_TRACK" }));
      enqueueSnackbar("Passage à la chanson suivante demandé...", { variant: "default" });
    }
  };

  const handleValidate = (item: "artist" | "title") => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "VALIDATE_ITEM", item, validated: true }));
      enqueueSnackbar(`${item === "artist" ? "Artiste" : "Titre"} validé comme trouvé !`, { variant: "success" });
    }
  };

  const handleReveal = (item: "artist" | "title" | "cover") => {
    if (item === "artist") {
      setShowArtist(true);
    } else if (item === "title") {
      setShowTitle(true);
    } else if (item === "cover") {
      setCoverState((prev) => (prev === "hidden" ? "blurred" : "revealed"));
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "REVEAL_HINT", item }));
    }
  };

  const isArtistRevealedByOther = hints.artist.some((id) => id !== myPlayerId);
  const isTitleRevealedByOther = hints.title.some((id) => id !== myPlayerId);
  const isCoverRevealedByOther = hints.cover.some((id) => id !== myPlayerId);


  return (
    <ThemeProvider theme={darkTheme}>
      <Box
        sx={{
          minHeight: "100vh",
          bgcolor: "background.default",
          color: "text.primary",
          py: { xs: 1, sm: 3 },
          px: { xs: 0.5, sm: 2 },
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
        }}
      >
        <Container maxWidth="sm" disableGutters sx={{ width: "100%", px: { xs: 1, sm: 2 } }}>
          {/* Header & Statuts */}
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            mb={{ xs: 1.5, sm: 3 }}
          >
            <Typography variant="h6" fontWeight="bold" sx={{ fontSize: { xs: "1.2rem", sm: "1.4rem" } }}>
              🎵 Spot Blindtest
            </Typography>
            <Stack direction="row" spacing={1}>
              <Chip
                icon={<GroupIcon />}
                label={`${usersCount} joueur${usersCount > 1 ? "s" : ""}`}
                color="primary"
                variant="outlined"
                size="small"
              />
              <Chip
                label={wsConnected ? "En ligne" : "Reconnexion..."}
                color={wsConnected ? "success" : "warning"}
                size="small"
              />
            </Stack>
          </Stack>

          {/* Bandeau d'authentification Spotify si non connecté */}
          {!spotifyConnected ? (
            <Card sx={{ mb: 2, p: 2, textAlign: "center", bgcolor: "background.paper", borderRadius: 3 }}>
              <Typography variant="h6" gutterBottom>
                Compte Spotify non associé
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Pour écouter ce qui est joué et contrôler la lecture, connectez le compte Spotify principal.
              </Typography>
              <Button
                variant="contained"
                color="primary"
                size="large"
                href="/api/spotify/login"
                sx={{ borderRadius: 8, fontWeight: "bold", px: 4 }}
              >
                Connecter avec Spotify
              </Button>
            </Card>
          ) : null}

          {/* Zone de jeu principale */}
          <Card
            sx={{
              borderRadius: { xs: 3, sm: 4 },
              boxShadow: { xs: 3, sm: 8 },
              bgcolor: "background.paper",
              overflow: "hidden",
              width: "100%",
            }}
          >
            <CardContent
              sx={{
                p: { xs: 1.5, sm: 3.5 },
                "&:last-child": { pb: { xs: 2, sm: 3.5 } },
                textAlign: "center",
              }}
            >
              {/* État de lecture */}
              <Box mb={2}>
                {track ? (
                  <Chip
                    icon={track.isPlaying ? <PlayArrowIcon /> : <PauseIcon />}
                    label={track.isPlaying ? "En cours de lecture" : "En pause"}
                    color={track.isPlaying ? "success" : "default"}
                    size="small"
                  />
                ) : (
                  <Alert severity="info" sx={{ justifyContent: "center", py: 0.5 }}>
                    En attente de lecture sur Spotify...
                  </Alert>
                )}
              </Box>

              {/* Pochette d'album bien visible et agrandie sur mobile */}
              <Box
                sx={{
                  position: "relative",
                  width: { xs: "min(80vw, 270px)", sm: 260 },
                  height: { xs: "min(80vw, 270px)", sm: 260 },
                  mx: "auto",
                  mb: 2,
                  borderRadius: 3,
                  overflow: "hidden",
                  bgcolor: "#242424",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "2px solid #333",
                  boxShadow: "inset 0 0 20px rgba(0,0,0,0.5)",
                }}
              >
                {track?.coverUrl && coverState !== "hidden" ? (
                  <Box
                    component="img"
                    src={track.coverUrl}
                    alt="Album Cover"
                    sx={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      filter: coverState === "blurred" ? "blur(22px) saturate(120%)" : "none",
                      transform: coverState === "blurred" ? "scale(1.15)" : "scale(1)",
                      transition: "filter 0.3s ease, transform 0.3s ease",
                    }}
                  />
                ) : (
                  <Stack alignItems="center" spacing={1}>
                    <AlbumIcon sx={{ fontSize: 70, color: "#555" }} />
                    <Typography variant="caption" color="text.secondary">
                      Pochette masquée
                    </Typography>
                  </Stack>
                )}
              </Box>

              {/* Contrôles de la pochette (3 états progressifs sans recacher) */}
              <Stack direction="column" spacing={1} alignItems="center" mb={3}>
                {coverState === "hidden" && (
                  <Button
                    variant="outlined"
                    size="small"
                    color="inherit"
                    startIcon={<BlurOnIcon />}
                    onClick={() => handleReveal("cover")}
                    disabled={!track}
                  >
                    Indice : Voir floutée
                  </Button>
                )}

                {coverState === "blurred" && (
                  <Button
                    variant="contained"
                    size="small"
                    color="primary"
                    startIcon={<VisibilityIcon />}
                    onClick={() => handleReveal("cover")}
                  >
                    Révéler la pochette nette
                  </Button>
                )}

                {/* Si l'autre joueur regarde la pochette mais pas moi */}
                {coverState === "hidden" && isCoverRevealedByOther && (
                  <Chip
                    icon={<VisibilityIcon sx={{ "&&": { color: "#ffb74d" } }} />}
                    label="L'autre joueur consulte la pochette"
                    color="warning"
                    variant="outlined"
                    size="small"
                    sx={{ fontSize: "0.75rem" }}
                  />
                )}
              </Stack>


              {/* Artiste */}
              <Box
                sx={{
                  p: { xs: 1.5, sm: 2 },
                  mb: 2,
                  borderRadius: 2,
                  bgcolor: validations.artist ? "rgba(46, 125, 50, 0.15)" : "#242424",
                  border: validations.artist ? "1px solid #2e7d32" : "1px solid transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  transition: "all 0.3s ease",
                  gap: 1,
                }}
              >
                <Stack direction="row" spacing={{ xs: 1, sm: 1.5 }} alignItems="center" sx={{ overflow: "hidden", flex: 1, minWidth: 0 }}>
                  <PersonIcon color={validations.artist ? "success" : "action"} sx={{ fontSize: { xs: 22, sm: 26 } }} />
                  <Box sx={{ textAlign: "left", overflow: "hidden", minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="caption" color="text.secondary">
                        Artiste
                      </Typography>
                      {validations.artist && (
                        <Chip
                          icon={<CheckCircleIcon sx={{ "&&": { color: "#fff" } }} />}
                          label="Trouvé !"
                          color="success"
                          size="small"
                          sx={{ height: 18, fontSize: "0.65rem", fontWeight: "bold" }}
                        />
                      )}
                    </Stack>
                    <Typography
                      variant="h6"
                      fontWeight="bold"
                      noWrap
                      sx={{
                        fontSize: { xs: "0.95rem", sm: "1.2rem" },
                        letterSpacing: (showArtist || validations.artist) ? "normal" : 2,
                        color: validations.artist ? "#81c784" : showArtist ? "primary.main" : "text.secondary",
                      }}
                    >
                      {track
                        ? (showArtist || validations.artist)
                          ? track.artists
                          : "•••••••••••••"
                        : "—"}
                    </Typography>
                  </Box>
                </Stack>

                {!validations.artist ? (
                  <Stack direction="row" spacing={0.8} alignItems="center" sx={{ flexShrink: 0 }}>
                    {!showArtist && isArtistRevealedByOther && (
                      <Chip
                        icon={<VisibilityIcon sx={{ "&&": { color: "#ffb74d" } }} />}
                        label="Vu"
                        color="warning"
                        variant="outlined"
                        size="small"
                        sx={{ fontSize: "0.7rem", height: 24, px: 0.5 }}
                      />
                    )}
                    {showArtist ? (
                      <Button
                        variant="contained"
                        color="success"
                        size="small"
                        startIcon={<CheckCircleIcon />}
                        onClick={() => handleValidate("artist")}
                        sx={{ px: { xs: 1.2, sm: 2 }, fontSize: { xs: "0.8rem", sm: "0.875rem" } }}
                      >
                        Trouvé !
                      </Button>
                    ) : (
                      <Button
                        variant="contained"
                        color="primary"
                        size="small"
                        startIcon={<VisibilityIcon />}
                        onClick={() => handleReveal("artist")}
                        disabled={!track}
                        sx={{ px: { xs: 1.2, sm: 2 }, fontSize: { xs: "0.8rem", sm: "0.875rem" } }}
                      >
                        Révéler
                      </Button>
                    )}
                  </Stack>
                ) : (
                  <Chip
                    icon={<CheckCircleIcon />}
                    label="Validé ✅"
                    color="success"
                    variant="outlined"
                    size="small"
                    sx={{ flexShrink: 0 }}
                  />
                )}
              </Box>

              {/* Titre */}
              <Box
                sx={{
                  p: { xs: 1.5, sm: 2 },
                  mb: 2.5,
                  borderRadius: 2,
                  bgcolor: validations.title ? "rgba(46, 125, 50, 0.15)" : "#242424",
                  border: validations.title ? "1px solid #2e7d32" : "1px solid transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  transition: "all 0.3s ease",
                  gap: 1,
                }}
              >
                <Stack direction="row" spacing={{ xs: 1, sm: 1.5 }} alignItems="center" sx={{ overflow: "hidden", flex: 1, minWidth: 0 }}>
                  <MusicNoteIcon color={validations.title ? "success" : "action"} sx={{ fontSize: { xs: 22, sm: 26 } }} />
                  <Box sx={{ textAlign: "left", overflow: "hidden", minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="caption" color="text.secondary">
                        Titre
                      </Typography>
                      {validations.title && (
                        <Chip
                          icon={<CheckCircleIcon sx={{ "&&": { color: "#fff" } }} />}
                          label="Trouvé !"
                          color="success"
                          size="small"
                          sx={{ height: 18, fontSize: "0.65rem", fontWeight: "bold" }}
                        />
                      )}
                    </Stack>
                    <Typography
                      variant="h6"
                      fontWeight="bold"
                      noWrap
                      sx={{
                        fontSize: { xs: "0.95rem", sm: "1.2rem" },
                        letterSpacing: (showTitle || validations.title) ? "normal" : 2,
                        color: validations.title ? "#81c784" : showTitle ? "primary.main" : "text.secondary",
                      }}
                    >
                      {track
                        ? (showTitle || validations.title)
                          ? track.title
                          : "•••••••••••••"
                        : "—"}
                    </Typography>
                  </Box>
                </Stack>

                {!validations.title ? (
                  <Stack direction="row" spacing={0.8} alignItems="center" sx={{ flexShrink: 0 }}>
                    {!showTitle && isTitleRevealedByOther && (
                      <Chip
                        icon={<VisibilityIcon sx={{ "&&": { color: "#ffb74d" } }} />}
                        label="Vu"
                        color="warning"
                        variant="outlined"
                        size="small"
                        sx={{ fontSize: "0.7rem", height: 24, px: 0.5 }}
                      />
                    )}
                    {showTitle ? (
                      <Button
                        variant="contained"
                        color="success"
                        size="small"
                        startIcon={<CheckCircleIcon />}
                        onClick={() => handleValidate("title")}
                        sx={{ px: { xs: 1.2, sm: 2 }, fontSize: { xs: "0.8rem", sm: "0.875rem" } }}
                      >
                        Trouvé !
                      </Button>
                    ) : (
                      <Button
                        variant="contained"
                        color="primary"
                        size="small"
                        startIcon={<VisibilityIcon />}
                        onClick={() => handleReveal("title")}
                        disabled={!track}
                        sx={{ px: { xs: 1.2, sm: 2 }, fontSize: { xs: "0.8rem", sm: "0.875rem" } }}
                      >
                        Révéler
                      </Button>
                    )}
                  </Stack>
                ) : (
                  <Chip
                    icon={<CheckCircleIcon />}
                    label="Validé ✅"
                    color="success"
                    variant="outlined"
                    size="small"
                    sx={{ flexShrink: 0 }}
                  />
                )}
              </Box>

              {/* Bouton Chanson suivante */}
              <Button
                variant="contained"
                color="primary"
                fullWidth
                size="large"
                startIcon={<SkipNextIcon sx={{ fontSize: { xs: 24, sm: 28 } }} />}
                onClick={handleNextTrack}
                disabled={!spotifyConnected}
                sx={{
                  py: { xs: 1.4, sm: 1.8 },
                  fontSize: { xs: "1rem", sm: "1.1rem" },
                  fontWeight: "bold",
                  borderRadius: 3,
                  boxShadow: "0 4px 14px rgba(29, 185, 84, 0.4)",
                  "&:hover": {
                    bgcolor: "#1ed760",
                  },
                }}
              >
                Chanson suivante
              </Button>
            </CardContent>
          </Card>
        </Container>
      </Box>
    </ThemeProvider>
  );
};

export default App;
