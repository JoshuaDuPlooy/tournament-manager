// Generates a printable copy of the public Schedule page, with the same per-event color
// coding, as one A3 landscape page:
//   admin/output/Schedule.pdf
//
// Colors and cell formatting are ported directly from site/schedule.html (EVENT_COLORS,
// eventColor, matchEventForText, formatScheduleCell) so the printout matches the site exactly.
//
// Run with: npm run schedule-pdf   (from the admin/ folder)

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const ADMIN_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ADMIN_DIR, "..", "site", "data");
const OUTPUT_DIR = path.join(ADMIN_DIR, "output");

const MARGIN = 40;
const HEADER_AREA_HEIGHT = 100;
const TIME_COL_WIDTH = 70;
const BORDER_COLOR = "#e0e0e0";
const HEADER_FILL = "#1c2530";

// Same palette/order as site/schedule.html's EVENT_COLORS.
// Event colours for the schedule grid. Chosen so no two are easily confused: every pair is
// at least deltaE 16 apart (CIEDE2000), and at least 10 apart when simulated as red-green
// colour blindness -- the old pastel set fell to 3, which made orange and yellow identical.
// The orange/olive pair in particular is separated by lightness rather than hue, which is
// what survives colour-vision deficiency. All keep >= 6:1 contrast with the cell text.
const EVENT_COLORS = ["#EE848F", "#FCBB6F", "#B6A047", "#A3EDAF", "#37B39A", "#7FE4E6", "#27ADFF", "#DA8CD1"];

// Each sheet of Schedule.xlsx is a day and every row records the day it belongs to.
// Schedules built before days existed have neither, and count as one unnamed day.
function scheduleDayList(schedule) {
  if (Array.isArray(schedule.days) && schedule.days.length) return schedule.days;
  const seen = [];
  (schedule.rows || []).forEach((row) => {
    const d = row.day || "";
    if (!seen.includes(d)) seen.push(d);
  });
  return seen;
}

function eventColor(events, event) {
  const idx = events.indexOf(event);
  return EVENT_COLORS[(idx >= 0 ? idx : 0) % EVENT_COLORS.length];
}

function matchEventForText(events, text) {
  const lower = text.toLowerCase();
  return events.find((ev) => lower.startsWith(ev.toLowerCase())) || null;
}

// Groups render as "Event / Group N" (2 lines); knockout matches as "Event / Round / Match N"
// (3 lines) — same rules as formatScheduleCell in site/schedule.html.
// Cell text is sized to fill its block rather than sitting at a fixed size: a page with
// few rows gets large type, a dense page smaller, and either way the block is used. The
// binding constraint is usually the longest line's width, not the height.
const CELL_PAD_X = 4;
const CELL_PAD_Y = 4;
const CELL_FONT_MIN = 8;
const CELL_FONT_MAX = 26;
const CELL_LINE_GAP_RATIO = 0.12;

function fitFontSize(doc, lines, maxWidth, maxHeight, minSize, maxSize) {
  for (let size = maxSize; size > minSize; size -= 0.5) {
    doc.fontSize(size);
    const lineHeight = doc.currentLineHeight() + size * CELL_LINE_GAP_RATIO;
    if (lines.length * lineHeight > maxHeight) continue;
    if (Math.max(...lines.map((l) => doc.widthOfString(l))) > maxWidth) continue;
    return size;
  }
  return minSize;
}

function formatScheduleCellLines(text, event) {
  if (!event) return [text];
  const rest = text.slice(event.length).trim().replace(/\s+/g, " ");
  if (/^Group\s+\d+$/i.test(rest)) {
    return [event, rest];
  }
  const matchSplit = rest.match(/^(.*?)\s+(Match\s+\d+)$/i);
  if (matchSplit) {
    return [event, matchSplit[1].trim(), matchSplit[2].trim()];
  }
  return [event, rest];
}

async function main() {
  const tournament = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "tournament.json"), "utf-8"));
  const schedule = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "schedule.json"), "utf-8"));

  const events = tournament.events || [];
  const tables = schedule.tables || [];
  const rows = schedule.rows || [];
  const days = scheduleDayList(schedule);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, "Schedule.pdf");
  const doc = new PDFDocument({ size: "A3", layout: "landscape", margin: 0 });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;

  // One page per day of play.
  days.forEach((day, dayIndex) => {
  const rowsForDay = rows.filter((r) => (r.day || "") === day);
  if (dayIndex > 0) doc.addPage();

  doc.fillColor("#1c2530").font("Helvetica-Bold").fontSize(18).text(tournament.name, MARGIN, MARGIN, {
    width: pageWidth - MARGIN * 2,
    align: "center",
  });
  doc
    .font("Helvetica")
    .fontSize(11)
    .fillColor("#6b7684")
    .text(`${day ? day + " · " : ""}${tournament.startDate} — ${tournament.endDate} · ${tournament.venue}`, MARGIN, MARGIN + 24, {
      width: pageWidth - MARGIN * 2,
      align: "center",
    });

  // Legend: colored swatch + event name, one row.
  const legendY = MARGIN + 50;
  doc.font("Helvetica").fontSize(9);
  let legendX = MARGIN;
  events.forEach((ev) => {
    const color = eventColor(events, ev);
    doc.rect(legendX, legendY, 12, 12).fill(color);
    doc.fillColor("#1c2530").text(ev, legendX + 16, legendY + 2, { lineBreak: false });
    legendX += 16 + doc.widthOfString(ev) + 20;
  });

  // Table.
  const left = MARGIN;
  const top = MARGIN + HEADER_AREA_HEIGHT;
  const width = pageWidth - MARGIN * 2;
  const height = pageHeight - MARGIN - top;
  const colWidth = (width - TIME_COL_WIDTH) / tables.length;
  const rowHeight = height / (rowsForDay.length + 1);

  function colX(i) {
    // i === 0 is the Time column; i >= 1 are table columns.
    return i === 0 ? left : left + TIME_COL_WIDTH + (i - 1) * colWidth;
  }
  function colW(i) {
    return i === 0 ? TIME_COL_WIDTH : colWidth;
  }

  // Header row.
  doc.rect(left, top, width, rowHeight).fill(HEADER_FILL);
  doc.fillColor("#ffffff").font("Helvetica-Bold");
  // Scaled with the rest of the grid, otherwise the column headings look undersized
  // beside the enlarged cell text.
  // The headings sit side by side, so this is a single line whose width is set by the
  // widest label — not one line per column.
  doc.fontSize(12);
  const widestHeading = ["Time", ...tables].reduce((a, b) =>
    doc.widthOfString(b) > doc.widthOfString(a) ? b : a
  );
  const headerSize = fitFontSize(
    doc,
    [widestHeading],
    Math.min(colW(0), colWidth) - CELL_PAD_X * 2,
    rowHeight - CELL_PAD_Y * 2,
    11,
    22
  );
  doc.fontSize(headerSize);
  const headerY = top + rowHeight / 2 - doc.currentLineHeight() / 2;
  doc.text("Time", colX(0), headerY, { width: colW(0), align: "center" });
  tables.forEach((t, i) => {
    doc.text(t, colX(i + 1), headerY, { width: colW(i + 1), align: "center" });
  });

  // Every cell on the page uses one size — the largest at which the busiest block still
  // fits. Sizing each block independently would leave neighbouring cells at visibly
  // different sizes, which reads badly across a grid.
  doc.font("Helvetica-Bold");
  let pageCellFontSize = CELL_FONT_MAX;
  rowsForDay.forEach((row) => {
    tables.forEach((t) => {
      const text = row.cells[t];
      if (!text) return;
      const lines = formatScheduleCellLines(text, matchEventForText(events, text));
      const fitted = fitFontSize(
        doc,
        lines,
        colWidth - CELL_PAD_X * 2,
        rowHeight - CELL_PAD_Y * 2,
        CELL_FONT_MIN,
        CELL_FONT_MAX
      );
      if (fitted < pageCellFontSize) pageCellFontSize = fitted;
    });
  });

  // Data rows.
  rowsForDay.forEach((row, r) => {
    const rowY = top + (r + 1) * rowHeight;

    doc.rect(colX(0), rowY, colW(0), rowHeight).fillAndStroke("#f5f7fa", BORDER_COLOR);
    // The time would look tiny beside newly enlarged cells, so it scales with the row too.
    doc.fillColor("#1c2530").font("Helvetica-Bold");
    const timeSize = fitFontSize(doc, [row.time], colW(0) - CELL_PAD_X * 2, rowHeight - CELL_PAD_Y * 2, 9, 20);
    doc
      .fontSize(timeSize)
      .text(row.time, colX(0), rowY + rowHeight / 2 - doc.currentLineHeight() / 2, {
        width: colW(0),
        align: "center",
      });

    tables.forEach((t, i) => {
      const cellX = colX(i + 1);
      const cellW = colW(i + 1);
      const text = row.cells[t];

      if (!text) {
        doc.rect(cellX, rowY, cellW, rowHeight).stroke(BORDER_COLOR);
        return;
      }

      const ev = matchEventForText(events, text);
      const color = ev ? eventColor(events, ev) : "#eeeeee";
      doc.rect(cellX, rowY, cellW, rowHeight).fillAndStroke(color, BORDER_COLOR);

      const lines = formatScheduleCellLines(text, ev);
      const size = pageCellFontSize;
      doc.font("Helvetica-Bold").fontSize(size);
      const lineGap = size * CELL_LINE_GAP_RATIO;
      const blockHeight = lines.length * (doc.currentLineHeight() + lineGap) - lineGap;
      doc
        .fillColor("#1c2530")
        .text(lines.join("\n"), cellX + CELL_PAD_X, rowY + rowHeight / 2 - blockHeight / 2, {
          width: cellW - CELL_PAD_X * 2,
          align: "center",
          lineGap,
        });
    });
  });
  });

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  const dayLabel = days.length > 1 ? `${days.length} day(s), ` : "";
  console.log(`Built schedule PDF (${dayLabel}${rows.length} time slot(s) x ${tables.length} table(s)) — ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
