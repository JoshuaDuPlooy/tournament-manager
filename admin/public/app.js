const state = {
  tournament: null,
  entries: [],
  groups: [],
  rankings: [],
  knockouts: [],
  schedule: { tables: [], rows: [] },
};

const EVENT_COLORS = ["#FFD6D6", "#FFE8C2", "#FFF6BF", "#DFFFD6", "#C2F0E8", "#C2E0FF", "#D9C2FF", "#FFC2E8"];

function eventColor(event) {
  const events = state.tournament.events || [];
  const idx = events.indexOf(event);
  return EVENT_COLORS[(idx >= 0 ? idx : 0) % EVENT_COLORS.length];
}

function matchEventForText(text) {
  const events = state.tournament.events || [];
  const lower = text.toLowerCase();
  return events.find((ev) => lower.startsWith(ev.toLowerCase())) || null;
}

// Groups render as "Event / Group N" (2 lines); knockout matches as "Event / Round / Match N" (3 lines).
function formatScheduleCell(text, event) {
  if (!event) return text;
  const rest = text
    .slice(event.length)
    .trim()
    .replace(/\s+/g, " ");
  if (/^Group\s+\d+$/i.test(rest)) {
    return `${event}<br>${rest}`;
  }
  const matchSplit = rest.match(/^(.*?)\s+(Match\s+\d+)$/i);
  if (matchSplit) {
    return `${event}<br>${matchSplit[1].trim()}<br>${matchSplit[2].trim()}`;
  }
  return `${event}<br>${rest}`;
}

// ---- Schedule lookups (used by Groups and Knockouts to show time/table) ----

function scheduleHitsForGroup(schedule, event, groupNumber) {
  const hits = [];
  (schedule.rows || []).forEach((row) => {
    Object.entries(row.cells || {}).forEach(([table, text]) => {
      if (!text.toLowerCase().startsWith(event.toLowerCase())) return;
      const rest = text.slice(event.length).trim().replace(/\s+/g, " ");
      if (new RegExp(`^Group\\s+${groupNumber}$`, "i").test(rest)) {
        hits.push({ time: row.time, table });
      }
    });
  });
  return hits;
}

// Lenient: schedule sheets abbreviate rounds inconsistently (e.g. "R16", "Quater" — a typo for
// Quarter — "Semi", "Final"), so this matches by prefix rather than requiring an exact label.
function scheduleRoundTokenMatches(token, roundNumber, totalRoundsCount) {
  const fromEnd = totalRoundsCount - roundNumber;
  const t = token.toLowerCase().replace(/\s+/g, "");
  if (fromEnd === 0) return t.startsWith("final");
  if (fromEnd === 1) return t.startsWith("semi");
  if (fromEnd === 2) return t.startsWith("quat");
  const size = Math.pow(2, fromEnd + 1);
  return t === `r${size}` || t.startsWith(`round${size}`) || t.startsWith(`roundof${size}`);
}

function scheduleHitsForMatch(schedule, event, roundNumber, totalRoundsCount, matchNumber) {
  const hits = [];
  (schedule.rows || []).forEach((row) => {
    Object.entries(row.cells || {}).forEach(([table, text]) => {
      if (!text.toLowerCase().startsWith(event.toLowerCase())) return;
      const rest = text.slice(event.length).trim().replace(/\s+/g, " ");
      const m = rest.match(/^(.*?)\s+Match\s+(\d+)$/i);
      if (!m || Number(m[2]) !== matchNumber) return;
      if (!scheduleRoundTokenMatches(m[1].trim(), roundNumber, totalRoundsCount)) return;
      hits.push({ time: row.time, table });
    });
  });
  return hits;
}

function formatScheduleHits(hits) {
  if (!hits || hits.length === 0) return null;
  const times = Array.from(new Set(hits.map((h) => h.time))).sort();
  const tables = Array.from(new Set(hits.map((h) => h.table))).sort((a, b) => Number(a) - Number(b));
  const tableLabel = tables.length > 1 ? `Tables ${tables.join(", ")}` : `Table ${tables[0]}`;
  return { timeLabel: times[0], tableLabel };
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---- Top-level tabs ----

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ---- Entries sub-tabs ----

document.querySelectorAll(".subtab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".subtab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".subtab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`subtab-${btn.dataset.subtab}`).classList.add("active");
  });
});

// ---- Tournament form ----

const tournamentForm = document.getElementById("tournament-form");
const tournamentStatus = document.getElementById("tournament-status");

function renderTournamentForm() {
  const t = state.tournament;
  tournamentForm.name.value = t.name || "";
  tournamentForm.season.value = t.season || "";
  tournamentForm.events.value = (t.events || []).join(", ");
  tournamentForm.startDate.value = t.startDate || "";
  tournamentForm.endDate.value = t.endDate || "";
  tournamentForm.venue.value = t.venue || "";
  tournamentForm.entryFee.value = t.entryFee ?? 0;
}

tournamentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(tournamentForm);
  const payload = {
    name: form.get("name"),
    season: form.get("season"),
    events: form
      .get("events")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
    startDate: form.get("startDate"),
    endDate: form.get("endDate"),
    venue: form.get("venue"),
    entryFee: Number(form.get("entryFee")) || 0,
    pointsWin: state.tournament.pointsWin,
    pointsDraw: state.tournament.pointsDraw,
    pointsLoss: state.tournament.pointsLoss,
  };
  const updated = await api("/api/tournament", { method: "PUT", body: JSON.stringify(payload) });
  state.tournament = updated;
  tournamentStatus.textContent = "Saved.";
  setTimeout(() => (tournamentStatus.textContent = ""), 2000);
  populateEventControls();
  renderEntriesOverall();
  renderEntriesByEvent();
  renderGroups();
  refreshRankings();
  renderKnockoutsTab();
  renderScheduleTab();
});

// ---- Public visibility toggle ----

const entriesVisibleToggle = document.getElementById("entries-visible-toggle");

entriesVisibleToggle.addEventListener("change", async () => {
  const updated = await api("/api/tournament", {
    method: "PUT",
    body: JSON.stringify({ entriesVisible: entriesVisibleToggle.checked }),
  });
  state.tournament = updated;
});

const groupsVisibleToggle = document.getElementById("groups-visible-toggle");

groupsVisibleToggle.addEventListener("change", async () => {
  const updated = await api("/api/tournament", {
    method: "PUT",
    body: JSON.stringify({ groupsVisible: groupsVisibleToggle.checked }),
  });
  state.tournament = updated;
});

// ---- Event-dependent controls (entry form checkboxes + event filter) ----

const eventCheckboxContainer = document.getElementById("entry-events-checkboxes");
const eventFilterSelect = document.getElementById("event-filter");

function populateEventControls() {
  const events = state.tournament.events || [];

  eventCheckboxContainer.innerHTML = events
    .map(
      (ev) => `
        <label><input type="checkbox" name="events" value="${ev}" /> ${ev}</label>
      `
    )
    .join("");

  const previousFilter = eventFilterSelect.value;
  eventFilterSelect.innerHTML = events.map((ev) => `<option value="${ev}">${ev}</option>`).join("");
  if (events.includes(previousFilter)) {
    eventFilterSelect.value = previousFilter;
  }

  renderGroupEventTabs();
  renderKnockoutsEventTabs();
}

eventFilterSelect.addEventListener("change", renderEntriesByEvent);

// ---- Entries ----

const entryForm = document.getElementById("entry-form");
const entryFormTitle = document.getElementById("entry-form-title");
const entryCancelBtn = document.getElementById("entry-cancel");

const filterNameInput = document.getElementById("filter-name");
const filterClubInput = document.getElementById("filter-club");
const filterPaidSelect = document.getElementById("filter-paid");

function applyFilters(entries) {
  const name = filterNameInput.value.trim().toLowerCase();
  const club = filterClubInput.value.trim().toLowerCase();
  const paid = filterPaidSelect.value;

  return entries.filter((entry) => {
    if (name && !(entry.name || "").toLowerCase().includes(name)) return false;
    if (club && !(entry.club || "").toLowerCase().includes(club)) return false;
    if (paid === "paid" && !entry.paid) return false;
    if (paid === "unpaid" && entry.paid) return false;
    return true;
  });
}

[filterNameInput, filterClubInput].forEach((input) => {
  input.addEventListener("input", () => {
    renderEntriesOverall();
    renderEntriesByEvent();
  });
});

filterPaidSelect.addEventListener("change", () => {
  renderEntriesOverall();
  renderEntriesByEvent();
});

function sortByClubThenName(entries) {
  return [...entries].sort((a, b) => {
    const clubCompare = (a.club || "").localeCompare(b.club || "");
    if (clubCompare !== 0) return clubCompare;
    return (a.name || "").localeCompare(b.name || "");
  });
}

function entryRowHTML(entry) {
  return `
    <tr>
      <td>${entry.name}</td>
      <td>${entry.club || "—"}</td>
      <td>${(entry.events || []).join(", ") || "—"}</td>
      <td><input type="checkbox" data-toggle-paid="${entry.id}" ${entry.paid ? "checked" : ""} /></td>
      <td>
        <button class="link" data-edit-entry="${entry.id}">Edit</button>
        <button class="link danger" data-delete-entry="${entry.id}">Delete</button>
      </td>
    </tr>
  `;
}

function wireRowActions(tbody) {
  tbody.querySelectorAll("[data-edit-entry]").forEach((btn) => {
    btn.addEventListener("click", () => openEntryForEdit(btn.dataset.editEntry));
  });
  tbody.querySelectorAll("[data-delete-entry]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this entry?")) return;
      await api(`/api/entries/${btn.dataset.deleteEntry}`, { method: "DELETE" });
      await loadEntries();
      renderEntriesOverall();
      renderEntriesByEvent();
    });
  });
  tbody.querySelectorAll("[data-toggle-paid]").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      const id = checkbox.dataset.togglePaid;
      const paid = checkbox.checked;
      await api(`/api/entries/${id}`, { method: "PUT", body: JSON.stringify({ paid }) });
      const entry = state.entries.find((e) => e.id === id);
      if (entry) entry.paid = paid;
      renderEntriesOverall();
      renderEntriesByEvent();
    });
  });
}

function formatMoney(amount) {
  return `R${amount.toFixed(2)}`;
}

function renderTotals(entries, countEl, moneyEl) {
  const fee = Number(state.tournament.entryFee) || 0;
  let due = 0;
  let paid = 0;
  entries.forEach((entry) => {
    const owed = (entry.events || []).length * fee;
    due += owed;
    if (entry.paid) paid += owed;
  });
  document.getElementById(countEl).textContent = entries.length;
  document.getElementById(moneyEl).textContent = `${formatMoney(paid)}/${formatMoney(due)}`;
}

function renderEntriesOverall() {
  const tbody = document.querySelector("#entries-table-overall tbody");
  const filtered = sortByClubThenName(applyFilters(state.entries));
  tbody.innerHTML = filtered.map(entryRowHTML).join("");
  wireRowActions(tbody);
  renderTotals(filtered, "entries-overall-count", "entries-overall-money");
}

function renderEntriesByEvent() {
  const selectedEvent = eventFilterSelect.value;
  const tbody = document.querySelector("#entries-table-by-event tbody");
  const filtered = applyFilters(state.entries).filter((e) => (e.events || []).includes(selectedEvent));
  tbody.innerHTML = sortByClubThenName(filtered).map(entryRowHTML).join("");
  wireRowActions(tbody);
  renderTotals(filtered, "entries-by-event-count", "entries-by-event-money");
}

function openEntryForEdit(id) {
  const entry = state.entries.find((e) => e.id === id);
  entryForm.id.value = entry.id;
  entryForm.name.value = entry.name;
  entryForm.club.value = entry.club || "";
  entryForm.paid.checked = Boolean(entry.paid);
  eventCheckboxContainer.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = (entry.events || []).includes(cb.value);
  });
  entryFormTitle.textContent = "Edit Entry";
  entryCancelBtn.hidden = false;
  entryForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetEntryForm() {
  entryForm.reset();
  entryForm.id.value = "";
  eventCheckboxContainer.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = false;
  });
  entryFormTitle.textContent = "Add Entry";
  entryCancelBtn.hidden = true;
}

entryCancelBtn.addEventListener("click", resetEntryForm);

entryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = entryForm.id.value;
  const selectedEvents = Array.from(
    eventCheckboxContainer.querySelectorAll('input[type="checkbox"]:checked')
  ).map((cb) => cb.value);
  const payload = {
    name: entryForm.name.value,
    club: entryForm.club.value,
    events: selectedEvents,
    paid: entryForm.paid.checked,
  };
  if (id) {
    await api(`/api/entries/${id}`, { method: "PUT", body: JSON.stringify(payload) });
  } else {
    await api("/api/entries", { method: "POST", body: JSON.stringify(payload) });
  }
  resetEntryForm();
  await loadEntries();
  renderEntriesOverall();
  renderEntriesByEvent();
});

async function loadEntries() {
  state.entries = await api("/api/entries");
}

// ---- Bulk import ----

const importFileInput = document.getElementById("import-file");
const importBtn = document.getElementById("import-btn");
const importStatus = document.getElementById("import-status");

importBtn.addEventListener("click", async () => {
  const file = importFileInput.files[0];
  if (!file) {
    importStatus.textContent = "Choose a file first.";
    return;
  }
  const formData = new FormData();
  formData.append("file", file);
  importStatus.textContent = "Importing…";
  try {
    const res = await fetch("/api/entries/import", { method: "POST", body: formData });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Import failed");
    let message = `Imported ${body.imported} entr${body.imported === 1 ? "y" : "ies"}.`;
    if (body.warnings && body.warnings.length) {
      message += ` ${body.warnings.length} warning(s) — see console.`;
      console.warn(body.warnings.join("\n"));
    }
    importStatus.textContent = message;
    importFileInput.value = "";
    await loadEntries();
    renderEntriesOverall();
    renderEntriesByEvent();
  } catch (err) {
    importStatus.textContent = `Error: ${err.message}`;
  }
});

// ---- Groups ----

const groupsEventTabsContainer = document.getElementById("groups-event-tabs");
let selectedGroupsEvent = null;

function renderGroupEventTabs() {
  const events = state.tournament.events || [];
  if (!selectedGroupsEvent || !events.includes(selectedGroupsEvent)) {
    selectedGroupsEvent = events[0] || null;
  }
  groupsEventTabsContainer.innerHTML = events
    .map(
      (ev) =>
        `<button class="subtab-btn${ev === selectedGroupsEvent ? " active" : ""}" data-event="${ev}">${ev}</button>`
    )
    .join("");
  groupsEventTabsContainer.querySelectorAll(".subtab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      groupsEventTabsContainer.querySelectorAll(".subtab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedGroupsEvent = btn.dataset.event;
      renderGroups();
      refreshRankings();
    });
  });
}

// A match score is "", a digit 0-3 (games won), or "W" (walkover). Returns null if invalid.
function normalizeScore(value) {
  const v = value.trim().toUpperCase();
  if (v === "") return "";
  if (v === "W") return "W";
  if (/^[0-3]$/.test(v)) return v;
  return null;
}

// Points: win = 3, loss (played) = 1, walkover = 0. Games only count toward Avg if actually played.
function computeMatchOutcome(scoreMine, scoreTheirs) {
  if (scoreMine === "" || scoreMine == null) return null;
  if (scoreMine === "W") return { points: 0, gamesWon: 0, gamesLost: 0, played: false };
  if (scoreTheirs === "W") return { points: 3, gamesWon: 0, gamesLost: 0, played: false };
  const mine = Number(scoreMine);
  const theirs = Number(scoreTheirs);
  if (Number.isNaN(mine) || Number.isNaN(theirs) || mine === theirs) return null;
  return {
    points: mine > theirs ? 3 : 1,
    gamesWon: mine,
    gamesLost: theirs,
    played: true,
  };
}

function groupPlayers(group) {
  const letters = ["A", "B", "C", "D"];
  return letters
    .map((letter, i) => ({
      letter,
      name: i === 0 ? group.seed : group[`name${i + 1}`],
      club: i === 0 ? group.seedClub : group[`club${i + 1}`],
    }))
    .filter((p) => p.name && p.name.trim() !== "");
}

function computeStandings(group) {
  const players = groupPlayers(group);
  const matches = group.matches || {};

  const stats = {};
  players.forEach((p) => {
    stats[p.letter] = { points: 0, gamesWon: 0, gamesLost: 0, matchesPlayed: 0 };
  });

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i].letter;
      const b = players[j].letter;
      const pair = matches[`${a}-${b}`] || {};

      const outcomeA = computeMatchOutcome(pair.a, pair.b);
      if (outcomeA) {
        stats[a].points += outcomeA.points;
        if (outcomeA.played) {
          stats[a].gamesWon += outcomeA.gamesWon;
          stats[a].gamesLost += outcomeA.gamesLost;
          stats[a].matchesPlayed += 1;
        }
      }

      const outcomeB = computeMatchOutcome(pair.b, pair.a);
      if (outcomeB) {
        stats[b].points += outcomeB.points;
        if (outcomeB.played) {
          stats[b].gamesWon += outcomeB.gamesWon;
          stats[b].gamesLost += outcomeB.gamesLost;
          stats[b].matchesPlayed += 1;
        }
      }
    }
  }

  const ranked = players
    .map((p) => {
      const s = stats[p.letter];
      const avg = s.matchesPlayed > 0 ? (s.gamesWon - s.gamesLost) / s.matchesPlayed : null;
      return { ...p, points: s.points, avg };
    })
    .sort((x, y) => y.points - x.points || (y.avg ?? -Infinity) - (x.avg ?? -Infinity));

  ranked.forEach((p, i) => {
    p.rank = i + 1;
  });

  return ranked;
}

function formatAvg(avg) {
  return avg === null ? "—" : avg.toFixed(2);
}

const GROUP_MATCH_ORDER = {
  2: [["A", "B"]],
  3: [
    ["B", "C"],
    ["A", "C"],
    ["A", "B"],
  ],
  4: [
    ["A", "D"],
    ["B", "C"],
    ["A", "C"],
    ["B", "D"],
    ["C", "D"],
    ["A", "B"],
  ],
};

function orderedMatchPairs(players) {
  const order = GROUP_MATCH_ORDER[players.length];
  const pairLetters = [];
  if (order) {
    order.forEach(([a, b]) => pairLetters.push([a, b]));
  } else {
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        pairLetters.push([players[i].letter, players[j].letter]);
      }
    }
  }
  return pairLetters
    .map(([a, b]) => [players.find((p) => p.letter === a), players.find((p) => p.letter === b)])
    .filter(([pa, pb]) => pa && pb);
}

function matchRowHTML(group, playerA, playerB) {
  const key = `${playerA.letter}-${playerB.letter}`;
  const pair = (group.matches || {})[key] || {};
  return `
    <div class="match-row" data-group="${group.id}" data-pair="${key}">
      <span class="match-players">${playerA.name} vs ${playerB.name}</span>
      <input class="score-input" data-side="a" maxlength="1" value="${pair.a || ""}" />
      <span>–</span>
      <input class="score-input" data-side="b" maxlength="1" value="${pair.b || ""}" />
    </div>
  `;
}

function groupCardHTML(group) {
  const players = groupPlayers(group);
  const standings = computeStandings(group);

  const standingsRows = standings
    .map(
      (p) => `
        <tr>
          <td class="seed">${p.letter}</td>
          <td>${p.name}</td>
          <td>${p.club || "—"}</td>
          <td>${p.points}</td>
          <td>${formatAvg(p.avg)}</td>
          <td>${p.rank}</td>
        </tr>
      `
    )
    .join("");

  const matchRows = orderedMatchPairs(players).map(([pa, pb]) => matchRowHTML(group, pa, pb));

  const sched = formatScheduleHits(scheduleHitsForGroup(state.schedule, group.event, group.group));

  return `
    <div class="group-card">
      <div class="group-card-meta">
        <span>${sched ? sched.timeLabel : "—"}</span>
        <span>${sched ? sched.tableLabel : "—"}</span>
      </div>
      <div class="group-card-header">Group ${group.group}</div>
      <table class="standings-table">
        <thead><tr><th></th><th>Player</th><th>Club</th><th>Pts</th><th>Avg</th><th>Rank</th></tr></thead>
        <tbody>${standingsRows}</tbody>
      </table>
      <div class="matches-section">
        <h4>Matches</h4>
        ${matchRows.join("")}
      </div>
    </div>
  `;
}

async function saveMatchScore(groupId, pairKey, row) {
  const aInput = row.querySelector('.score-input[data-side="a"]');
  const bInput = row.querySelector('.score-input[data-side="b"]');
  const a = normalizeScore(aInput.value);
  const b = normalizeScore(bInput.value);
  if (a === null || b === null) {
    if (a === null) aInput.value = "";
    if (b === null) bInput.value = "";
    return;
  }

  const group = state.groups.find((g) => g.id === groupId);
  const matches = { ...(group.matches || {}) };
  if (a === "" && b === "") {
    delete matches[pairKey];
  } else {
    matches[pairKey] = { a, b };
  }
  group.matches = matches;

  await api(`/api/groups/${groupId}`, { method: "PUT", body: JSON.stringify({ matches }) });
  renderGroups();
}

function renderGroups() {
  const filtered = state.groups
    .filter((g) => g.event === selectedGroupsEvent)
    .sort((a, b) => Number(a.group) - Number(b.group) || String(a.group).localeCompare(String(b.group)));

  const grid = document.getElementById("groups-grid");
  grid.innerHTML = filtered.map(groupCardHTML).join("");
  grid.hidden = filtered.length === 0;
  document.getElementById("groups-empty").hidden = filtered.length > 0;

  grid.querySelectorAll(".match-row").forEach((row) => {
    row.querySelectorAll(".score-input").forEach((input) => {
      input.addEventListener("change", () => saveMatchScore(row.dataset.group, row.dataset.pair, row));
    });
  });
}

async function loadGroups() {
  state.groups = await api("/api/groups");
}

const groupsImportBtn = document.getElementById("groups-import-btn");
const groupsImportStatus = document.getElementById("groups-import-status");

groupsImportBtn.addEventListener("click", async () => {
  if (!selectedGroupsEvent) {
    groupsImportStatus.textContent = "No event selected.";
    return;
  }
  const existingCount = state.groups.filter((g) => g.event === selectedGroupsEvent).length;
  if (existingCount > 0) {
    const proceed = confirm(
      `This will replace the ${existingCount} existing group(s) — and any scores entered — for "${selectedGroupsEvent}". Continue?`
    );
    if (!proceed) return;
  }
  groupsImportStatus.textContent = "Importing…";
  try {
    const res = await fetch("/api/groups/import-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: selectedGroupsEvent }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Import failed");
    let message = `Imported ${body.imported} group${body.imported === 1 ? "" : "s"} for ${selectedGroupsEvent}.`;
    if (body.warnings && body.warnings.length) {
      message += ` ${body.warnings.length} warning(s) — see console.`;
      console.warn(body.warnings.join("\n"));
    }
    groupsImportStatus.textContent = message;
    await loadGroups();
    renderGroups();
  } catch (err) {
    groupsImportStatus.textContent = `Error: ${err.message}`;
  }
});

// ---- National rankings ----

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function wordSimilarity(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// Tolerant of misspellings: scores how well an entry's name words match a ranking
// list entry's words (format "SURNAME Given Association"), regardless of order.
function nameMatchScore(entryName, rankingName) {
  const entryWords = entryName.trim().split(/\s+/).filter(Boolean);
  const rankingWords = rankingName.trim().split(/\s+/).filter(Boolean);
  if (entryWords.length === 0 || rankingWords.length === 0) return 0;

  let total = 0;
  entryWords.forEach((ew) => {
    let best = 0;
    rankingWords.forEach((rw) => {
      const sim = wordSimilarity(ew, rw);
      if (sim > best) best = sim;
    });
    total += best;
  });
  return total / entryWords.length;
}

const RANKING_MATCH_THRESHOLD = 0.75;

function findNationalRank(entryName, rankingsForEvent) {
  if (!rankingsForEvent || rankingsForEvent.length === 0) return null;
  let bestRank = null;
  let bestScore = 0;
  rankingsForEvent.forEach((r) => {
    const score = nameMatchScore(entryName, r.name);
    if (score > bestScore) {
      bestScore = score;
      bestRank = r.rank;
    }
  });
  return bestScore >= RANKING_MATCH_THRESHOLD ? bestRank : null;
}

async function refreshRankings() {
  const statusEl = document.getElementById("rankings-status");
  if (!selectedGroupsEvent) {
    state.rankings = [];
    renderEventRankings();
    return;
  }
  try {
    const res = await fetch(`/api/rankings?event=${encodeURIComponent(selectedGroupsEvent)}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Failed to load rankings");
    state.rankings = body;
    statusEl.textContent = "";
  } catch (err) {
    state.rankings = [];
    statusEl.textContent = err.message;
  }
  renderEventRankings();
}

function renderEventRankings() {
  const entriesForEvent = state.entries.filter((e) => (e.events || []).includes(selectedGroupsEvent));

  const withRanks = entriesForEvent
    .map((e) => ({ ...e, nationalRank: findNationalRank(e.name, state.rankings) }))
    .sort((a, b) => {
      if (a.nationalRank === null && b.nationalRank === null) return a.name.localeCompare(b.name);
      if (a.nationalRank === null) return 1;
      if (b.nationalRank === null) return -1;
      return a.nationalRank - b.nationalRank;
    });

  const tbody = document.getElementById("rankings-tbody");
  tbody.innerHTML = withRanks
    .map(
      (e) => `
        <tr>
          <td>${e.name}</td>
          <td>${e.club || "—"}</td>
          <td>${e.nationalRank ?? "Unranked"}</td>
        </tr>
      `
    )
    .join("");

  document.getElementById("rankings-table").hidden = withRanks.length === 0;
  document.getElementById("rankings-empty").hidden = withRanks.length > 0;
}

// ---- Knockouts ----

const knockoutsEventTabsContainer = document.getElementById("knockouts-event-tabs");
const knockoutsVisibleToggle = document.getElementById("knockouts-visible-toggle");
const knockoutsSizeSelect = document.getElementById("knockouts-size-select");
let selectedKnockoutsEvent = null;

function renderKnockoutsEventTabs() {
  const events = state.tournament.events || [];
  if (!selectedKnockoutsEvent || !events.includes(selectedKnockoutsEvent)) {
    selectedKnockoutsEvent = events[0] || null;
  }
  knockoutsEventTabsContainer.innerHTML = events
    .map(
      (ev) =>
        `<button class="subtab-btn${ev === selectedKnockoutsEvent ? " active" : ""}" data-event="${ev}">${ev}</button>`
    )
    .join("");
  knockoutsEventTabsContainer.querySelectorAll(".subtab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      knockoutsEventTabsContainer.querySelectorAll(".subtab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedKnockoutsEvent = btn.dataset.event;
      renderKnockoutsTab();
    });
  });
}

knockoutsVisibleToggle.addEventListener("change", async () => {
  const map = { ...(state.tournament.knockoutsVisible || {}) };
  map[selectedKnockoutsEvent] = knockoutsVisibleToggle.checked;
  const updated = await api("/api/tournament", { method: "PUT", body: JSON.stringify({ knockoutsVisible: map }) });
  state.tournament = updated;
});

function isGroupComplete(group) {
  const players = groupPlayers(group);
  if (players.length === 0) return false;
  const matches = group.matches || {};
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const pair = matches[`${players[i].letter}-${players[j].letter}`];
      if (!pair || pair.a === "" || pair.a == null || pair.b === "" || pair.b == null) return false;
    }
  }
  return true;
}

// A round-1 slot is stored as "", "bye", or "<groupNumber><W|R>" e.g. "3W".
function resolveSlot(rawValue, groupsForEvent) {
  if (!rawValue) return { label: "—", resolved: false, name: "", club: "", isBye: false };
  if (rawValue === "bye") return { label: "BYE", resolved: true, name: "BYE", club: "", isBye: true };
  const m = rawValue.match(/^(\d+)(W|R)$/);
  if (!m) return { label: rawValue, resolved: false, name: "", club: "", isBye: false };
  const [, groupNum, pos] = m;
  const placeholder = `${groupNum}${pos}`;
  const group = groupsForEvent.find((g) => String(g.group) === groupNum);
  if (!group || !isGroupComplete(group)) {
    return { label: placeholder, resolved: false, name: "", club: "", isBye: false };
  }
  const standings = computeStandings(group);
  const player = standings[pos === "W" ? 0 : 1];
  if (!player) return { label: placeholder, resolved: false, name: "", club: "", isBye: false };
  return { label: player.name, resolved: true, name: player.name, club: player.club, isBye: false };
}

function matchWinnerSide(score) {
  if (!score) return null;
  const { a, b } = score;
  if (a === "" || a == null || b === "" || b == null) return null;
  if (a === "W" && b === "W") return null;
  if (a === "W") return "b";
  if (b === "W") return "a";
  const na = Number(a);
  const nb = Number(b);
  if (Number.isNaN(na) || Number.isNaN(nb) || na === nb) return null;
  return na > nb ? "a" : "b";
}

function totalKnockoutRounds(size) {
  return Math.round(Math.log2(size));
}

function knockoutRoundLabel(roundNumber, totalRoundsCount) {
  const fromEnd = totalRoundsCount - roundNumber;
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinal";
  if (fromEnd === 2) return "Quarterfinal";
  return `Round of ${Math.pow(2, fromEnd + 1)}`;
}

function resolveBracket(bracket, groupsForEvent) {
  const rounds = totalKnockoutRounds(bracket.size);
  const roundsData = [];

  const round1 = (bracket.round1Slots || []).map((slot) => {
    const p1 = resolveSlot(slot.p1, groupsForEvent);
    const p2 = resolveSlot(slot.p2, groupsForEvent);
    const key = `R1M${slot.match}`;
    const score = (bracket.scores || {})[key] || { a: "", b: "" };
    let winnerSide = null;
    if (p1.isBye && p2.resolved && !p2.isBye) winnerSide = "b";
    else if (p2.isBye && p1.resolved && !p1.isBye) winnerSide = "a";
    else if (p1.resolved && p2.resolved && !p1.isBye && !p2.isBye) winnerSide = matchWinnerSide(score);
    const isByeMatch = p1.isBye || p2.isBye;
    return { match: slot.match, p1, p2, score, winnerSide, key, round1: true, isByeMatch };
  });

  // Bye matches never get played, so schedules number only the real matches — a round-1
  // match's schedule "Match N" skips over any earlier byes in the round.
  let scheduleMatchCounter = 0;
  round1.forEach((m) => {
    m.scheduleMatchNumber = m.isByeMatch ? null : ++scheduleMatchCounter;
  });

  roundsData.push(round1);

  for (let r = 2; r <= rounds; r++) {
    const prevRound = roundsData[r - 2];
    const matchesInRound = bracket.size / Math.pow(2, r);
    const roundMatches = [];
    for (let m = 1; m <= matchesInRound; m++) {
      const feedA = prevRound[(m - 1) * 2];
      const feedB = prevRound[(m - 1) * 2 + 1];
      const p1 =
        feedA && feedA.winnerSide
          ? feedA.winnerSide === "a"
            ? feedA.p1
            : feedA.p2
          : { label: feedA ? `Winner M${feedA.match}` : "—", resolved: false, name: "", club: "", isBye: false };
      const p2 =
        feedB && feedB.winnerSide
          ? feedB.winnerSide === "a"
            ? feedB.p1
            : feedB.p2
          : { label: feedB ? `Winner M${feedB.match}` : "—", resolved: false, name: "", club: "", isBye: false };
      const key = `R${r}M${m}`;
      const score = (bracket.scores || {})[key] || { a: "", b: "" };
      const winnerSide = p1.resolved && p2.resolved ? matchWinnerSide(score) : null;
      roundMatches.push({ match: m, p1, p2, score, winnerSide, key, round1: false });
    }
    roundsData.push(roundMatches);
  }

  const totalRoundsCount = roundsData.length;
  roundsData.forEach((roundMatches, idx) => {
    roundMatches.forEach((m) => {
      m.roundNumber = idx + 1;
      m.totalRounds = totalRoundsCount;
    });
  });

  return roundsData;
}

function slotOptionsHTML(selectedValue) {
  const groupNums = Array.from(
    new Set(state.groups.filter((g) => g.event === selectedKnockoutsEvent).map((g) => String(g.group)))
  ).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));

  let html = `<option value="">— empty —</option>`;
  html += `<option value="bye"${selectedValue === "bye" ? " selected" : ""}>BYE</option>`;
  groupNums.forEach((n) => {
    html += `<option value="${n}W"${selectedValue === `${n}W` ? " selected" : ""}>${n}W</option>`;
    html += `<option value="${n}R"${selectedValue === `${n}R` ? " selected" : ""}>${n}R</option>`;
  });
  return html;
}

function koPlayerCellHTML(m, sideKey) {
  const player = sideKey === "a" ? m.p1 : m.p2;
  const isWinner = m.winnerSide === sideKey;
  const scoreEditable = m.p1.resolved && m.p2.resolved && !m.p1.isBye && !m.p2.isBye;
  const scoreValue = sideKey === "a" ? m.score.a : m.score.b;

  const nameHTML = `<span class="ko-player-name${player.resolved ? "" : " placeholder"}">${player.label}</span>`;

  const scoreHTML = scoreEditable
    ? `<input class="score-input" data-key="${m.key}" data-side="${sideKey}" maxlength="1" value="${scoreValue || ""}" />`
    : `<span class="ko-player-name" style="flex:0 0 30px;text-align:center;">${player.isBye ? "" : scoreValue || ""}</span>`;

  return `<div class="ko-match-player${isWinner ? " winner" : ""}">${nameHTML}${scoreHTML}</div>`;
}

function koMatchMetaHTML(m) {
  if (m.round1 && m.isByeMatch) return "";
  const matchNumber = m.round1 ? m.scheduleMatchNumber : m.match;
  if (matchNumber == null) return "";
  const hits = scheduleHitsForMatch(state.schedule, selectedKnockoutsEvent, m.roundNumber, m.totalRounds, matchNumber);
  const sched = formatScheduleHits(hits);
  if (!sched) return "";
  return `<div class="ko-match-meta"><span>${sched.timeLabel}</span><span>${sched.tableLabel}</span></div>`;
}

function koMatchCardHTML(m) {
  return `<div class="ko-match-card">${koMatchMetaHTML(m)}${koPlayerCellHTML(m, "a")}${koPlayerCellHTML(m, "b")}</div>`;
}

function koSlotPickerHTML(bracket, m) {
  const slotEntry = bracket.round1Slots.find((s) => s.match === m.match) || {};
  return `
    <div class="ko-slot-picker">
      <select class="ko-select" data-bracket-id="${bracket.id}" data-match="${m.match}" data-side="a">${slotOptionsHTML(slotEntry.p1 || "")}</select>
      <select class="ko-select" data-bracket-id="${bracket.id}" data-match="${m.match}" data-side="b">${slotOptionsHTML(slotEntry.p2 || "")}</select>
    </div>
  `;
}

function koMatchRowHTML(bracket, m) {
  const picker = m.round1 ? koSlotPickerHTML(bracket, m) : "";
  return `<div class="ko-match-row">${picker}${koMatchCardHTML(m)}</div>`;
}

async function saveRound1Slot(select) {
  const bracket = state.knockouts.find((b) => b.id === select.dataset.bracketId);
  const matchNum = Number(select.dataset.match);
  const slotEntry = bracket.round1Slots.find((s) => s.match === matchNum);
  if (select.dataset.side === "a") slotEntry.p1 = select.value;
  else slotEntry.p2 = select.value;
  await api(`/api/knockouts/${bracket.id}`, {
    method: "PUT",
    body: JSON.stringify({ round1Slots: bracket.round1Slots }),
  });
  renderKnockoutsBracket();
}

async function saveKnockoutScore(input) {
  // Only one bracket is shown per event at a time, so the active bracket is unambiguous.
  const activeBracket = state.knockouts.find((b) => b.event === selectedKnockoutsEvent);
  const key = input.dataset.key;
  const card = input.closest(".ko-match-card");
  const aInput = card.querySelector('.score-input[data-side="a"]');
  const bInput = card.querySelector('.score-input[data-side="b"]');
  const a = normalizeScore(aInput.value);
  const b = normalizeScore(bInput.value);
  if (a === null || b === null) {
    if (a === null) aInput.value = "";
    if (b === null) bInput.value = "";
    return;
  }
  const scores = { ...(activeBracket.scores || {}) };
  if (a === "" && b === "") delete scores[key];
  else scores[key] = { a, b };
  activeBracket.scores = scores;
  await api(`/api/knockouts/${activeBracket.id}`, { method: "PUT", body: JSON.stringify({ scores }) });
  renderKnockoutsBracket();
}

function renderKnockoutsBracket() {
  const bracket = state.knockouts.find((b) => b.event === selectedKnockoutsEvent);
  const container = document.getElementById("knockouts-bracket");
  const emptyMsg = document.getElementById("knockouts-empty");

  if (!bracket) {
    container.innerHTML = "";
    emptyMsg.hidden = false;
    knockoutsSizeSelect.value = "";
    return;
  }

  emptyMsg.hidden = true;
  knockoutsSizeSelect.value = String(bracket.size);

  const groupsForEvent = state.groups.filter((g) => g.event === selectedKnockoutsEvent);
  const roundsData = resolveBracket(bracket, groupsForEvent);
  const totalRoundsCount = roundsData.length;

  const html = roundsData
    .map(
      (roundMatches, idx) => `
        <div class="round-col${idx === 0 ? " round-col-wide" : ""}">
          <div class="round-header">${knockoutRoundLabel(idx + 1, totalRoundsCount)}</div>
          <div class="round-matches">
            ${roundMatches.map((m) => koMatchRowHTML(bracket, m)).join("")}
          </div>
        </div>
      `
    )
    .join("");

  container.innerHTML = `<div class="bracket">${html}</div>`;

  container.querySelectorAll(".ko-select").forEach((sel) => {
    sel.addEventListener("change", () => saveRound1Slot(sel));
  });
  container.querySelectorAll(".score-input").forEach((input) => {
    input.addEventListener("change", () => saveKnockoutScore(input));
  });
}

knockoutsSizeSelect.addEventListener("change", async () => {
  const size = Number(knockoutsSizeSelect.value);
  const existing = state.knockouts.find((b) => b.event === selectedKnockoutsEvent);

  if (!size) {
    if (existing) knockoutsSizeSelect.value = String(existing.size);
    return;
  }

  if (existing && existing.size === size) return;

  if (existing) {
    const proceed = confirm(
      `Changing bracket size will reset all round 1 pairings and scores for "${selectedKnockoutsEvent}". Continue?`
    );
    if (!proceed) {
      knockoutsSizeSelect.value = String(existing.size);
      return;
    }
    const round1Slots = Array.from({ length: size / 2 }, (_, i) => ({ match: i + 1, p1: "", p2: "" }));
    const updated = await api(`/api/knockouts/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify({ size, round1Slots, scores: {} }),
    });
    const idx = state.knockouts.findIndex((b) => b.id === existing.id);
    state.knockouts[idx] = updated;
  } else {
    const round1Slots = Array.from({ length: size / 2 }, (_, i) => ({ match: i + 1, p1: "", p2: "" }));
    const created = await api("/api/knockouts", {
      method: "POST",
      body: JSON.stringify({ event: selectedKnockoutsEvent, size, round1Slots, scores: {} }),
    });
    state.knockouts.push(created);
  }
  renderKnockoutsBracket();
});

function renderKnockoutsTab() {
  const map = state.tournament.knockoutsVisible || {};
  knockoutsVisibleToggle.checked = map[selectedKnockoutsEvent] !== false;
  renderKnockoutsBracket();
}

// ---- Schedule ----

const scheduleVisibleToggle = document.getElementById("schedule-visible-toggle");

scheduleVisibleToggle.addEventListener("change", async () => {
  const updated = await api("/api/tournament", {
    method: "PUT",
    body: JSON.stringify({ scheduleVisible: scheduleVisibleToggle.checked }),
  });
  state.tournament = updated;
});

function renderScheduleLegend() {
  const events = state.tournament.events || [];
  const legend = document.getElementById("schedule-legend");
  legend.innerHTML = events
    .map((ev) => {
      const color = eventColor(ev);
      return `<span class="legend-item" style="--swatch-color:${color}; background:${color}55;">${ev}</span>`;
    })
    .join("");
}

function renderScheduleTable() {
  const schedule = state.schedule || { tables: [], rows: [] };
  const table = document.getElementById("schedule-table");
  const emptyMsg = document.getElementById("schedule-empty");

  if (!schedule.rows || schedule.rows.length === 0) {
    table.innerHTML = "";
    table.hidden = true;
    emptyMsg.hidden = false;
    return;
  }

  table.hidden = false;
  emptyMsg.hidden = true;

  const thead = `
    <thead>
      <tr>
        <th>Time</th>
        ${schedule.tables.map((t) => `<th>${t}</th>`).join("")}
      </tr>
    </thead>
  `;

  const tbody = `
    <tbody>
      ${schedule.rows
        .map(
          (row) => `
            <tr>
              <td class="time-col">${row.time}</td>
              ${schedule.tables
                .map((t) => {
                  const text = row.cells[t];
                  if (!text) return `<td class="sched-empty"></td>`;
                  const ev = matchEventForText(text);
                  const color = ev ? eventColor(ev) : "#eee";
                  return `<td style="background:${color};">${formatScheduleCell(text, ev)}</td>`;
                })
                .join("")}
            </tr>
          `
        )
        .join("")}
    </tbody>
  `;

  table.innerHTML = thead + tbody;
}

function renderScheduleTab() {
  scheduleVisibleToggle.checked = state.tournament.scheduleVisible !== false;
  renderScheduleLegend();
  renderScheduleTable();
}

const scheduleImportBtn = document.getElementById("schedule-import-btn");
const scheduleImportStatus = document.getElementById("schedule-import-status");

scheduleImportBtn.addEventListener("click", async () => {
  scheduleImportStatus.textContent = "Importing…";
  try {
    const res = await fetch("/api/schedule/import", { method: "POST" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "Import failed");
    scheduleImportStatus.textContent = `Imported ${body.imported} time slot${body.imported === 1 ? "" : "s"}.`;
    state.schedule = await api("/api/schedule");
    renderScheduleTable();
  } catch (err) {
    scheduleImportStatus.textContent = `Error: ${err.message}`;
  }
});

// ---- Load everything ----

async function loadAll() {
  const [tournament, entries, groups, knockouts, schedule] = await Promise.all([
    api("/api/tournament"),
    api("/api/entries"),
    api("/api/groups"),
    api("/api/knockouts"),
    api("/api/schedule"),
  ]);
  state.tournament = tournament;
  state.entries = entries;
  state.groups = groups;
  state.knockouts = knockouts;
  state.schedule = schedule;
  renderTournamentForm();
  entriesVisibleToggle.checked = state.tournament.entriesVisible !== false;
  groupsVisibleToggle.checked = state.tournament.groupsVisible !== false;
  populateEventControls();
  renderEntriesOverall();
  renderEntriesByEvent();
  renderGroups();
  refreshRankings();
  renderScheduleTab();
  renderKnockoutsTab();
}

loadAll().catch((err) => {
  console.error(err);
  alert(`Failed to load data: ${err.message}`);
});
