const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const ExcelJS = require("exceljs");

const DATA_DIR = path.join(__dirname, "..", "site", "data");
const TOURNAMENT_FILE = path.join(DATA_DIR, "tournament.json");
const ENTRIES_FILE = path.join(DATA_DIR, "entries.json");
const GROUPS_FILE = path.join(DATA_DIR, "groups.json");
const KNOCKOUTS_FILE = path.join(DATA_DIR, "knockouts.json");
const SCHEDULE_FILE = path.join(DATA_DIR, "schedule.json");
const GROUPS_IMPORT_FILE = path.join(__dirname, "Groups.xlsx");
const RANKINGS_FILE = path.join(__dirname, "Rankings.xlsx");
const SCHEDULE_IMPORT_FILE = path.join(__dirname, "Schedule.xlsx");

const PORT = process.env.PORT || 4000;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

async function readJSON(file) {
  const raw = await fs.readFile(file, "utf-8");
  return JSON.parse(raw);
}

async function writeJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// Extracts display text from an ExcelJS cell, including formula cells (e.g. CONCATENATE),
// which come back as { formula, result } objects rather than plain strings.
function cellText(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("result" in v) return String(v.result ?? "").trim();
    if ("richText" in v) return v.richText.map((t) => t.text).join("").trim();
    if (v instanceof Date) return v.toISOString();
    return "";
  }
  return String(v).trim();
}

// ---- Tournament info ----

app.get("/api/tournament", async (req, res, next) => {
  try {
    res.json(await readJSON(TOURNAMENT_FILE));
  } catch (err) {
    next(err);
  }
});

app.put("/api/tournament", async (req, res, next) => {
  try {
    const existing = await readJSON(TOURNAMENT_FILE);
    const updated = { ...existing, ...req.body };
    await writeJSON(TOURNAMENT_FILE, updated);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ---- Entries ----

app.get("/api/entries", async (req, res, next) => {
  try {
    res.json(await readJSON(ENTRIES_FILE));
  } catch (err) {
    next(err);
  }
});

app.post("/api/entries", async (req, res, next) => {
  try {
    const entries = await readJSON(ENTRIES_FILE);
    const entry = { id: crypto.randomUUID(), ...req.body };
    entries.push(entry);
    await writeJSON(ENTRIES_FILE, entries);
    res.status(201).json(entry);
  } catch (err) {
    next(err);
  }
});

app.put("/api/entries/:id", async (req, res, next) => {
  try {
    const entries = await readJSON(ENTRIES_FILE);
    const index = entries.findIndex((e) => e.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: "Entry not found" });
    entries[index] = { ...entries[index], ...req.body, id: entries[index].id };
    await writeJSON(ENTRIES_FILE, entries);
    res.json(entries[index]);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/entries/:id", async (req, res, next) => {
  try {
    const entries = await readJSON(ENTRIES_FILE);
    const next_ = entries.filter((e) => e.id !== req.params.id);
    await writeJSON(ENTRIES_FILE, next_);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Schedule ----
// Reads a fixed local workbook (admin/Schedule.xlsx): row 1 (from column B onward) has table
// numbers, column A (from row 2) has the time for that row, and each cell is what's playing
// at that time on that table. Column A's Excel time-only values come back as a 1899-12-30
// placeholder date, so only the UTC hour/minute are used.

function formatExcelTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

app.get("/api/schedule", async (req, res, next) => {
  try {
    res.json(await readJSON(SCHEDULE_FILE));
  } catch (err) {
    next(err);
  }
});

app.post("/api/schedule/import", async (req, res, next) => {
  try {
    try {
      await fs.access(SCHEDULE_IMPORT_FILE);
    } catch {
      return res.status(400).json({
        error: `Schedule.xlsx not found in the admin folder (expected at ${SCHEDULE_IMPORT_FILE})`,
      });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(SCHEDULE_IMPORT_FILE);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return res.status(400).json({ error: "No worksheet found in Schedule.xlsx" });

    const tableColumns = [];
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      if (colNumber === 1) return;
      const val = cellText(cell);
      if (val) tableColumns.push({ col: colNumber, table: val });
    });

    if (tableColumns.length === 0) {
      return res.status(400).json({ error: "No table columns found in the header row (row 1, from column B)" });
    }

    const rows = [];
    for (let r = 2; r <= worksheet.rowCount; r++) {
      const row = worksheet.getRow(r);
      const timeCellValue = row.getCell(1).value;
      if (timeCellValue === null || timeCellValue === undefined || timeCellValue === "") continue;
      const time = formatExcelTime(timeCellValue);

      const cells = {};
      tableColumns.forEach(({ col, table }) => {
        const text = cellText(row.getCell(col));
        if (text) cells[table] = text;
      });

      if (Object.keys(cells).length === 0) continue;
      rows.push({ time, cells });
    }

    const schedule = { tables: tableColumns.map((t) => t.table), rows };
    await writeJSON(SCHEDULE_FILE, schedule);
    res.status(201).json({ imported: rows.length });
  } catch (err) {
    next(err);
  }
});

// ---- Knockouts ----
// One entry per event: { id, event, size, round1Slots, scores }. Round 1 slots reference a
// group + position ("W"/"R"); later rounds auto-advance from previous-round winners, computed
// client-side. Scores use the same convention as Groups (digit 0-3 games won, or "W" walkover).

app.get("/api/knockouts", async (req, res, next) => {
  try {
    res.json(await readJSON(KNOCKOUTS_FILE));
  } catch (err) {
    next(err);
  }
});

app.post("/api/knockouts", async (req, res, next) => {
  try {
    const brackets = await readJSON(KNOCKOUTS_FILE);
    const bracket = { id: crypto.randomUUID(), ...req.body };
    brackets.push(bracket);
    await writeJSON(KNOCKOUTS_FILE, brackets);
    res.status(201).json(bracket);
  } catch (err) {
    next(err);
  }
});

app.put("/api/knockouts/:id", async (req, res, next) => {
  try {
    const brackets = await readJSON(KNOCKOUTS_FILE);
    const index = brackets.findIndex((b) => b.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: "Bracket not found" });
    brackets[index] = { ...brackets[index], ...req.body, id: brackets[index].id };
    await writeJSON(KNOCKOUTS_FILE, brackets);
    res.json(brackets[index]);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/knockouts/:id", async (req, res, next) => {
  try {
    const brackets = await readJSON(KNOCKOUTS_FILE);
    const next_ = brackets.filter((b) => b.id !== req.params.id);
    await writeJSON(KNOCKOUTS_FILE, next_);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Groups ----

app.get("/api/groups", async (req, res, next) => {
  try {
    res.json(await readJSON(GROUPS_FILE));
  } catch (err) {
    next(err);
  }
});

app.put("/api/groups/:id", async (req, res, next) => {
  try {
    const groups = await readJSON(GROUPS_FILE);
    const index = groups.findIndex((g) => g.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: "Group not found" });
    groups[index] = { ...groups[index], ...req.body, id: groups[index].id };
    await writeJSON(GROUPS_FILE, groups);
    res.json(groups[index]);
  } catch (err) {
    next(err);
  }
});

app.delete("/api/groups/:id", async (req, res, next) => {
  try {
    const groups = await readJSON(GROUPS_FILE);
    const next_ = groups.filter((g) => g.id !== req.params.id);
    await writeJSON(GROUPS_FILE, next_);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Imports one event's group draw from a fixed local workbook (admin/Groups.xlsx).
// Each sheet is named after an event. Within a sheet, each group is a pair of columns
// headed "Group N Names" / "Group N Clubs", with one player per row (row order = seed
// order). Importing replaces all existing groups (and any scores already entered) for
// that event with the sheet's groups.
app.post("/api/groups/import-local", async (req, res, next) => {
  try {
    const event = String(req.body.event || "").trim();
    if (!event) return res.status(400).json({ error: "No event specified" });

    try {
      await fs.access(GROUPS_IMPORT_FILE);
    } catch {
      return res.status(400).json({
        error: `Groups.xlsx not found in the admin folder (expected at ${GROUPS_IMPORT_FILE})`,
      });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(GROUPS_IMPORT_FILE);

    const worksheet = workbook.worksheets.find(
      (sheet) => sheet.name.trim().toLowerCase() === event.toLowerCase()
    );
    if (!worksheet) {
      const available = workbook.worksheets.map((s) => s.name).join(", ") || "(none)";
      return res.status(400).json({
        error: `No sheet named "${event}" found in Groups.xlsx. Available sheets: ${available}`,
      });
    }

    const groupColumns = {};
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      const header = String(cell.value ?? "").trim();
      const namesMatch = header.match(/^Group\s+(\d+)\s+Names$/i);
      const clubsMatch = header.match(/^Group\s+(\d+)\s+Clubs$/i);
      if (namesMatch) {
        const n = namesMatch[1];
        groupColumns[n] = { ...(groupColumns[n] || {}), namesCol: colNumber };
      } else if (clubsMatch) {
        const n = clubsMatch[1];
        groupColumns[n] = { ...(groupColumns[n] || {}), clubsCol: colNumber };
      }
    });

    const groupNumbers = Object.keys(groupColumns).sort((a, b) => Number(a) - Number(b));
    if (groupNumbers.length === 0) {
      return res.status(400).json({
        error: 'No "Group N Names" / "Group N Clubs" columns found in the header row',
      });
    }

    const warnings = [];
    const imported = [];

    groupNumbers.forEach((n) => {
      const { namesCol, clubsCol } = groupColumns[n];
      if (!namesCol || !clubsCol) {
        warnings.push(`Group ${n}: missing a "Names" or "Clubs" column — skipped`);
        return;
      }

      const players = [];
      for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        const name = String(row.getCell(namesCol).value ?? "").trim();
        const club = String(row.getCell(clubsCol).value ?? "").trim();
        if (!name) continue;
        players.push({ name, club });
      }

      if (players.length === 0) {
        warnings.push(`Group ${n}: no players filled in — skipped`);
        return;
      }
      if (players.length > 4) {
        warnings.push(`Group ${n}: has ${players.length} players, only the first 4 are used`);
      }

      const [p1, p2, p3, p4] = players;
      imported.push({
        id: crypto.randomUUID(),
        event,
        group: n,
        seed: p1?.name || "",
        seedClub: p1?.club || "",
        name2: p2?.name || "",
        club2: p2?.club || "",
        name3: p3?.name || "",
        club3: p3?.club || "",
        name4: p4?.name || "",
        club4: p4?.club || "",
        day: "",
        date: "",
        time: "",
        table: "",
        matches: {},
      });
    });

    if (imported.length === 0) {
      warnings.push(`Sheet "${worksheet.name}" had no groups with players filled in.`);
    }

    const existingGroups = await readJSON(GROUPS_FILE);
    const remaining = existingGroups.filter((g) => g.event !== event);
    await writeJSON(GROUPS_FILE, [...remaining, ...imported]);

    res.status(201).json({ imported: imported.length, warnings });
  } catch (err) {
    next(err);
  }
});

// ---- National rankings lookup ----
// Reads a fixed local workbook (admin/rankings.xlsx or Rankings.xlsx), sheet "All Rankings".
// The header row (containing a "Rank" cell) isn't always row 1 — there may be a title block
// above it — so it's located dynamically, as is the rank column. Cells are often formulas
// (e.g. CONCATENATE), which ExcelJS returns as { formula, result } rather than plain text.
// Fuzzy name matching against these lists happens client-side.

app.get("/api/rankings", async (req, res, next) => {
  try {
    const event = String(req.query.event || "").trim();
    if (!event) return res.status(400).json({ error: "No event specified" });

    try {
      await fs.access(RANKINGS_FILE);
    } catch {
      return res.status(400).json({
        error: `rankings.xlsx not found in the admin folder (expected at ${RANKINGS_FILE})`,
      });
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(RANKINGS_FILE);

    const worksheet = workbook.worksheets.find(
      (sheet) => sheet.name.trim().toLowerCase() === "all rankings"
    );
    if (!worksheet) {
      return res.status(400).json({ error: 'No sheet named "All Rankings" found in rankings.xlsx' });
    }

    let headerRowNumber = null;
    let rankCol = null;
    for (let r = 1; r <= Math.min(10, worksheet.rowCount) && !headerRowNumber; r++) {
      worksheet.getRow(r).eachCell((cell, colNumber) => {
        if (cellText(cell).toLowerCase() === "rank") {
          headerRowNumber = r;
          rankCol = colNumber;
        }
      });
    }

    if (!headerRowNumber) {
      return res.status(400).json({ error: 'Could not find a "Rank" header cell in the All Rankings sheet' });
    }

    let matchedCol = null;
    const availableHeaders = [];
    worksheet.getRow(headerRowNumber).eachCell((cell, colNumber) => {
      if (colNumber === rankCol) return;
      const header = cellText(cell);
      if (!header) return;
      availableHeaders.push(header);
      if (header.toLowerCase() === event.toLowerCase()) {
        matchedCol = colNumber;
      }
    });

    if (!matchedCol) {
      return res.status(400).json({
        error: `No ranking category matching "${event}" found in rankings.xlsx. Available categories: ${availableHeaders.join(", ")}`,
      });
    }

    const rankings = [];
    for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const rankText = cellText(row.getCell(rankCol));
      const name = cellText(row.getCell(matchedCol));
      if (!name || rankText === "") continue;
      const rank = Number(rankText);
      if (Number.isNaN(rank)) continue;
      rankings.push({ rank, name });
    }

    res.json(rankings);
  } catch (err) {
    next(err);
  }
});

// ---- Bulk import from Excel ----

function parsePaid(value) {
  if (typeof value === "boolean") return value;
  const str = String(value ?? "").trim().toLowerCase();
  return ["yes", "y", "true", "1", "paid"].includes(str);
}

// TRUE (boolean) or "x"/"X" means entered; blank, FALSE, or anything else means not entered.
function isEntered(value) {
  if (typeof value === "boolean") return value === true;
  if (typeof value === "string") return value.trim().toLowerCase() === "x";
  return false;
}

app.get("/api/entries/template", async (req, res, next) => {
  try {
    const tournament = await readJSON(TOURNAMENT_FILE);
    const events = tournament.events || [];
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Entries");
    sheet.columns = [
      { header: "No.", key: "no", width: 6 },
      { header: "Name & Surname", key: "name", width: 24 },
      { header: "Club", key: "club", width: 20 },
      { header: "Date of Birth", key: "dob", width: 16 },
      ...events.map((ev) => ({ header: ev, key: ev, width: 12 })),
    ];
    const sampleRow = { no: 1, name: "Jane Doe", club: "Ravens", dob: "" };
    events.slice(0, 2).forEach((ev) => (sampleRow[ev] = "x"));
    sheet.addRow(sampleRow);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", 'attachment; filename="entries-template.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

app.post("/api/entries/import", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const tournament = await readJSON(TOURNAMENT_FILE);
    const tournamentEvents = tournament.events || [];

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return res.status(400).json({ error: "No worksheet found in file" });

    const columnIndex = {};
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      const key = String(cell.value ?? "").trim().toLowerCase();
      if (key) columnIndex[key] = colNumber;
    });

    const nameCol = columnIndex["name & surname"] || columnIndex["name"];
    const clubCol = columnIndex["club"];
    const paidCol = columnIndex["paid"];

    if (!nameCol) {
      return res.status(400).json({ error: 'Missing required "Name & Surname" column in header row' });
    }

    const eventColumns = tournamentEvents
      .map((ev) => ({ event: ev, col: columnIndex[ev.toLowerCase()] }))
      .filter((e) => e.col);

    const warnings = [];
    if (eventColumns.length === 0) {
      warnings.push("No columns matched the tournament's configured events — no entries will be assigned to events.");
    }

    const entries = await readJSON(ENTRIES_FILE);
    let importedCount = 0;

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const name = String(row.getCell(nameCol).value ?? "").trim();
      if (!name) continue;

      const club = clubCol ? String(row.getCell(clubCol).value ?? "").trim() : "";
      const paid = parsePaid(paidCol ? row.getCell(paidCol).value : false);
      const events = eventColumns
        .filter(({ col }) => isEntered(row.getCell(col).value))
        .map(({ event }) => event);

      entries.push({ id: crypto.randomUUID(), name, club, events, paid });
      importedCount++;
    }

    await writeJSON(ENTRIES_FILE, entries);
    res.status(201).json({ imported: importedCount, warnings });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Tournament control panel running at http://localhost:${PORT}`);
});
