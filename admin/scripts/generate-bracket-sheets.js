// Generates a printable knockout bracket-tree diagram for every event that has a bracket
// configured, one A3 portrait page per event:
//   admin/output/Knockout Brackets.pdf
//
// Match cards are styled to match the admin control panel's Knockouts tab (dark round-header
// bar, rounded card with a divider between the two player rows — see admin/public/style.css
// .round-header / .ko-match-card / .ko-match-player), with bracket connector lines added
// between them.
//
// Round 1 shows the raw seeding codes exactly as entered in the control panel (e.g. "1W" =
// Group 1 Winner, "2R" = Group 2 Runner-up, "BYE") — not resolved player names. Round 2 onward
// is left blank (empty card, ready to hand-write the advancing player's name) since those slots
// aren't known until earlier rounds are actually played.
//
// Drawn directly with PDFKit at exact page coordinates (rather than via Excel's page-setup
// scaling) so every diagram fills the full A3 page regardless of bracket size, with the rounds
// evenly spaced left to right and matches evenly spaced top to bottom.
//
// Run with: npm run brackets   (from the admin/ folder)

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const ADMIN_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ADMIN_DIR, "..", "site", "data");
const OUTPUT_DIR = path.join(ADMIN_DIR, "output");

const MARGIN = 40;
const HEADER_HEIGHT = 90;
const CARD_WIDTH_RATIO = 0.72;
const CARD_RADIUS = 6;
const MAX_CARD_HEIGHT = 44;
const HEADER_BAR_HEIGHT = 22;

// Matches admin/public/style.css's --color-* variables, so the printed bracket reads like the
// control panel's Knockouts tab.
const COLOR_TEXT = "#1c2530";
const COLOR_BORDER = "#dbe1e8";
const COLOR_SURFACE = "#ffffff";

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

function slotCodeLabel(raw) {
  if (!raw) return "";
  return raw.toLowerCase() === "bye" ? "BYE" : raw.toUpperCase();
}

// Recursively centers each round's matches on the midpoint of the two matches feeding into
// them, so the connector lines always meet cleanly — round 1 centers are evenly spaced, then
// each later round is the average of its two children.
function computeCenters(matchesInRound1, top, matchBlockHeight, totalRounds) {
  const centers = [[]]; // index 0 unused, rounds are 1-indexed
  centers[1] = [];
  for (let i = 1; i <= matchesInRound1; i++) {
    centers[1].push(top + (i - 0.5) * matchBlockHeight);
  }
  for (let r = 2; r <= totalRounds; r++) {
    const prev = centers[r - 1];
    const round = [];
    for (let i = 0; i < prev.length / 2; i++) {
      round.push((prev[i * 2] + prev[i * 2 + 1]) / 2);
    }
    centers[r] = round;
  }
  return centers;
}

function drawBracketPage(doc, tournamentName, bracket) {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;

  doc.fillColor(COLOR_TEXT).font("Helvetica-Bold").fontSize(18).text(tournamentName, MARGIN, MARGIN, {
    width: pageWidth - MARGIN * 2,
    align: "center",
  });
  doc.font("Helvetica-Bold").fontSize(14).text(`${bracket.event} — Knockout Bracket`, MARGIN, MARGIN + 24, {
    width: pageWidth - MARGIN * 2,
    align: "center",
  });

  const totalRounds = totalKnockoutRounds(bracket.size);
  const matchesInRound1 = bracket.size / 2;

  const left = MARGIN;
  const right = pageWidth - MARGIN;
  const top = MARGIN + HEADER_HEIGHT;
  const bottom = pageHeight - MARGIN;
  const width = right - left;
  const height = bottom - top;

  const roundColWidth = width / totalRounds;
  const cardWidth = roundColWidth * CARD_WIDTH_RATIO;
  const matchBlockHeight = height / matchesInRound1;
  const cardHeight = Math.min(MAX_CARD_HEIGHT, matchBlockHeight * 0.6);

  const centers = computeCenters(matchesInRound1, top, matchBlockHeight, totalRounds);

  // Round header bars (dark bg, white bold text, rounded top corners — same look as the
  // control panel's .round-header).
  const headerBarY = top - HEADER_BAR_HEIGHT - 10;
  for (let r = 1; r <= totalRounds; r++) {
    const colLeft = left + (r - 1) * roundColWidth;
    doc.roundedRect(colLeft, headerBarY, cardWidth, HEADER_BAR_HEIGHT, CARD_RADIUS).fill(COLOR_TEXT);
    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(knockoutRoundLabel(r, totalRounds), colLeft, headerBarY + 7, { width: cardWidth, align: "center" });
  }

  // Match cards.
  for (let r = 1; r <= totalRounds; r++) {
    const matchesInThisRound = matchesInRound1 / Math.pow(2, r - 1);
    const colLeft = left + (r - 1) * roundColWidth;
    const slots = r === 1 ? bracket.round1Slots || [] : null;

    for (let i = 1; i <= matchesInThisRound; i++) {
      const center = centers[r][i - 1];
      const cardTop = center - cardHeight / 2;

      doc
        .roundedRect(colLeft, cardTop, cardWidth, cardHeight, CARD_RADIUS)
        .lineWidth(1)
        .fillAndStroke(COLOR_SURFACE, COLOR_BORDER);
      doc.moveTo(colLeft, center).lineTo(colLeft + cardWidth, center).strokeColor(COLOR_BORDER).lineWidth(1).stroke();

      if (r === 1) {
        const slot = (slots || []).find((s) => s.match === i) || {};
        const p1Label = slotCodeLabel(slot.p1);
        const p2Label = slotCodeLabel(slot.p2);
        doc.fillColor(COLOR_TEXT).font("Helvetica").fontSize(10);
        if (p1Label) {
          doc.text(p1Label, colLeft + 8, cardTop + cardHeight / 4 - 5, { width: cardWidth - 16, lineBreak: false });
        }
        if (p2Label) {
          doc.text(p2Label, colLeft + 8, center + cardHeight / 4 - 5, { width: cardWidth - 16, lineBreak: false });
        }
      }
      // Rounds 2+ are intentionally left blank — an empty card to hand-write the winner's name.
    }
  }

  // Connector lines, card edge to card edge — drawn last so they sit crisply against the cards.
  doc.strokeColor(COLOR_TEXT).lineWidth(1);
  for (let r = 1; r < totalRounds; r++) {
    const matchesInThisRound = matchesInRound1 / Math.pow(2, r - 1);
    const colLeft = left + (r - 1) * roundColWidth;
    const cardRight = colLeft + cardWidth;
    const nextColLeft = left + r * roundColWidth;
    const connectorX = (cardRight + nextColLeft) / 2;

    for (let p = 0; p < matchesInThisRound / 2; p++) {
      const y1 = centers[r][p * 2];
      const y2 = centers[r][p * 2 + 1];
      const parentY = centers[r + 1][p];
      doc
        .moveTo(cardRight, y1)
        .lineTo(connectorX, y1)
        .moveTo(cardRight, y2)
        .lineTo(connectorX, y2)
        .moveTo(connectorX, y1)
        .lineTo(connectorX, y2)
        .moveTo(connectorX, parentY)
        .lineTo(nextColLeft, parentY)
        .stroke();
    }
  }
}

async function main() {
  const tournament = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "tournament.json"), "utf-8"));
  const knockouts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "knockouts.json"), "utf-8"));

  const events = tournament.events || [];
  const brackets = events.map((ev) => knockouts.find((b) => b.event === ev)).filter(Boolean);

  if (brackets.length === 0) {
    console.log("No knockout brackets found — nothing to generate.");
    return;
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, "Knockout Brackets.pdf");
  const doc = new PDFDocument({ size: "A3", layout: "portrait", margin: 0, autoFirstPage: false });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  brackets.forEach((bracket) => {
    doc.addPage({ size: "A3", layout: "portrait", margin: 0 });
    drawBracketPage(doc, tournament.name, bracket);
  });

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  console.log(`Built ${brackets.length} bracket page(s) — ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
