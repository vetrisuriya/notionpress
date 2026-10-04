# NotionPress

Turn any Notion page into a lightweight website or a Markdown documentation folder — and keep it continuously in sync with a GitHub repository, automatically.

🔗 **Live:** [notionpress-np.vercel.app](https://notionpress-np.vercel.app/)

## Why NotionPress

- **No servers to manage.** Sign in, choose a page and a repository, and NotionPress does the rest.
- **Only changes are committed.** NotionPress tracks each page with a fingerprint, so every sync writes one commit containing only the pages that actually changed.
- **Self-contained exports.** Notion-hosted images and files (whose links expire) are downloaded into your repository, so your site works for people on networks that block Notion.
- **Free by default.** Hosting, database, and the sync scheduler run entirely on free tiers — forever.

## How it works

1. **Sign in with Notion.** You share only the pages you want — NotionPress gets read-only access to exactly those.
2. **Connect GitHub.** Install the NotionPress GitHub App on the repositories you choose. Ownership of each installation is verified during setup.
3. **Create a sync.** Pick the Notion page, the destination repository, branch, folder, schedule (manual, hourly, or daily), and the export format.
4. **It syncs itself.** Every run, NotionPress re-reads the page tree, re-renders every page, diffs against the last run, and commits the result in a single commit. Renamed pages move, removed pages are deleted, and only files inside your chosen folder are ever touched.

## What can be exported

Paragraphs, headings, nested bulleted/numbered/to-do lists, quotes, callouts, toggles, code blocks, dividers, tables, columns, equations, synced blocks, images, files and PDFs, bookmarks and embeds, and sub-pages with breadcrumbs. Links between exported pages become relative links automatically.

Two export formats:

- **HTML** — a clean, styled, browsable site (drop the folder into GitHub Pages for a public site).
- **Markdown** — `index.md` per page, ideal for docs folders and wikis.

Not yet supported: databases (a note is shown in the export), page covers, text colors, user/date mentions (shown as plain text), and comments.

## Security & privacy

- Notion access tokens are encrypted with AES-256-GCM before they ever touch the database.
- No email addresses and no page content are stored — only a short fingerprint per exported page and file.
- Every request checks you can only see and modify your own data, and public repositories require an explicit confirmation.
- Strict Content-Security-Policy and security headers are set on every response.
- You can delete your account and every associated record at any time from the dashboard ("Delete everything").

## Known limits

- Large page trees can take a few minutes because Notion rate-limits reads to about 3 requests per second. Exports are capped at 500 pages per sync by default.
- The target branch must already exist (a brand-new empty repository needs one commit first, e.g. a README).
- GitHub pauses scheduled workflows after 60 days without repository activity, so commits happen automatically on most active repos.

## Support

Questions and issues: [vetrisuriya.in/contact](https://vetrisuriya.in/contact/).
Legal: [Privacy](/privacy) · [Terms](/terms) · MIT license.
