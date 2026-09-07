# Ravens Tournament Manager

Runs more than one tournament from a single repo. Each tournament is a self-contained
folder holding its own control panel, public site and data. The `admin/` and `site/`
code is identical across tournaments — only `tournament.config.json` and
`site/data/*.json` differ — so adding a tournament is a copy-and-edit, not a rewrite.

## Structure

```
Ravens 2026 Junior Championships/
  tournament.config.json   Identity + ports for this tournament
  site/                    Public static site - deployed to /junior/
    index.html             Overview (details + entry counts per event)
    entries.html           Entry list
    groups.html            Group draws + results
    knockouts.html         Knockout brackets
    schedule.html          Table-by-table schedule
    css/style.css
    js/data.js             Fetches the JSON files
    data/                  tournament / entries / groups / knockouts / schedule / teams / fixtures
  admin/                   Local control panel - never deployed
    server.js              Express JSON API reading/writing ../site/data/*.json
    public/                Admin UI (Tournament Info, Entries, Groups, Knockouts, Schedule)
    scripts/               Scorecard / bracket / schedule PDF generators
    *.xlsx                 Templates and import sources

Savets 2026/               Same layout, own config and own (empty) data
  tournament.config.json
  site/
  admin/

landing/                   Pages root - links to each published tournament
.github/workflows/         Assembles and deploys the public sites
start-servers.bat          Menu: start Junior, Savets, or both
```

## tournament.config.json

```json
{
  "id": "junior",
  "name": "Ravens 2026 Junior Championships",
  "shortName": "Junior",
  "adminPort": 4000,
  "sitePort": 3000,
  "publicPath": "junior"
}
```

`adminPort` is what `admin/server.js` listens on, so the two control panels can run at
the same time without clashing. `name` is shown in the control panel header and browser
tab. `publicPath` is the folder the site is published under on GitHub Pages.

Note the public site takes its own heading and tab title from
`site/data/tournament.json` (edited in the control panel), not from this file.

## Running locally

Double-click `start-servers.bat` and pick a tournament, or do it by hand:

```
cd "Ravens 2026 Junior Championships/admin"
npm install
npm start
```

| Tournament | Control panel | Site preview |
| --- | --- | --- |
| Ravens 2026 Junior Championships | http://localhost:4000 | http://localhost:3000 |
| Savets 2026 | http://localhost:4001 | http://localhost:3001 |

`npm install` is per tournament — each `admin/` has its own `node_modules`.

For the site preview:

```
cd "Ravens 2026 Junior Championships/site"
npx serve . -l 3000
```

(Opening `index.html` over `file://` won't work — `fetch()` needs an HTTP server to
load the JSON files.)

## Published URLs

`.github/workflows/deploy-pages.yml` assembles a `_site/` on every push to `main`:

| Path | Source |
| --- | --- |
| `/` | `landing/` |
| `/ravens-junior/` | `Ravens 2026 Junior Championships/site/` |
| `/savets-2026/` | `Savets 2026/site/` |

Paths come from each tournament's `publicPath`, so the config is the single source
of truth; the workflow reads it rather than hardcoding the path.

The Junior site used to sit at the Pages root; it now lives under `/ravens-junior/`,
and the root is a landing page linking to both tournaments. Links saved against the
old root URLs need updating.

## Adding another tournament

1. Copy an existing tournament folder and rename it.
2. Edit its `tournament.config.json` — new `id`, `name`, `shortName`, an unused
   `adminPort`/`sitePort`, and a `publicPath`.
3. Blank its `site/data/` files: `[]` for entries/groups/knockouts/teams/fixtures,
   `{"tables": [], "rows": []}` for schedule, and set the name/season/events in
   `tournament.json` (or do that in the control panel).
4. Add its folder to the `TOURNAMENTS` list in the deploy workflow, and add it to
   `start-servers.bat` and `landing/index.html`.

## Working spreadsheets

Some admin features read a fixed workbook from that tournament's `admin/` folder:

| File | Used by |
| --- | --- |
| `Groups.xlsx` | Groups tab - import a group draw (one sheet per event) |
| `Rankings.xlsx` | Rankings lookup - sheet named "All Rankings" |
| `Schedule.xlsx` | Schedule tab - import the table/time grid |

These are per tournament and gitignored — drop your own copies into the relevant
`admin/` folder. Generated PDFs land in that tournament's `admin/output/`.
