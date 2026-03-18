const SERVER_LIST_URL = "/proxy?url=https%3A%2F%2Fwww.die-staemme.de%2Fbackend%2Fget_servers.php";
const FALLBACK_SERVERS = [
  "dec4",
  "dep19",
  "dep20",
  "de243",
  "de244",
  "de245",
  "de246",
  "de247",
  "de248",
  "de249",
  "de250",
  "de251",
  "de252",
  "de253",
].map((code) => ({ code, url: `https://${code}.die-staemme.de` }));
const STORAGE_KEYS = {
  selectedServer: "attackplan:selected-server",
  activePlayers: "attackplan:active-players",
  attackInput: "attackplan:attack-input",
};
const CACHE_TTL_MS = 15 * 60 * 1000;

const state = {
  servers: [],
  selectedServer: "",
  players: [],
  villages: [],
  playerMap: new Map(),
  villageToPlayerMap: new Map(),
  activePlayers: new Set(),
  attacks: [],
  attackBuckets: new Map(),
  villageOwnerCache: new Map(),
};

const elements = {
  serverSelect: document.querySelector("#server-select"),
  playerSearch: document.querySelector("#player-search"),
  autocomplete: document.querySelector("#autocomplete"),
  activePlayers: document.querySelector("#active-players"),
  attackInput: document.querySelector("#attack-input"),
  attackOutput: document.querySelector("#attack-output"),
  copyOutput: document.querySelector("#copy-output"),
  statusText: document.querySelector("#status-text"),
  playerCount: document.querySelector("#player-count"),
  activeCount: document.querySelector("#active-count"),
  attackSummary: document.querySelector("#attack-summary"),
  matchedPlayerCount: document.querySelector("#matched-player-count"),
  filteredAttackCount: document.querySelector("#filtered-attack-count"),
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  restoreAttackInput();
  bindEvents();
  await loadServers();
}

function bindEvents() {
  elements.serverSelect.addEventListener("change", async (event) => {
    const nextServer = event.target.value;
    if (!nextServer || nextServer === state.selectedServer) {
      return;
    }

    state.selectedServer = nextServer;
    localStorage.setItem(STORAGE_KEYS.selectedServer, nextServer);
    await loadWorldData(nextServer);
    updateAutocomplete();
    updateAttackAnalysis();
    renderActivePlayers();
  });

  elements.playerSearch.addEventListener("input", () => {
    updateAutocomplete();
  });

  elements.playerSearch.addEventListener("keydown", (event) => {
    const items = getAutocompleteItems();
    if (!items.length) {
      return;
    }

    const highlighted = items.findIndex((item) => item.dataset.active === "true");
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedAutocompleteItem(items, highlighted + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedAutocompleteItem(items, highlighted <= 0 ? items.length - 1 : highlighted - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = highlighted >= 0 ? items[highlighted] : items[0];
      if (target) {
        activatePlayer(target.dataset.playerId);
      }
    } else if (event.key === "Escape") {
      hideAutocomplete();
    }
  });

  document.addEventListener("click", (event) => {
    if (!elements.autocomplete.contains(event.target) && event.target !== elements.playerSearch) {
      hideAutocomplete();
    }
  });

  elements.attackInput.addEventListener("input", () => {
    localStorage.setItem(STORAGE_KEYS.attackInput, elements.attackInput.value);
    updateAttackAnalysis();
  });

  elements.copyOutput.addEventListener("click", async () => {
    if (!elements.attackOutput.value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(elements.attackOutput.value);
      setStatus("Output in die Zwischenablage kopiert.");
    } catch (error) {
      setStatus(`Kopieren fehlgeschlagen: ${error.message}`);
    }
  });
}

async function loadServers() {
  setStatus("Serverliste wird geladen...");

  try {
    const response = await fetch(SERVER_LIST_URL);
    if (!response.ok) {
      throw await buildFetchError(response, `Serverliste HTTP ${response.status}`);
    }

    const raw = await response.text();
    const parsedServers = parseServerList(raw);
    if (!parsedServers.length) {
      throw new Error("Keine Server aus der Live-Antwort erkannt.");
    }

    state.servers = parsedServers;
    await hydrateInitialServerSelection();
    setStatus("Serverliste geladen.");
  } catch (error) {
    state.servers = FALLBACK_SERVERS;
    await hydrateInitialServerSelection();
    setStatus(`Serverliste live fehlgeschlagen, Fallback genutzt: ${error.message}`);
  }
}

function parseServerList(payload) {
  const bodyMatch = payload.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const source = (bodyMatch ? bodyMatch[1] : payload).trim();
  const regex = /s:\d+:"([^"]+)";s:\d+:"https:\/\/([^".]+)\.die-staemme\.de"/g;
  const servers = [];
  let match;

  while ((match = regex.exec(source)) !== null) {
    const code = match[1] || match[2];
    servers.push({ code, url: `https://${match[2]}.die-staemme.de` });
  }

  return servers.sort((left, right) => left.code.localeCompare(right.code, "de"));
}

function renderServerSelect() {
  const options = state.servers.length
    ? state.servers.map((server) => `<option value="${server.code}">${server.code.toUpperCase()}</option>`).join("")
    : '<option value="">Keine Welten verfuegbar</option>';
  elements.serverSelect.innerHTML = options;
}

async function hydrateInitialServerSelection() {
  renderServerSelect();

  const storedServer = localStorage.getItem(STORAGE_KEYS.selectedServer);
  const initialServer = state.servers.find((server) => server.code === storedServer)?.code || state.servers[0]?.code || "";
  if (!initialServer) {
    throw new Error("Keine Server gefunden.");
  }

  state.selectedServer = initialServer;
  elements.serverSelect.value = initialServer;
  localStorage.setItem(STORAGE_KEYS.selectedServer, initialServer);
  await loadWorldData(initialServer);
  updateAttackAnalysis();
}

async function buildFetchError(response, fallbackMessage) {
  try {
    const payload = await response.clone().json();
    if (payload?.error) {
      return new Error(payload.error);
    }
  } catch {
  }

  try {
    const text = (await response.clone().text()).trim();
    if (text) {
      return new Error(text);
    }
  } catch {
  }

  return new Error(fallbackMessage);
}

async function loadWorldData(serverCode) {
  const cacheKey = `attackplan:world-cache:${serverCode}`;
  const cached = readSessionCache(cacheKey);
  if (cached) {
    hydrateWorldData(cached, serverCode);
    setStatus(`Weltdaten fuer ${serverCode.toUpperCase()} aus dem Session-Cache geladen.`);
    return;
  }

  try {
    setStatus(`Weltdaten fuer ${serverCode.toUpperCase()} werden geladen...`);
    const [playerText, villageText] = await Promise.all([
      fetchWorldFile(serverCode, "player.txt"),
      fetchWorldFile(serverCode, "village.txt"),
    ]);

    const payload = {
      players: parsePlayers(playerText),
      villages: parseVillages(villageText),
      savedAt: Date.now(),
    };

    sessionStorage.setItem(cacheKey, JSON.stringify(payload));
    hydrateWorldData(payload, serverCode);
    setStatus(`Weltdaten fuer ${serverCode.toUpperCase()} geladen.`);
  } catch (error) {
    state.players = [];
    state.villages = [];
    state.playerMap = new Map();
    state.villageToPlayerMap = new Map();
    state.villageOwnerCache = new Map();
    state.activePlayers = new Set();
    elements.playerCount.textContent = "0 Spieler";
    setStatus(`Weltdaten fuer ${serverCode.toUpperCase()} konnten nicht geladen werden: ${error.message}`);
  }
}

async function fetchWorldFile(serverCode, fileName) {
  const upstreamUrl = `https://${serverCode}.die-staemme.de/map/${fileName}`;
  const url = `/proxy?url=${encodeURIComponent(upstreamUrl)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw await buildFetchError(response, `${fileName} HTTP ${response.status}`);
  }
  return response.text();
}

function parsePlayers(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, rawName, allyId, villages, points, rank] = line.split(",");
      return {
        id,
        name: decodeGameText(rawName),
        allyId,
        villages: Number(villages || 0),
        points: Number(points || 0),
        rank: Number(rank || 0),
      };
    });
}

function parseVillages(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, rawName, x, y, playerId, points, bonus] = line.split(",");
      return {
        id,
        name: decodeGameText(rawName),
        x: Number(x || 0),
        y: Number(y || 0),
        playerId,
        points: Number(points || 0),
        bonus,
      };
    });
}

function hydrateWorldData(payload, serverCode) {
  state.players = payload.players || [];
  state.villages = payload.villages || [];
  state.playerMap = new Map(state.players.map((player) => [player.id, player]));
  state.villageToPlayerMap = new Map(state.villages.map((village) => [village.id, village.playerId]));
  state.villageOwnerCache = new Map();
  restoreActivePlayers(serverCode);
  elements.playerCount.textContent = `${state.players.length} Spieler`;
}

function restoreActivePlayers(serverCode) {
  const raw = localStorage.getItem(`${STORAGE_KEYS.activePlayers}:${serverCode}`);
  const parsed = raw ? JSON.parse(raw) : [];
  const validIds = new Set(state.players.map((player) => player.id));
  state.activePlayers = new Set(parsed.filter((id) => validIds.has(id)));
}

function persistActivePlayers() {
  if (!state.selectedServer) {
    return;
  }
  localStorage.setItem(
    `${STORAGE_KEYS.activePlayers}:${state.selectedServer}`,
    JSON.stringify(Array.from(state.activePlayers)),
  );
}

function restoreAttackInput() {
  elements.attackInput.value = localStorage.getItem(STORAGE_KEYS.attackInput) || "";
}

function decodeGameText(value) {
  return decodeURIComponent((value || "").replace(/\+/g, " "));
}

function updateAutocomplete() {
  const term = elements.playerSearch.value.trim().toLocaleLowerCase("de");
  if (!term || !state.players.length) {
    hideAutocomplete();
    return;
  }

  const results = state.players
    .filter((player) => player.name.toLocaleLowerCase("de").includes(term))
    .sort((left, right) => {
      const leftStarts = left.name.toLocaleLowerCase("de").startsWith(term) ? 0 : 1;
      const rightStarts = right.name.toLocaleLowerCase("de").startsWith(term) ? 0 : 1;
      if (leftStarts !== rightStarts) {
        return leftStarts - rightStarts;
      }
      return left.name.localeCompare(right.name, "de");
    })
    .slice(0, 8);

  if (!results.length) {
    hideAutocomplete();
    return;
  }

  elements.autocomplete.innerHTML = results
    .map((player, index) => {
      const attackCount = state.attackBuckets.get(player.id)?.length || 0;
      const selected = state.activePlayers.has(player.id);
      return `
        <button
          class="autocomplete__item"
          type="button"
          data-player-id="${player.id}"
          data-active="${index === 0 ? "true" : "false"}"
        >
          <span>${escapeHtml(player.name)}</span>
          <span class="autocomplete__meta">${attackCount} Angriffe${selected ? " | aktiv" : ""}</span>
        </button>
      `;
    })
    .join("");

  elements.autocomplete.hidden = false;
  elements.autocomplete.querySelectorAll(".autocomplete__item").forEach((item) => {
    item.addEventListener("mouseenter", () => {
      setHighlightedAutocompleteItem(getAutocompleteItems(), getAutocompleteItems().indexOf(item));
    });
    item.addEventListener("click", () => activatePlayer(item.dataset.playerId));
  });
}

function getAutocompleteItems() {
  return Array.from(elements.autocomplete.querySelectorAll(".autocomplete__item"));
}

function setHighlightedAutocompleteItem(items, targetIndex) {
  if (!items.length) {
    return;
  }

  const normalizedIndex = ((targetIndex % items.length) + items.length) % items.length;
  items.forEach((item, index) => {
    item.dataset.active = index === normalizedIndex ? "true" : "false";
  });
}

function hideAutocomplete() {
  elements.autocomplete.hidden = true;
  elements.autocomplete.innerHTML = "";
}

function activatePlayer(playerId) {
  if (!playerId) {
    return;
  }

  state.activePlayers.add(playerId);
  persistActivePlayers();
  elements.playerSearch.value = "";
  hideAutocomplete();
  renderActivePlayers();
  renderOutput();
}

function deactivatePlayer(playerId) {
  state.activePlayers.delete(playerId);
  persistActivePlayers();
  renderActivePlayers();
  renderOutput();
}

function renderActivePlayers() {
  const players = Array.from(state.activePlayers)
    .map((playerId) => state.playerMap.get(playerId))
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name, "de"));

  elements.activeCount.textContent = `${players.length} ausgewaehlt`;

  if (!players.length) {
    elements.activePlayers.innerHTML = '<p class="empty-state">Noch keine Spieler ausgewaehlt.</p>';
    return;
  }

  elements.activePlayers.innerHTML = players
    .map((player) => {
      const attackCount = state.attackBuckets.get(player.id)?.length || 0;
      return `
        <button class="player-chip" type="button" data-player-id="${player.id}">
          <span>${escapeHtml(player.name)}</span>
          <strong>${attackCount}</strong>
        </button>
      `;
    })
    .join("");

  elements.activePlayers.querySelectorAll(".player-chip").forEach((button) => {
    button.addEventListener("click", () => deactivatePlayer(button.dataset.playerId));
  });
}

function updateAttackAnalysis() {
  state.attacks = elements.attackInput.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  state.attackBuckets = new Map();
  state.villageOwnerCache = new Map();

  for (const attackCode of state.attacks) {
    const originVillageId = attackCode.split("&", 1)[0];
    const playerId = resolveVillageOwner(originVillageId);
    if (!playerId) {
      continue;
    }

    if (!state.attackBuckets.has(playerId)) {
      state.attackBuckets.set(playerId, []);
    }
    state.attackBuckets.get(playerId).push(attackCode);
  }

  elements.attackSummary.textContent = `${state.attacks.length} Zeilen`;
  elements.matchedPlayerCount.textContent = String(state.attackBuckets.size);
  renderActivePlayers();
  renderOutput();
  updateAutocomplete();
}

function resolveVillageOwner(villageId) {
  if (state.villageOwnerCache.has(villageId)) {
    return state.villageOwnerCache.get(villageId);
  }

  const playerId = state.villageToPlayerMap.get(villageId) || "";
  state.villageOwnerCache.set(villageId, playerId);
  return playerId;
}

function renderOutput() {
  const filtered = Array.from(state.activePlayers)
    .flatMap((playerId) => state.attackBuckets.get(playerId) || []);

  elements.attackOutput.value = filtered.join("\n");
  elements.filteredAttackCount.textContent = String(filtered.length);
}

function readSessionCache(cacheKey) {
  const raw = sessionStorage.getItem(cacheKey);
  if (!raw) {
    return null;
  }

  try {
    const payload = JSON.parse(raw);
    if (!payload.savedAt || Date.now() - payload.savedAt > CACHE_TTL_MS) {
      sessionStorage.removeItem(cacheKey);
      return null;
    }
    return payload;
  } catch {
    sessionStorage.removeItem(cacheKey);
    return null;
  }
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}




