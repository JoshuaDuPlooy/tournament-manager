async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

async function loadTournamentData() {
  const [tournament, teams] = await Promise.all([
    loadJSON("data/tournament.json"),
    loadJSON("data/teams.json"),
  ]);
  return { tournament, teams };
}

async function loadEntriesData() {
  const [tournament, entries] = await Promise.all([
    loadJSON("data/tournament.json"),
    loadJSON("data/entries.json"),
  ]);
  return { tournament, entries };
}
