# Life Utilities

A personal web app built for your phone, with three parts:

- **💛 People**: capture what friends tell you. The app sorts each thing into a category (food, place, dream vacation, long-held desire, gift idea…) and looks up details: a picture, the exact location on a map, places to try it. It also does bulk import of a big text dump, an interest graph for each person, a randomized planner for birthdays, gifts, food and outings, an "Avoid" list for dislikes and allergies, and memories with photos.
- **🔑 Houses**: log each viewing with camera photos, GPS location, price, size, a checklist, pros and cons, and a rating. You get a map of everything you've seen and a summary report that compares the houses (written by Claude, printable as a PDF).
- **🧾 Docs**: snap a bill, invoice, warranty card or prescription, and Claude reads it and fills in the form (amount, vendor, warranty end date, medicines and dosage). The list is searchable, and the app warns you when a warranty is about to run out.
  - **💸 Reimbursements**: tick *"I need to claim this back"* on any bill (or tap 💸 Reimbursements → ＋) to track purchases you'll get paid back for: who pays (employer, insurance, a friend), the claim deadline, and the status (⏳ To claim → 📨 Submitted → ✅ Received / Rejected). You see totals still to claim and awaiting payment, get reminders before the deadline, and can download a CSV for your expense report.

**Hosting:** the app is static files on GitHub Pages, with no build step and no server.
**Storage:** your data lives in a folder called `LifeUtilities` in **your own Google Drive**. It holds `db.json` with all the records, plus a `media/` folder for photos and files.
**AI:** your choice of **Claude** or **Gemini**, called directly from your browser with your own API key.

---

## Setup (about 15 minutes, one time)

### 1. Put it on GitHub Pages
1. Create a new GitHub repository, for example `life-utilities`. A private repo works if your plan supports Pages for private repos; otherwise make it public. There are no secrets in the code.
2. Upload every file in this folder to the repo root (`index.html`, `css/`, `js/`, `icons/`, `manifest.webmanifest`).
3. Go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then `main` and `/ (root)`, and save.
4. After a minute your app is at `https://<your-username>.github.io/life-utilities/`.

### 2. Let it use Google Drive (OAuth client ID)
1. Go to https://console.cloud.google.com/ and create a project (for example "Life Utilities").
2. Open **APIs & Services → Library**, search for **Google Drive API** and click **Enable**.
3. Open **APIs & Services → OAuth consent screen** (also called "Google Auth Platform"):
   - User type: **External**. Fill in an app name and your email.
   - Scopes: add `.../auth/drive.file`. This scope only lets the app see files the app created itself, not the rest of your Drive.
   - Under **Test users** (Audience), add your own Google account. You can leave the app in "Testing" mode. Nobody else needs access.
4. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://<your-username>.github.io` (no path, no trailing slash). Also add `http://localhost:8000` if you want to run it locally.
   - You don't need any redirect URIs.
5. Copy the client ID (it ends in `.apps.googleusercontent.com`) into `js/config.js`:
   ```js
   googleClientId: '1234-abc.apps.googleusercontent.com',
   ```
   Commit that change. A client ID is not a secret, and putting it here means every device picks it up automatically.

### 3. Turn on the AI features (Claude or Gemini)
Pick either provider (you can switch any time):
- **Gemini:** create a key at https://aistudio.google.com/apikey. Google AI Studio has a free tier, which is plenty for personal use.
- **Claude:** create a key at https://console.anthropic.com/settings/keys and add some credit.

Then open **⚙️ Settings → AI assistant**, tap **Claude** or **Gemini**, paste the key, and tap **Test**. Optionally tick **Sync keys to my other devices**. Your keys are then saved inside your private Drive folder, so your laptop and phone both get them after you sign in.

**Never put an API key in `config.js`.** That file is public on GitHub Pages.

Both providers do the same jobs: sorting notes, web lookups (Claude uses its web search tool, Gemini uses Google Search), ideas, house reports, and reading photos and PDFs of bills.

### 4. Add it to your phone's home screen
Open the URL on your phone. On iPhone, tap Safari's **Share** button and choose **Add to Home Screen**. On Android, open Chrome's **⋮** menu and choose **Add to Home screen**. It then opens full-screen like a normal app.

---

## Using it

- **Big ＋ button**: type or dictate (🎤) something like *"Meera's been obsessed with Korean corn dogs, and she said she'd love to do a pottery class someday. Her birthday is 3 Feb."* Tap **Sort it out**, check the cards, and save. Items marked "look up details" get pictures, maps and suggestions in the background (🔎 shows in the top bar while that runs).
- **Bulk import**: tap ＋ → **Paste a big dump**, or load a `.txt` file. The app splits it into batches, sorts every line, groups the results by person, and marks likely duplicates. You review everything before it's saved. A copy of the raw text is kept in `media/`.
- **Plan tab**: pick 🎂 Birthday, 🎁 Gift, 🍽️ Food, 🗺️ Go out or 🎲 Surprise, then tap **Shuffle**. You get three random picks from what you've saved. Things marked "✓ done/gifted" are skipped. **Fresh ideas from Claude** suggests new ideas based on the whole profile, optionally with live web search near your home city (set it in Settings).
- **Home → Quick spin**: pick a person (or 🎲 for a random one) and an occasion, all in one tap.
- **Houses**: tap ＋ during a viewing, use **📷 Camera** and **📍 I'm here now**, and fill in what you can. Tap a checklist chip once for ✓, twice for ✕, three times to clear it. **📄 Summary report** gives a side-by-side table, photos, and a written report from Claude based on your priorities. Use **🖨️ Print** to save it as a PDF.
- **Docs**: tap ＋, **📷 Snap** or attach a PDF, check the form Claude filled in, and save.
- **Reimbursements**: Docs → **💸 Reimbursements** (also shown under *Heads up* on Home). Each claim has one-tap buttons for the next step: **Mark submitted** (with an optional reference number), then **Got paid** (enter the amount if it was less than you claimed) or **Rejected**. Filter by status or by who pays, and use **⬇ CSV** to export what's on screen.

## Good to know

- **Google sign-in lasts about an hour.** This is a limit of browser-only Google sign-in. When it expires, the top bar shows "⚠️ Tap to reconnect Drive". You can keep working in the meantime: edits are cached on the phone and sync once you tap it.
- **Several devices**: each save checks whether another device has saved since, and if so merges the two record by record (the newest edit wins).
- **Deleting** a photo or file moves it to your Drive trash, so you can recover it for 30 days.
- **Try it without Drive**: the welcome screen has "Start on this device". You can move everything, photos included, to Drive later under Settings.
- **Backups**: Settings → **Export JSON**. Photos are already files in your Drive folder.
- **Models**: each provider has a "fast" model (sorting, lookups) and a "smart" one (bulk import, ideas, reports, bills). The defaults are `claude-haiku-5-5` / `claude-sonnet-5-5` for Claude and `gemini-flash-lite-latest` / `gemini-flash-latest` for Gemini. The `-latest` names automatically follow Google's newest Flash models. You can change any of them in Settings.
- **Costs**: sorting a note costs a fraction of a cent on Claude and is usually free on Gemini's free tier. Note that Google may use free-tier requests to improve its products; the paid tier doesn't.
- **Without an API key**, everything still works except the AI parts. Sorting falls back to simple keyword rules, and pictures come from Wikipedia.
- Pictures come from Wikipedia and coordinates come from OpenStreetMap (both free). The maps use OpenStreetMap too.

## Files

```
index.html            app shell
css/app.css           styles (light + dark mode, print styles for reports)
js/config.js          ← your Google client ID goes here
js/main.js            routing, boot, sync status
js/state.js           data, settings, autosave
js/storage.js         Google Drive + on-device backends, merging
js/ai.js              Claude/Gemini calls and prompts, Wikipedia + OpenStreetMap lookups
js/enrich.js          background lookup queue
js/connect.js         sign-in, moving data to Drive
js/views/*.js         home, people, capture/import, houses, docs, reimbursements, settings
```

## Run locally
```
python3 -m http.server 8000
```
Then open http://localhost:8000. Add `http://localhost:8000` to the OAuth origins if you want to use Drive locally.
