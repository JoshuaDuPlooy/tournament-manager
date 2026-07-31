// Generates two PDFs from the current tournament data:
//   admin/output/Group Scorecards.pdf    — one scorecard per group (+ 5 blank at the end)
//   admin/output/Knockout Scorecards.pdf — one scorecard per knockout match (+ 10 blank at the end)
//
// Each PDF is built by cloning "Group Scorecard.xlsx" / "Knockout Scorecard.xlsx" once per
// entry into a combined workbook (one sheet per entry, ordered by scheduled time then table),
// then converting that workbook to PDF via Excel COM automation (scripts/xlsx-to-pdf.ps1).
//
// Run with: npm run scorecards   (from the admin/ folder)

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const ExcelJS = require("exceljs");

const ADMIN_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ADMIN_DIR, "..", "site", "data");
const OUTPUT_DIR = path.join(ADMIN_DIR, "output");
const GROUP_TEMPLATE = path.join(ADMIN_DIR, "Group Scorecard.xlsx");
const KNOCKOUT_TEMPLATE = path.join(ADMIN_DIR, "Knockout Scorecard.xlsx");
const PDF_SCRIPT = path.join(__dirname, "xlsx-to-pdf.ps1");

const BLANK_GROUP_CARDS = 5;
const BLANK_KNOCKOUT_CARDS = 10;

// Excel's "fit to page" only ever shrinks content, never enlarges it — so a scorecard whose
// native size is already smaller than a page prints undersized. Cloned sheets are oversized by
// this factor (rows, columns, AND font size together) before fit-to-page is applied, forcing a
// real shrink-to-fit that lands on the true maximum same-aspect-ratio size for the page. The
// result is independent of the exact factor chosen, as long as it's large enough to push the
// content past one page — the font is scaled by the same factor so the enlargement lands on the
// page layout only, not on relative text size (which would otherwise shrink right along with it).
const FILL_SCALE_FACTOR = 5;
const DEFAULT_COL_WIDTH = 8.43;
const DEFAULT_ROW_HEIGHT = 15;

// ---- schedule lookups (ported from the web app — same matching rules, DOM-free) ----

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

function firstHit(hits) {
  if (!hits || hits.length === 0) return null;
  return [...hits].sort((a, b) => a.time.localeCompare(b.time))[0];
}

// One entry per distinct table a group appears on (earliest time seen on that table) — a
// group split across two tables prints one scorecard per table.
function hitsByTable(hits) {
  const byTable = new Map();
  (hits || []).forEach((h) => {
    const existing = byTable.get(h.table);
    if (!existing || h.time < existing.time) byTable.set(h.table, h);
  });
  return Array.from(byTable.values()).sort((a, b) => Number(a.table) - Number(b.table));
}

// ---- ordering: scheduled entries by time then table; unscheduled entries last ----

function compareEntries(a, b) {
  if (a.time && b.time) {
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    const ta = Number(a.table);
    const tb = Number(b.table);
    if (ta !== tb) return ta - tb;
  } else if (a.time && !b.time) {
    return -1;
  } else if (!a.time && b.time) {
    return 1;
  }
  if (a.event !== b.event) return a.event.localeCompare(b.event);
  return a.sortKey - b.sortKey;
}

function uniqueSheetName(workbook, base) {
  const clean = base.replace(/[\\/?*[\]:]/g, "").slice(0, 31) || "Sheet";
  let name = clean;
  let n = 2;
  while (workbook.getWorksheet(name)) {
    const suffix = ` (${n})`;
    name = clean.slice(0, 31 - suffix.length) + suffix;
    n++;
  }
  return name;
}

// ---- worksheet cloning (ExcelJS has no cross-workbook "copy sheet", so this replicates
// values, styles, merges, column widths, row heights, and page setup by hand) ----

function cloneSheet(workbook, templateSheet, newName) {
  const newSheet = workbook.addWorksheet(newName, {
    properties: { ...templateSheet.properties },
    pageSetup: { ...templateSheet.pageSetup },
    views: templateSheet.views,
  });

  const maxCol = templateSheet.columnCount;
  for (let c = 1; c <= maxCol; c++) {
    const tcol = templateSheet.getColumn(c);
    const width = (tcol && tcol.width) || DEFAULT_COL_WIDTH;
    newSheet.getColumn(c).width = width * FILL_SCALE_FACTOR;
  }

  templateSheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const newRow = newSheet.getRow(rowNumber);
    newRow.height = (row.height || DEFAULT_ROW_HEIGHT) * FILL_SCALE_FACTOR;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const newCell = newRow.getCell(colNumber);
      newCell.value = cell.value;
      const style = cell.style ? JSON.parse(JSON.stringify(cell.style)) : {};
      // Row/column dimensions are being scaled up so Excel's shrink-to-fit has real
      // oversized content to shrink back down (see FILL_SCALE_FACTOR comment) — font size
      // has to be scaled up by the same factor here, otherwise that shrink-back-down step
      // shrinks the text along with everything else, cancelling out the enlargement.
      const baseFontSize = (style.font && style.font.size) || 11;
      style.font = { ...(style.font || {}), size: baseFontSize * FILL_SCALE_FACTOR };
      newCell.style = style;
    });
    newRow.commit();
  });

  (templateSheet.model.merges || []).forEach((merge) => {
    try {
      newSheet.mergeCells(merge);
    } catch {
      // ignore — duplicate/invalid merge, shouldn't happen with a clean template
    }
  });

  // Force a real shrink-to-fit (see FILL_SCALE_FACTOR comment above) so every scorecard uses
  // the full page, centered both ways.
  newSheet.pageSetup.fitToPage = true;
  newSheet.pageSetup.fitToWidth = 1;
  newSheet.pageSetup.fitToHeight = 1;
  newSheet.pageSetup.horizontalCentered = true;
  newSheet.pageSetup.verticalCentered = true;

  return newSheet;
}

function convertToPdf(xlsxPath, pdfPath) {
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PDF_SCRIPT, "-InputPath", xlsxPath, "-OutputPath", pdfPath],
    { stdio: "inherit" }
  );
}

// ---- build entry lists (schedule info only — filling happens once entries are sorted) ----

function buildGroupEntries(groups, schedule) {
  const entries = [];
  groups.forEach((g, idx) => {
    const hits = hitsByTable(scheduleHitsForGroup(schedule, g.event, g.group));
    const slots = hits.length > 0 ? hits : [null];
    slots.forEach((hit, hitIdx) => {
      entries.push({
        group: g,
        event: g.event,
        time: hit ? hit.time : null,
        table: hit ? hit.table : null,
        sortKey: idx * 10 + hitIdx,
      });
    });
  });
  return entries;
}

function buildKnockoutEntries(knockouts, schedule) {
  const entries = [];
  let sortKey = 0;

  knockouts.forEach((bracket) => {
    const totalRounds = totalKnockoutRounds(bracket.size);

    // Round 1: schedules number only the real (non-bye) matches, so a bye-skipping counter is
    // used both for the printed "Match" number and for looking the match up in the schedule.
    let scheduleMatchCounter = 0;
    (bracket.round1Slots || []).forEach((slot) => {
      const isBye = slot.p1 === "bye" || slot.p2 === "bye";
      if (isBye) return;
      scheduleMatchCounter += 1;
      const matchNumber = scheduleMatchCounter;
      const hit = firstHit(scheduleHitsForMatch(schedule, bracket.event, 1, totalRounds, matchNumber));
      entries.push({
        event: bracket.event,
        round: knockoutRoundLabel(1, totalRounds),
        match: matchNumber,
        time: hit ? hit.time : null,
        table: hit ? hit.table : null,
        sortKey: sortKey++,
      });
    });

    // Later rounds never have byes.
    for (let r = 2; r <= totalRounds; r++) {
      const matchesInRound = bracket.size / Math.pow(2, r);
      for (let m = 1; m <= matchesInRound; m++) {
        const hit = firstHit(scheduleHitsForMatch(schedule, bracket.event, r, totalRounds, m));
        entries.push({
          event: bracket.event,
          round: knockoutRoundLabel(r, totalRounds),
          match: m,
          time: hit ? hit.time : null,
          table: hit ? hit.table : null,
          sortKey: sortKey++,
        });
      }
    }
  });

  return entries;
}

function fillGroupSheet(sheet, g, entry) {
  sheet.getCell("B1").value = g.group;
  sheet.getCell("H1").value = entry.time || "";
  sheet.getCell("J1").value = entry.table || "";
  sheet.getCell("I2").value = g.event;

  sheet.getCell("B4").value = g.seed || "";
  sheet.getCell("F4").value = g.seedClub || "";
  sheet.getCell("B5").value = g.name2 || "";
  sheet.getCell("F5").value = g.club2 || "";
  sheet.getCell("B6").value = g.name3 || "";
  sheet.getCell("F6").value = g.club3 || "";
  sheet.getCell("B7").value = g.name4 || "";
  sheet.getCell("F7").value = g.club4 || "";
}

function fillKnockoutSheet(sheet, entry) {
  sheet.getCell("B1").value = entry.round;
  sheet.getCell("E1").value = entry.match;
  sheet.getCell("H1").value = entry.time || "";
  sheet.getCell("J1").value = entry.table || "";
  sheet.getCell("I2").value = entry.event;
  // Names intentionally left blank.
}

// ---- main ----

async function generateGroupScorecards(groups, schedule, groupTemplateSheet) {
  const entries = buildGroupEntries(groups, schedule).sort(compareEntries);
  const outputWb = new ExcelJS.Workbook();

  entries.forEach((entry) => {
    const g = entry.group;
    const sheet = cloneSheet(outputWb, groupTemplateSheet, uniqueSheetName(outputWb, `${g.event} G${g.group}`));
    fillGroupSheet(sheet, g, entry);
  });

  for (let i = 1; i <= BLANK_GROUP_CARDS; i++) {
    cloneSheet(outputWb, groupTemplateSheet, uniqueSheetName(outputWb, `Blank Group ${i}`));
  }

  const xlsxPath = path.join(OUTPUT_DIR, "Group Scorecards.xlsx");
  const pdfPath = path.join(OUTPUT_DIR, "Group Scorecards.pdf");
  await outputWb.xlsx.writeFile(xlsxPath);
  console.log(`Built ${entries.length} group + ${BLANK_GROUP_CARDS} blank scorecard(s) — converting to PDF…`);
  convertToPdf(xlsxPath, pdfPath);
}

async function generateKnockoutScorecards(knockouts, schedule, knockoutTemplateSheet) {
  const entries = buildKnockoutEntries(knockouts, schedule).sort(compareEntries);
  const outputWb = new ExcelJS.Workbook();

  entries.forEach((entry) => {
    const sheet = cloneSheet(
      outputWb,
      knockoutTemplateSheet,
      uniqueSheetName(outputWb, `${entry.event} ${entry.round} M${entry.match}`)
    );
    fillKnockoutSheet(sheet, entry);
  });

  for (let i = 1; i <= BLANK_KNOCKOUT_CARDS; i++) {
    cloneSheet(outputWb, knockoutTemplateSheet, uniqueSheetName(outputWb, `Blank Knockout ${i}`));
  }

  const xlsxPath = path.join(OUTPUT_DIR, "Knockout Scorecards.xlsx");
  const pdfPath = path.join(OUTPUT_DIR, "Knockout Scorecards.pdf");
  await outputWb.xlsx.writeFile(xlsxPath);
  console.log(`Built ${entries.length} knockout + ${BLANK_KNOCKOUT_CARDS} blank scorecard(s) — converting to PDF…`);
  convertToPdf(xlsxPath, pdfPath);
}

async function main() {
  const groups = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "groups.json"), "utf-8"));
  const knockouts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "knockouts.json"), "utf-8"));
  const schedule = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "schedule.json"), "utf-8"));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const groupTemplateWb = new ExcelJS.Workbook();
  await groupTemplateWb.xlsx.readFile(GROUP_TEMPLATE);
  const groupTemplateSheet = groupTemplateWb.worksheets[0];

  const knockoutTemplateWb = new ExcelJS.Workbook();
  await knockoutTemplateWb.xlsx.readFile(KNOCKOUT_TEMPLATE);
  const knockoutTemplateSheet = knockoutTemplateWb.worksheets[0];

  await generateGroupScorecards(groups, schedule, groupTemplateSheet);
  await generateKnockoutScorecards(knockouts, schedule, knockoutTemplateSheet);

  console.log("Done. See admin/output/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
