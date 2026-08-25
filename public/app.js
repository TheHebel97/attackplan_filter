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
  outputTab: "attackplan:output-tab",
};
const OUTPUT_TABS = {
  default: "default",
  split: "split",
  player: "player",
  unit: "unit",
};
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
  outputTab: OUTPUT_TABS.default,
};

const elements = {
  serverSelect: document.querySelector("#server-select"),
  playerSearch: document.querySelector("#player-search"),
  autocomplete: document.querySelector("#autocomplete"),
  suggestedPlayers: document.querySelector("#suggested-players"),
  suggestedCount: document.querySelector("#suggested-count"),
  activePlayers: document.querySelector("#active-players"),
  attackInput: document.querySelector("#attack-input"),
  attackOutput: document.querySelector("#attack-output"),
  attackOutputSnob: document.querySelector("#attack-output-snob"),
  attackOutputOther: document.querySelector("#attack-output-other"),
  copyOutputDefault: document.querySelector("#copy-output-default"),
  copyOutputSnob: document.querySelector("#copy-output-snob"),
  copyOutputOther: document.querySelector("#copy-output-other"),
  tabDefault: document.querySelector("#tab-default"),
  tabSplit: document.querySelector("#tab-split"),
  tabPlayer: document.querySelector("#tab-player"),
  tabUnit: document.querySelector("#tab-unit"),
  outputPaneDefault: document.querySelector("#output-pane-default"),
  outputPaneSplit: document.querySelector("#output-pane-split"),
  outputPanePlayer: document.querySelector("#output-pane-player"),
  outputPaneUnit: document.querySelector("#output-pane-unit"),
  outputByPlayer: document.querySelector("#output-by-player"),
  outputByUnit: document.querySelector("#output-by-unit"),
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
  restoreOutputTab();
  bindEvents();
  selectOutputTab(state.outputTab);
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

  elements.tabDefault.addEventListener("click", () => selectOutputTab(OUTPUT_TABS.default));
  elements.tabSplit.addEventListener("click", () => selectOutputTab(OUTPUT_TABS.split));
  elements.tabPlayer.addEventListener("click", () => selectOutputTab(OUTPUT_TABS.player));
  elements.tabUnit.addEventListener("click", () => selectOutputTab(OUTPUT_TABS.unit));

  bindCopyButton(elements.copyOutputDefault, () => elements.attackOutput.value, "Aktuelle Ausgabe in die Zwischenablage kopiert.");
  bindCopyButton(elements.copyOutputSnob, () => elements.attackOutputSnob.value, "Snob-Ausgabe in die Zwischenablage kopiert.");
  bindCopyButton(elements.copyOutputOther, () => elements.attackOutputOther.value, "Restliche Ausgabe in die Zwischenablage kopiert.");
}

function bindCopyButton(button, getValue, successMessage) {
  button.addEventListener("click", async () => {
    const value = getValue();
    if (!value) {
      return;
    }

    await copyText(value, successMessage);
  });
}

async function copyText(value, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
    setStatus(successMessage);
  } catch (error) {
    setStatus(`Kopieren fehlgeschlagen: ${error.message}`);
  }
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
  try {
    setStatus(`Weltdaten fuer ${serverCode.toUpperCase()} werden geladen...`);
    const [playerText, villageText] = await Promise.all([
      fetchWorldFile(serverCode, "player.txt"),
      fetchWorldFile(serverCode, "village.txt"),
    ]);

    const payload = {
      players: parsePlayers(playerText),
      villages: parseVillages(villageText),
    };

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

function restoreOutputTab() {
  const storedTab = localStorage.getItem(STORAGE_KEYS.outputTab);
  state.outputTab = Object.values(OUTPUT_TABS).includes(storedTab) ? storedTab : OUTPUT_TABS.default;
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
      const leftName = left.name.toLocaleLowerCase("de");
      const rightName = right.name.toLocaleLowerCase("de");
      const leftStarts = leftName.startsWith(term) ? 0 : 1;
      const rightStarts = rightName.startsWith(term) ? 0 : 1;
      if (leftStarts !== rightStarts) {
        return leftStarts - rightStarts;
      }

      const leftAttackCount = state.attackBuckets.get(left.id)?.length || 0;
      const rightAttackCount = state.attackBuckets.get(right.id)?.length || 0;
      const leftSuggested = leftAttackCount > 0 ? 0 : 1;
      const rightSuggested = rightAttackCount > 0 ? 0 : 1;
      if (leftSuggested !== rightSuggested) {
        return leftSuggested - rightSuggested;
      }
      if (leftAttackCount !== rightAttackCount) {
        return rightAttackCount - leftAttackCount;
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
      const meta = [`${attackCount} Angriffe`];
      if (attackCount > 0) {
        meta.push("im Plan");
      }
      if (selected) {
        meta.push("aktiv");
      }
      return `
        <button
          class="autocomplete__item"
          type="button"
          data-player-id="${player.id}"
          data-active="${index === 0 ? "true" : "false"}"
        >
          <span>${escapeHtml(player.name)}</span>
          <span class="autocomplete__meta">${meta.join(" | ")}</span>
        </button>
      `;
    })
    .join("");

  elements.autocomplete.hidden = false;
  elements.autocomplete.querySelectorAll(".autocomplete__item").forEach((item) => {
    item.addEventListener("mouseenter", () => {
      const items = getAutocompleteItems();
      setHighlightedAutocompleteItem(items, items.indexOf(item));
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
  renderSuggestedPlayers();
  renderActivePlayers();
  renderOutput();
}

function deactivatePlayer(playerId) {
  state.activePlayers.delete(playerId);
  persistActivePlayers();
  renderSuggestedPlayers();
  renderActivePlayers();
  renderOutput();
  updateAutocomplete();
}

function renderSuggestedPlayers() {
  const players = getSuggestedPlayers();
  elements.suggestedCount.textContent = `${players.length} vorgeschlagen`;

  if (!players.length) {
    elements.suggestedPlayers.innerHTML = '<p class="empty-state">Noch keine Spieler aus dem Angriffsplan erkannt.</p>';
    return;
  }

  elements.suggestedPlayers.innerHTML = players
    .map(({ player, attackCount }) => `
      <button class="player-chip player-chip--suggested" type="button" data-player-id="${player.id}">
        <span>${escapeHtml(player.name)}</span>
        <strong>${attackCount}</strong>
      </button>
    `)
    .join("");

  elements.suggestedPlayers.querySelectorAll(".player-chip").forEach((button) => {
    button.addEventListener("click", () => activatePlayer(button.dataset.playerId));
  });
}

function getSuggestedPlayers() {
  return Array.from(state.attackBuckets.entries())
    .map(([playerId, attacks]) => ({
      player: state.playerMap.get(playerId),
      attackCount: attacks.length,
    }))
    .filter(({ player }) => player && !state.activePlayers.has(player.id))
    .sort((left, right) => {
      if (left.attackCount !== right.attackCount) {
        return right.attackCount - left.attackCount;
      }
      return left.player.name.localeCompare(right.player.name, "de");
    });
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
  renderSuggestedPlayers();
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
  const filtered = getFilteredAttacks();
  const splitOutput = splitAttacks(filtered);

  elements.attackOutput.value = filtered.join("\n");
  elements.attackOutputSnob.value = splitOutput.snob.join("\n");
  elements.attackOutputOther.value = splitOutput.other.join("\n");
  renderGroupedOutput(
    elements.outputByPlayer,
    getAttacksGroupedByPlayer(),
    "Aktiviere Spieler mit passenden Angriffen, um getrennte Plaene zu erzeugen.",
    "Spieler",
  );
  renderGroupedOutput(
    elements.outputByUnit,
    getAttacksGroupedByUnit(filtered),
    "Keine Einheitentypen in der aktuellen Ausgabe erkannt.",
    "Einheitentyp",
  );
  elements.filteredAttackCount.textContent = String(filtered.length);
}

function getFilteredAttacks() {
  return Array.from(state.activePlayers)
    .flatMap((playerId) => state.attackBuckets.get(playerId) || []);
}

function splitAttacks(attacks) {
  const snob = [];
  const other = [];

  for (const attack of attacks) {
    if (getAttackType(attack) === "snob") {
      snob.push(attack);
    } else {
      other.push(attack);
    }
  }

  return { snob, other };
}

function getAttackType(attackCode) {
  return attackCode.split("&")[2]?.trim().toLocaleLowerCase("de") || "";
}

function getAttacksGroupedByPlayer() {
  return Array.from(state.activePlayers)
    .map((playerId) => ({
      label: state.playerMap.get(playerId)?.name || `Spieler ${playerId}`,
      attacks: state.attackBuckets.get(playerId) || [],
    }))
    .filter((group) => group.attacks.length > 0)
    .sort((left, right) => left.label.localeCompare(right.label, "de"));
}

function getAttacksGroupedByUnit(attacks) {
  const groups = new Map();

  for (const attack of attacks) {
    const type = getAttackType(attack) || "unbekannt";
    if (!groups.has(type)) {
      groups.set(type, []);
    }
    groups.get(type).push(attack);
  }

  return Array.from(groups, ([type, groupedAttacks]) => ({
    label: type === "unbekannt" ? "Unbekannt" : type.toLocaleUpperCase("de"),
    attacks: groupedAttacks,
  })).sort((left, right) => left.label.localeCompare(right.label, "de"));
}

function renderGroupedOutput(container, groups, emptyMessage, groupKind) {
  if (!groups.length) {
    container.innerHTML = `<p class="empty-state grouped-output__empty">${escapeHtml(emptyMessage)}</p>`;
    return;
  }

  container.innerHTML = groups
    .map((group, index) => `
      <article class="split-output__card">
        <div class="panel__header panel__header--compact">
          <div>
            <h3>${escapeHtml(group.label)}</h3>
            <span class="grouped-output__count">${group.attacks.length} ${group.attacks.length === 1 ? "Angriff" : "Angriffe"}</span>
          </div>
          <button class="ghost-button" type="button" data-copy-group="${index}">Kopieren</button>
        </div>
        <textarea
          class="code-area grouped-output__area"
          data-group-output="${index}"
          spellcheck="false"
          readonly
        ></textarea>
      </article>
    `)
    .join("");

  container.querySelectorAll("[data-group-output]").forEach((textarea) => {
    const group = groups[Number(textarea.dataset.groupOutput)];
    textarea.value = group.attacks.join("\n");
  });

  container.querySelectorAll("[data-copy-group]").forEach((button) => {
    button.addEventListener("click", async () => {
      const group = groups[Number(button.dataset.copyGroup)];
      await copyText(group.attacks.join("\n"), `${groupKind} ${group.label}: Plan in die Zwischenablage kopiert.`);
    });
  });
}

function selectOutputTab(tabId) {
  const nextTab = Object.values(OUTPUT_TABS).includes(tabId) ? tabId : OUTPUT_TABS.default;
  state.outputTab = nextTab;
  localStorage.setItem(STORAGE_KEYS.outputTab, nextTab);

  const tabs = {
    [OUTPUT_TABS.default]: elements.tabDefault,
    [OUTPUT_TABS.split]: elements.tabSplit,
    [OUTPUT_TABS.player]: elements.tabPlayer,
    [OUTPUT_TABS.unit]: elements.tabUnit,
  };
  const panes = {
    [OUTPUT_TABS.default]: elements.outputPaneDefault,
    [OUTPUT_TABS.split]: elements.outputPaneSplit,
    [OUTPUT_TABS.player]: elements.outputPanePlayer,
    [OUTPUT_TABS.unit]: elements.outputPaneUnit,
  };

  Object.entries(tabs).forEach(([id, tab]) => {
    tab.setAttribute("aria-selected", String(id === nextTab));
  });
  Object.entries(panes).forEach(([id, pane]) => {
    pane.hidden = id !== nextTab;
  });
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

