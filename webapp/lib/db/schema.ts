import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

// Singleton row (id always 1) holding tournament info + branding.
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  name: text("name").notNull().default(""),
  season: text("season").notNull().default(""),
  venue: text("venue").notNull().default(""),
  startDate: text("start_date"),
  endDate: text("end_date"),
  entryFee: integer("entry_fee").notNull().default(0),
  pointsWin: integer("points_win").notNull().default(3),
  pointsDraw: integer("points_draw").notNull().default(1),
  pointsLoss: integer("points_loss").notNull().default(0),
  entriesVisible: boolean("entries_visible").notNull().default(true),
  groupsVisible: boolean("groups_visible").notNull().default(true),
  scheduleVisible: boolean("schedule_visible").notNull().default(true),
  events: text("events").array().notNull().default([]),
  // Branding
  siteName: text("site_name"),
  logoUrl: text("logo_url"),
  themeColor: text("theme_color").notNull().default("#1d4ed8"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Per-event knockouts visibility toggle (tournament.json's knockoutsVisible map).
export const eventVisibility = pgTable("event_visibility", {
  event: text("event").primaryKey(),
  knockoutsVisible: boolean("knockouts_visible").notNull().default(true),
});

export const entries = pgTable("entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  club: text("club").notNull().default(""),
  events: text("events").array().notNull().default([]),
  paid: boolean("paid").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Kept for parity with the current data file; low usage today.
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  division: text("division").notNull().default(""),
  coach: text("coach").notNull().default(""),
  contact: text("contact").notNull().default(""),
});

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  event: text("event").notNull(),
  groupNumber: text("group_number").notNull(),
  // { seed, seedClub, name2, club2, name3, club3, name4, club4 }
  players: jsonb("players").notNull().default({}),
  day: text("day").notNull().default(""),
  date: text("date").notNull().default(""),
  time: text("time").notNull().default(""),
  table: text("table").notNull().default(""),
  // pairwise scores keyed "A-B" -> { a, b }
  matches: jsonb("matches").notNull().default({}),
});

export const knockouts = pgTable("knockouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  event: text("event").notNull(),
  size: integer("size").notNull(),
  round1Slots: jsonb("round1_slots").notNull().default([]),
  scores: jsonb("scores").notNull().default({}),
});

// Singleton row (id always 1) holding the schedule grid.
export const schedule = pgTable("schedule", {
  id: integer("id").primaryKey().default(1),
  tables: text("tables").array().notNull().default([]),
  rows: jsonb("rows").notNull().default([]),
});

export const rankings = pgTable("rankings", {
  id: uuid("id").primaryKey().defaultRandom(),
  event: text("event").notNull(),
  rank: integer("rank").notNull(),
  name: text("name").notNull(),
});
