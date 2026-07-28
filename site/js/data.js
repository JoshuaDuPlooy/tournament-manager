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

async function loadGroupsData() {
  const [tournament, groups, schedule] = await Promise.all([
    loadJSON("data/tournament.json"),
    loadJSON("data/groups.json"),
    loadJSON("data/schedule.json"),
  ]);
  return { tournament, groups, schedule };
}

async function loadKnockoutsData() {
  const [tournament, knockouts, groups, schedule] = await Promise.all([
    loadJSON("data/tournament.json"),
    loadJSON("data/knockouts.json"),
    loadJSON("data/groups.json"),
    loadJSON("data/schedule.json"),
  ]);
  return { tournament, knockouts, groups, schedule };
}

async function loadScheduleData() {
  const [tournament, schedule] = await Promise.all([
    loadJSON("data/tournament.json"),
    loadJSON("data/schedule.json"),
  ]);
  return { tournament, schedule };
}
