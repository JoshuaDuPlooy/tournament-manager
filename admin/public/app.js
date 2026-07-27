const state = {
  tournament: null,
  entries: [],
};

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

// ---- Load everything ----

async function loadAll() {
  const [tournament, entries] = await Promise.all([api("/api/tournament"), api("/api/entries")]);
  state.tournament = tournament;
  state.entries = entries;
  renderTournamentForm();
  entriesVisibleToggle.checked = state.tournament.entriesVisible !== false;
  populateEventControls();
  renderEntriesOverall();
  renderEntriesByEvent();
}

loadAll().catch((err) => {
  console.error(err);
  alert(`Failed to load data: ${err.message}`);
});
