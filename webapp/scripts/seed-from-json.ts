// One-off script: imports the current site/data/*.json files into Postgres.
// Safe to re-run — it clears each table before inserting.
//
// Usage: npm run db:seed   (requires DATABASE_URL in .env.local)

import { config as loadEnv } from "dotenv";
import { readFile } from "fs/promises";
import path from "path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../lib/db/schema";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const DATA_DIR = path.join(__dirname, "..", "..", "site", "data");

async function loadJSON<T>(file: string): Promise<T> {
  const raw = await readFile(path.join(DATA_DIR, file), "utf-8");
  return JSON.parse(raw);
}

type TournamentJSON = {
  name: string;
  season: string;
  events: string[];
  startDate: string;
  endDate: string;
  venue: string;
  entryFee: number;
  entriesVisible: boolean;
  groupsVisible: boolean;
  scheduleVisible: boolean;
  knockoutsVisible: Record<string, boolean>;
  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
};

type TeamJSON = {
  id: string;
  name: string;
  division: string;
  coach: string;
  contact: string;
};

type EntryJSON = {
  id: string;
  name: string;
  club: string;
  events: string[];
  paid: boolean;
};

type GroupJSON = {
  id: string;
  event: string;
  group: string;
  seed: string;
  seedClub: string;
  name2: string;
  club2: string;
  name3: string;
  club3: string;
  name4: string;
  club4: string;
  day: string;
  date: string;
  time: string;
  table: string;
  matches: Record<string, { a: string; b: string }>;
};

type KnockoutJSON = {
  id: string;
  event: string;
  size: number;
  round1Slots: Array<{ match: number; p1: string; p2: string }>;
  scores: Record<string, { a: string; b: string }>;
};

type ScheduleJSON = {
  tables: string[];
  rows: Array<{ time: string; cells: Record<string, string> }>;
};

async function main() {
  const client = postgres(process.env.DATABASE_URL!, { prepare: false });
  const db = drizzle(client, { schema });

  const [tournament, teamsData, entriesData, groupsData, knockoutsData, scheduleData] =
    await Promise.all([
      loadJSON<TournamentJSON>("tournament.json"),
      loadJSON<TeamJSON[]>("teams.json"),
      loadJSON<EntryJSON[]>("entries.json"),
      loadJSON<GroupJSON[]>("groups.json"),
      loadJSON<KnockoutJSON[]>("knockouts.json"),
      loadJSON<ScheduleJSON>("schedule.json"),
    ]);

  console.log("Seeding settings...");
  await db.delete(schema.settings);
  await db.insert(schema.settings).values({
    id: 1,
    name: tournament.name,
    season: tournament.season,
    venue: tournament.venue,
    startDate: tournament.startDate,
    endDate: tournament.endDate,
    entryFee: tournament.entryFee,
    pointsWin: tournament.pointsWin,
    pointsDraw: tournament.pointsDraw,
    pointsLoss: tournament.pointsLoss,
    entriesVisible: tournament.entriesVisible,
    groupsVisible: tournament.groupsVisible,
    scheduleVisible: tournament.scheduleVisible,
    events: tournament.events,
    siteName: tournament.name,
    themeColor: "#1d4ed8",
  });

  console.log("Seeding event visibility...");
  await db.delete(schema.eventVisibility);
  const visRows = Object.entries(tournament.knockoutsVisible ?? {}).map(
    ([event, knockoutsVisible]) => ({ event, knockoutsVisible })
  );
  if (visRows.length) await db.insert(schema.eventVisibility).values(visRows);

  console.log(`Seeding ${teamsData.length} teams...`);
  await db.delete(schema.teams);
  if (teamsData.length) {
    await db.insert(schema.teams).values(
      teamsData.map((t) => ({
        id: t.id,
        name: t.name,
        division: t.division,
        coach: t.coach,
        contact: t.contact,
      }))
    );
  }

  console.log(`Seeding ${entriesData.length} entries...`);
  await db.delete(schema.entries);
  if (entriesData.length) {
    await db.insert(schema.entries).values(
      entriesData.map((e) => ({
        id: e.id,
        name: e.name,
        club: e.club,
        events: e.events,
        paid: e.paid,
      }))
    );
  }

  console.log(`Seeding ${groupsData.length} groups...`);
  await db.delete(schema.groups);
  if (groupsData.length) {
    await db.insert(schema.groups).values(
      groupsData.map((g) => ({
        id: g.id,
        event: g.event,
        groupNumber: g.group,
        players: {
          seed: g.seed,
          seedClub: g.seedClub,
          name2: g.name2,
          club2: g.club2,
          name3: g.name3,
          club3: g.club3,
          name4: g.name4,
          club4: g.club4,
        },
        day: g.day,
        date: g.date,
        time: g.time,
        table: g.table,
        matches: g.matches,
      }))
    );
  }

  console.log(`Seeding ${knockoutsData.length} knockouts...`);
  await db.delete(schema.knockouts);
  if (knockoutsData.length) {
    await db.insert(schema.knockouts).values(
      knockoutsData.map((k) => ({
        id: k.id,
        event: k.event,
        size: k.size,
        round1Slots: k.round1Slots,
        scores: k.scores,
      }))
    );
  }

  console.log("Seeding schedule...");
  await db.delete(schema.schedule);
  await db.insert(schema.schedule).values({
    id: 1,
    tables: scheduleData.tables,
    rows: scheduleData.rows,
  });

  console.log("Done.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
