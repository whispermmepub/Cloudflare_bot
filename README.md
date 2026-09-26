# Bookfilderwow Bot — Cloudflare

Telegram bot: @Bookfilderwow_bot

Separate Cloudflare Worker version. Railway Group Guardian remains untouched.

Core: Telegram webhook, D1 persistence, /start, /help, /search, /find, /authors, /stats, /sync, admin /add, and wow-books catalog sync.

Setup:
1. wrangler login
2. npx wrangler d1 create bookfilderwow-db
3. Put the returned database_id in wrangler.toml
4. npx wrangler d1 execute bookfilderwow-db --remote --file=schema.sql
5. npx wrangler secret put TELEGRAM_BOT_TOKEN
6. npx wrangler secret put TELEGRAM_SECRET_TOKEN
7. npx wrangler secret put GITHUB_TOKEN
8. Set ADMIN_IDS to the Telegram numeric admin ID(s)
9. npx wrangler deploy
10. Set Telegram webhook to https://YOUR-WORKER/telegram/webhook

Heavy Python/Calibre/OCR features are intentionally not copied blindly; they need separate Worker-compatible ports.