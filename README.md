# Life Utilities

A personal web app built for your phone, with three parts:

- **💛 People**: capture what friends tell you. The app sorts each thing into a category (food, place, dream vacation, long-held desire, gift idea…) and looks up details: a picture, the exact location on a map, places to try it. It also does bulk import of a big text dump, an at-a-glance overview of each person (what they're into, favourites, dreams, gift ideas, things to avoid, birthday, a photo mood board), duplicate detection, a randomized planner for birthdays, gifts, food and outings, an "Avoid" list for dislikes and allergies, and memories with photos.
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
- **Overview tab** (the first tab on a person): a short portrait built from what you've saved: what they're mostly into, favourites, dreams, open gift ideas, things to avoid, birthday and your last memory together. Below that are a photo mood board, interest bars (tap one to jump to that category in Likes) and recently added items. Tap any underlined item for details.
- **Duplicates**: when you save something that matches what you already have for that person, the review screen tells you ("Already saved" or "Looks similar to …"). Exact repeats start out skipped, and you can choose **Skip**, **Add to existing** (adds the new details to the old item) or **Save as new**. It also warns when something clashes with a dislike, e.g. "loves coriander chutney" when you'd saved "hates coriander". Matching runs on the phone (it ignores plurals, filler words and small typos), so it works without an AI key. Bulk import uses the same matching.
- **🍿 Watchlist** (People → Watchlist, the Home tile, or *Quick spin → 🍿 Watch*): movies and shows that you and the people you know want to watch. Tap ＋ and type a title: posters, year, genres and runtime come from TVmaze (shows) and the iTunes catalogue (movies), free and with no key needed. Mark who wants to watch it and where it's streaming. Anything people mention in your notes ("Meera wants to watch Past Lives") is added automatically.
  - **What should we watch?** Pick who's watching (and optionally movie/show or a mood) and tap **🎲 Suggest something**. It favours titles everyone there wants, notes who has already seen something, and avoids genres someone has said they dislike (e.g. horror). **✓ We watched it** records who watched it and a rating. A title stays on the list for anyone who hasn't seen it yet.
  - With an AI key, **✨ Fresh ideas** suggests new titles that suit the group.
- **Plan tab**: pick 🎂 Birthday, 🎁 Gift, 🍽️ Food, 🗺️ Go out or 🎲 Surprise, then tap **Shuffle**. You get three random picks from what you've saved. Things marked "✓ done/gifted" are skipped. **Fresh ideas from Claude** suggests new ideas based on the whole profile, optionally with live web search near your home city (set it in Settings).
- **Home → Quick spin**: pick a person (or 🎲 for a random one) and an occasion, all in one tap.
- **Houses**: tap ＋ during a viewing, use **📷 Camera** and **📍 I'm here now**, and fill in what you can. With **🖼️ Gallery** you first choose which photos to upload; ones you've already added are recognised and left out. Each photo appears straight away with its own progress, and a bar shows the overall progress. You can tap **Save house** while photos are still uploading: they keep going in the background (⬆️ in the top bar) and show up on the house as they finish. Tap any photo to open a full-screen viewer: swipe or use ← → to move between photos, and double-tap to zoom. Tap a checklist chip once for ✓, twice for ✕, three times to clear it. **📄 Summary report** gives a side-by-side table, photos, and a written report from Claude based on your priorities. Use **🖨️ Print** to save it as a PDF.
- **Move-in inspection**: on a house (prominent once it's 🔑 Finalised), tap **📋 Move-in inspection**.
  - **Set up:** choose how many of each room you have; it guesses from the configuration, e.g. 2BHK gives 2 bedrooms. Each room comes with a checklist of the usual fixtures: cabinet doors, hinges and handles, taps, door handles and locks, lights, fans, switches, wardrobe, floor, walls, geyser, WC and so on. There's also a **Meters & keys** room for meter readings and keys handed over.
  - **Checking a room:** go through each item and tap **Good / Fair / Damaged / Missing / N/A**. Tapping Fair or Damaged opens a note, a quantity and 📷 photos (photos upload in the background). **Mark the rest as Good** fills in everything you didn't flag. You can add, rename or remove items and rooms, and **Next →** walks you through the house.
  - **📄 Export report** comes in three formats, each shared as a PDF or image(s):
    - **Full report:** A4 pages with the date, who was present, totals, meter readings and keys, your overall notes, and a **Needs attention** list with photos. Then every room as a table with its photos, and signature lines for tenant and owner.
    - **One long page:** the same content as a single continuous page that's easy to scroll through on a phone.
    - **Summary:** one A4 page with no photos: totals and a colour bar, every room at a glance, what needs attention, meter readings and keys, notes, and signature lines.
- **Sharing a house**: on a house, tap **📤 Share**. You get a one-page summary with photos, price and key details, a small map with the house and your landmarks, distances, the checklist and pros/cons. Share it as an **image** (easiest to read in WhatsApp) or a **PDF** (with clickable Google Maps and listing links). Both come with a short text caption that includes the map link, and **💬 Copy text** gives just the text. Your private notes and the owner/broker contact are left out unless you tick them.
- **Owner / broker phone**: websites can't read your phone's call log, so instead:
  - copy the number from your call log and tap **📋 Paste**, which picks the number out of whatever you copied;
  - numbers from your other houses are suggested as you type, and choosing one fills in the name and role;
  - on Android Chrome, **📇 Contacts** opens your contact picker.
- **Setting a location** (houses and landmarks): **🗺️ Search / paste a link** opens a map with a pin. You can:
  - paste a **Google Maps link**, or the text you get from Google Maps → *Share*;
  - paste **coordinates** (`12.9784, 77.6408` or `12°58'42"N 77°38'27"E`) or a **plus code** (`WJ8R+9C Bengaluru`);
  - paste an Apple Maps or OpenStreetMap link;
  - type a place name and pick the right result from the list;
  - or just tap the map, drag the pin, or use **📍 I'm here**.

  Short `maps.app.goo.gl` links can't be opened from inside the app on their own. Paste the whole shared text, or the coordinates (in Google Maps, long-press the spot and tap the coordinates at the top to copy them).
- **Landmarks**: on **Houses → 🗺️ Map**, tap **＋ Landmark** and set the spot as above. Pick an icon (🏢 office, 🏫 school, 👪 family, 🚇 metro…) and a name. Landmarks show on the map with labels and sync like everything else. Each house then shows its distance to them: on the house cards, on the house page (with a **Route** link to Google Maps directions), in the map popups (and a landmark's popup lists the closest houses) and as columns in the summary report. The AI report also takes them into account. Distances are straight-line, not travel time. Tap a landmark to **Edit**, **Move** (then drag it) or delete it.
- **Docs**: tap ＋, **📷 Snap** or attach a PDF, check the form Claude filled in, and save.
- **Reimbursements**: Docs → **💸 Reimbursements** (also shown under *Heads up* on Home). Each claim has one-tap buttons for the next step: **Mark submitted** (with an optional reference number), then **Got paid** (enter the amount if it was less than you claimed) or **Rejected**. Filter by status or by who pays, and use **⬇ CSV** to export what's on screen.

## Good to know

- **App lock (passcode / Face ID)**: Settings → **🔒 App lock**. Set a passcode (4+ characters; digits-only gives you a number pad), and optionally unlock with Face ID or your fingerprint. Choose when it locks after you leave the app: immediately, or after 1, 5 or 15 minutes. After 5 wrong tries it makes you wait, and the wait gets longer each time. The lock applies **per device**, so turn it on separately on your phone and laptop. The passcode itself is never stored, only a salted hash. **Forgot it?** Tap *Forgot passcode?* on the lock screen to erase this device's copy of the app. Drive data is untouched; you just sign in again. In on-device mode this deletes your data, so export a backup first. This is a screen lock that keeps out someone who picks up your phone. It does not encrypt the data your browser keeps for offline use.

- **Google sign-in lasts about an hour.** This is a limit of browser-only Google sign-in. When it expires, the top bar shows "⚠️ Tap to reconnect Drive". You can keep working in the meantime: edits are cached on the phone and sync once you tap it.
- **Several devices**: each save checks whether another device has saved since, and if so merges the two record by record (the newest edit wins).
- **Deleting** a photo or file moves it to your Drive trash, so you can recover it for 30 days.
- **Try it without Drive**: the welcome screen has "Start on this device". You can move everything, photos included, to Drive later under Settings.
- **Backups**: Settings → **Export JSON**. Photos are already files in your Drive folder.
- **Models**: each provider has a "fast" model (sorting, lookups) and a "smart" one (bulk import, ideas, reports, bills). The defaults are `claude-haiku-5-5` / `claude-sonnet-5-5` for Claude and `gemini-flash-lite-latest` / `gemini-flash-latest` for Gemini. The `-latest` names automatically follow Google's newest Flash models. You can change any of them in Settings.
- **Costs**: sorting a note costs a fraction of a cent on Claude and is usually free on Gemini's free tier. Note that Google may use free-tier requests to improve its products; the paid tier doesn't.
- **Without an API key, or when the AI fails** (e.g. a Gemini free-tier quota error), everything still works. Sorting falls back to keyword rules, which still pick out short titles ("Korean corn dogs"), categories, birthdays ("her birthday is 3 Feb") and relations ("my colleague Arjun"), and follow "she/he/they" back to the last person named. *Look up details* falls back to free sources: a summary and picture from Wikipedia, a strip of openly licensed photos from Openverse / Wikimedia Commons (tap one to make it the picture), a map pin from OpenStreetMap for places, and search links (Google Maps near your home city, YouTube, Goodreads, shopping). The details sheet tells you when this happened and why.
- Pictures come from Wikipedia, Openverse and Wikimedia Commons, and coordinates come from OpenStreetMap (all free). The maps use OpenStreetMap too.

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
js/uploads.js         background photo upload queue
js/houseshare.js      one-page house summary (image / PDF) for sharing
js/inspectreport.js   move-in condition report (A4 pages → PDF / images)
js/geo.js             map links & coordinates, place search, pick-on-map
js/lock.js            app lock screen (passcode, Face ID / fingerprint, auto-lock)
js/views/*.js         home, people, capture/import, houses, docs, reimbursements, settings
```

## Run locally
```
python3 -m http.server 8000
```
Then open http://localhost:8000. Add `http://localhost:8000` to the OAuth origins if you want to use Drive locally.
