# NotionPress

Export a Notion page and all its sub-pages as HTML or Markdown and commit them to a GitHub repository. Users sign in with Notion, install a GitHub App on the repositories they choose, pick a page, and sync by hand, hourly or daily.

**Runs with no server of your own, for free:**

| Part | Where it runs | Why |
|---|---|---|
| Website + API (sign-in, dashboard) | **Vercel** (free Hobby plan) | Serverless, HTTPS and domain included |
| Database (tokens, settings) | **Neon** or **Supabase** (free Postgres) | Vercel functions have no disk |
| The sync itself + hourly/daily schedule | **GitHub Actions** in your copy of this repo (free for public repos) | Vercel's free plan limits functions to 5 minutes and cron to once a day. Actions runs up to 6 hours and every 10 minutes |

Node.js 20.12+ (22 recommended), one dependency (`pg`), MIT license.

> **Status:** first version. The 23 unit tests pass (renderer, sync engine, atomic commit, encryption, sessions, App JWT) and the API router was smoke-tested, but it has **not been run against the live Notion and GitHub APIs**. Do the "First test" below before sharing it.

## How it works

1. **Sign in with Notion** (public integration, OAuth). The user shares only the pages they want.
2. **Install the GitHub App** on chosen repositories. Ownership of the installation is verified with GitHub's OAuth step.
3. **Create a sync:** Notion page, repository, branch, folder, schedule. "Sync now" and new syncs are marked *queued*.
4. The **GitHub Actions workflow** runs every 10 minutes (or right away, see `DISPATCH_TOKEN`). It reads each queued or due config, converts the page tree to HTML, downloads Notion-hosted images and files (their links expire after about an hour), and commits **only changed files in one commit**. Removed or renamed pages are removed from the folder. Only files inside the chosen folder are touched.

People only need GitHub access afterwards, which is the original goal: networks that block Notion sign-in still work.

## Run locally and preview

Needs Node 22 (20.12+ works). Commands run from the project folder after `npm install`. A `.env` file in the project root is loaded automatically (copy `.env.example` to `.env`).

### A. See the exported HTML in 1 minute (no accounts, no database)

```bash
npm install
npm run preview
```

Open `preview/index.html` in your browser. It renders a built-in sample page tree: headings, lists, code, a table, a toggle, a downloaded image, and sub-pages with breadcrumbs.

### B. Preview one of your real Notion pages (no GitHub, no database)

1. At https://www.notion.so/profile/integrations create a **separate internal** integration for testing and copy its secret.
2. In Notion, open the page, then "..." > Connections > add that integration.
3. Put these two lines in `.env` (the page URL or ID both work):

```
NOTION_TOKEN=your-internal-integration-secret
NOTION_PAGE=https://www.notion.so/Your-Page-0123456789abcdef0123456789abcdef
```

4. `npm run preview`, then open `preview/index.html`. This tests the Notion reading and the HTML conversion on your real content.

### C. Run the whole app on your computer

1. **Database.** Either Docker: `docker run --name syncdb -e POSTGRES_PASSWORD=dev -p 5432:5432 -d postgres:16` with `DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres`, or a free Neon/Supabase connection string. Then `npm run migrate`.
2. **Separate dev integrations** so you do not touch the production ones:
   - Notion public integration, redirect URI `http://localhost:3000/api/auth/notion/callback`. Use `localhost`, not `127.0.0.1`. Notion allows plain `http` only for localhost.
   - GitHub App with Callback URL and Setup URL `http://localhost:3000/api/github/callback`, otherwise the same settings as step 4 of Setup.
3. **`.env`:** set `APP_URL=http://localhost:3000`, the two generated secrets, the Notion and GitHub values. For the private key on one line: `awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' your-key.pem` and paste the output as `GITHUB_APP_PRIVATE_KEY`.
4. `npm run dev` and open http://localhost:3000.
5. Create a sync (it is marked *queued*), then run the worker by hand instead of waiting for GitHub Actions: `npm run sync`. Refresh the dashboard to see the result and check the repository for the commit.

## Setup (all free)

### 1. Put the code on GitHub (public)

Create a **public** repository, for example `repo-sync-for-notion`, and push this folder. Public matters: GitHub Actions minutes are free for public repositories only.

### 2. Free Postgres

Create a database on [Neon](https://neon.tech) or [Supabase](https://supabase.com) and copy the connection string (`postgres://...`). Then create the tables, either way:

```bash
npm install
DATABASE_URL="postgres://..." npm run migrate
```

or paste `schema.sql` into the database's SQL editor.

### 3. Notion public integration

1. https://www.notion.so/profile/integrations, new integration.
2. Type **Public**, installation scope **Any workspace** (cannot be changed later; required for the Marketplace).
3. Capabilities: **Read content** only.
4. Redirect URI: `https://notionpress-np.vercel.app/api/auth/notion/callback`.
5. Keep the OAuth client ID and secret for step 6.

### 4. GitHub App

GitHub: Settings > Developer settings > GitHub Apps > New GitHub App.

- **Homepage URL:** your Vercel URL.
- **Callback URL** and **Setup URL:** `https://notionpress-np.vercel.app/api/github/callback`
- Turn on **Request user authorization (OAuth) during installation** and **Redirect on update**.
- **Webhook:** turn Active off.
- **Repository permissions:** Contents = Read and write. Metadata = Read-only (automatic). Nothing else.
- **Where can this app be installed:** Any account.
- After creating: note the **App ID** and **slug** (the name in the app's URL), generate a **client secret** and a **private key** (.pem).

### 5. Generate two secrets

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # TOKEN_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # SESSION_SECRET
```

Back up `TOKEN_ENCRYPTION_KEY`. Without it, stored Notion tokens cannot be decrypted.

### 6. Deploy to Vercel

1. Import the GitHub repository at vercel.com (Framework preset: **Other**).
2. Add the environment variables from `.env.example` (web app section). `APP_URL` is your final Vercel URL.
3. Deploy. If the URL changes (custom domain), update `APP_URL` and the callback URLs in Notion and GitHub.

### 7. GitHub Actions secrets

In your repository: Settings > Secrets and variables > Actions > New repository secret:

| Secret | Value |
|---|---|
| `DATABASE_URL` | same as Vercel |
| `TOKEN_ENCRYPTION_KEY` | same as Vercel |
| `GH_APP_ID` | the GitHub App ID |
| `GH_APP_PRIVATE_KEY` | contents of the .pem file |

(GitHub does not allow secret names starting with `GITHUB_`, hence `GH_`.)

Open the **Actions** tab and enable workflows if GitHub asks. The workflow `Run syncs` then runs every 10 minutes. You can also run it by hand with "Run workflow".

### 8. Optional: instant syncs

Without this, "Sync now" waits for the next scheduled run (usually within about 10 to 15 minutes; GitHub can delay scheduled runs). To start the workflow immediately, create a fine-grained personal access token with **Actions: Read and write** on this repository only, and set on Vercel: `DISPATCH_TOKEN`, `DISPATCH_REPO` (`owner/repo`), `DISPATCH_REF` (`main`). A daily Vercel cron also calls this as a safety net; set `CRON_SECRET` for it.

## First test

1. Make a small Notion page tree: headings, a list, a code block, a table, an image, a sub-page, a sub-page inside that.
2. Make a **private** test repository with a README so the `main` branch exists.
3. Sign in, connect GitHub, create a sync with folder `notion-docs`, then press Run workflow in the Actions tab (or wait).
4. Open `notion-docs/index.html` in the repository. Edit one Notion page, sync again: the commit should contain only that page.

Run the tests any time with `npm test`. For local development use `npx vercel dev` with a `.env` file.

## Publishing on the Notion Marketplace

- Installation scope **Any workspace** (step 3).
- Fill in the listing in the Notion developer dashboard: name, description, screenshots, support contact, privacy policy URL (`/privacy`), terms URL (`/terms`). The two legal pages are **templates**: have them reviewed, and point support questions at https://vetrisuriya.in/contact/.
- Check Notion's brand guidelines for the integration name.
- Submit the listing for review. Notion may ask for changes before approval. Public connections also go through a security review.
- Vercel's Hobby plan is for **non-commercial** use. A free open-source tool is likely fine, but read the current terms. If you ever charge or run ads, move to a paid plan or another host (Cloudflare, Netlify, Render).

## What is supported

Paragraphs, headings, bulleted/numbered/to-do lists (nested), quotes, callouts, toggles, code, dividers, images, files and PDFs (downloaded), bookmarks and embeds (as links), tables, columns, equations, synced blocks, sub-pages with breadcrumbs, links between exported pages.

Two export formats: **HTML** (a styled, browsable site) and **Markdown** (`index.md` per page, for docs folders and wikis). Choose on the "New sync" page; only files inside the chosen folder are touched.

Not yet: databases (a note is shown), page covers, text colors, user/date mentions (shown as plain text), comments. Page titles in non-Latin scripts (for example Tamil) get a short ID-based folder name such as `page-1a2b3c`.

## Known limits

- Every run re-reads the Notion tree. Incremental sync saves commits and downloads, not Notion reads. Notion allows about 3 requests per second, so large trees take a while. Default cap: 500 pages per sync (`NOTIONSYNC_MAX_PAGES`).
- The target branch must already exist (a new empty repo needs one commit first).
- **GitHub pauses scheduled workflows after 60 days without repository activity.** Commit something now and then, or keep `DISPATCH_TOKEN` set so the daily Vercel cron can start the workflow. Check the Actions tab if syncs stop.
- Sessions are signed cookies (30 days). There is no server-side logout of other devices.

## Security notes

- Notion tokens are encrypted with AES-256-GCM before they reach the database.
- No email addresses and no page content are stored after a sync. Only a hash per page and file.
- Public repositories need an explicit confirmation.
- Every record is checked against the signed-in user. State-changing requests need a custom header and a same-site cookie. The dashboard builds its pages with text nodes only, and a strict Content-Security-Policy is set in `vercel.json`.
- Notion-hosted SVG files are copied as-is. Consider skipping SVG if you serve the output on GitHub Pages for untrusted users.

## Ideas for next

Notion database export, sidebar navigation, GitHub Pages hint, tests with recorded Notion/GitHub responses, per-page incremental reads.
