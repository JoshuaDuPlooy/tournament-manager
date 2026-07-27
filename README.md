# Ravens 2026 Juniors — Tournament Manager

A static tournament website (overview page) that reads from JSON files, plus
a local control panel for editing the tournament info.

## Structure

```
site/            Public static site — deploy this folder as-is to any static host
  index.html     Overview page (tournament details + division/team counts)
  css/style.css
  js/data.js       Fetches the JSON files
  data/
    tournament.json  Name, dates, divisions, points system
    teams.json       Teams (used for the division counts on the overview page)
    fixtures.json    Schedule + results data (not currently shown on the site)

admin/           Local control panel — do not deploy this folder
  server.js      Express server with a JSON API that reads/writes site/data/tournament.json
  public/        Admin UI (Tournament Info form)
```

Note: `teams.json` and `fixtures.json` still exist as data files but no
longer have an editing UI — edit them by hand, or ask for the Teams/Fixtures
admin tabs to be added back if you need that later.

## Editing tournament data

```
cd admin
npm install
npm start
```

Open http://localhost:4000 and edit the tournament info form. Saving writes
directly to `site/data/tournament.json`.

## Viewing the public site

The site is plain HTML/CSS/JS with no build step — just serve the `site/`
folder statically. For local preview:

```
cd site
npx serve .
```

(Opening `index.html` directly with `file://` won't work because `fetch()`
needs an HTTP server to load the JSON files.)

## Deploying

Deploy the contents of `site/` (including its `data/` folder) to any static
host — GitHub Pages, Netlify, Vercel static hosting, etc. After editing data
locally with the control panel, re-upload/re-deploy the `site/` folder to
publish the changes.
