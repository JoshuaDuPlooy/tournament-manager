const express = require("express");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const ExcelJS = require("exceljs");

const DATA_DIR = path.join(__dirname, "..", "site", "data");
const TOURNAMENT_FILE = path.join(DATA_DIR, "tournament.json");
const ENTRIES_FILE = path.join(DATA_DIR, "entries.json");

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
