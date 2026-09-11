// Group standings and knockout bracket resolution, shared by the pages that need it.
//
// NOTE: knockouts.html and groups.html still carry their own inline copies of these
// functions. They were left alone deliberately -- this was added mid-tournament and
// those pages were live -- so the copies should be folded into this file once the
// event is over.

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

function computeMatchOutcome(scoreMine, scoreTheirs) {
  if (scoreMine === "" || scoreMine == null) return null;
  if (scoreMine === "W") return { points: 0, gamesWon: 0, gamesLost: 0, played: false };
  if (scoreTheirs === "W") return { points: 3, gamesWon: 0, gamesLost: 0, played: false };
  const mine = Number(scoreMine);
  const theirs = Number(scoreTheirs);
  if (Number.isNaN(mine) || Number.isNaN(theirs) || mine === theirs) return null;
  return { points: mine > theirs ? 3 : 1, gamesWon: mine, gamesLost: theirs, played: true };
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

  ranked.forEach((p, i) => (p.rank = i + 1));
  return ranked;
}

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

// A slot is "", "bye", "entry:<id>" (a competitor named directly, for events drawn
// straight into a knockout with no group stage), or "<groupNumber><W|R>".
function resolveSlot(rawValue, groupsForEvent, entriesForEvent) {
  if (!rawValue) return { label: "—", resolved: false, name: "", club: "", isBye: false };
  if (rawValue === "bye") return { label: "BYE", resolved: true, name: "BYE", club: "", isBye: true };
  if (rawValue.startsWith("entry:")) {
    const id = rawValue.slice("entry:".length);
    const entry = (entriesForEvent || []).find((e) => e.id === id);
    if (!entry) return { label: "—", resolved: false, name: "", club: "", isBye: false };
    return { label: entry.name, resolved: true, name: entry.name, club: entry.club || "", isBye: false };
  }
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

function resolveBracket(bracket, groupsForEvent, entriesForEvent) {
  const rounds = totalKnockoutRounds(bracket.size);
  const roundsData = [];

  const round1 = (bracket.round1Slots || []).map((slot) => {
    const p1 = resolveSlot(slot.p1, groupsForEvent, entriesForEvent);
    const p2 = resolveSlot(slot.p2, groupsForEvent, entriesForEvent);
    const key = `R1M${slot.match}`;
    const score = (bracket.scores || {})[key] || { a: "", b: "" };
    let winnerSide = null;
    if (p1.isBye && p2.resolved && !p2.isBye) winnerSide = "b";
    else if (p2.isBye && p1.resolved && !p1.isBye) winnerSide = "a";
    else if (p1.resolved && p2.resolved && !p1.isBye && !p2.isBye) winnerSide = matchWinnerSide(score);
    const isByeMatch = p1.isBye || p2.isBye;
    return { match: slot.match, p1, p2, score, winnerSide, key, isByeMatch };
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
      roundMatches.push({ match: m, p1, p2, score, winnerSide, key });
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
