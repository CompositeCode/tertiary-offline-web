# Offline Web — User Guide

**Audience:** anyone who wants to save web pages and sites to read offline. No
technical background needed.

**What this covers:** installing and running the app, signing in, making your
first mirror, whole-site and advanced options, watching a job, reading your
results, and troubleshooting.

> **Please read this too:** [Acceptable Use & Your Responsibilities](acceptable-use.md).
> Offline Web is built to be a polite web citizen by default, but
> **you** are responsible for mirroring only content you're allowed to copy.

Items marked **Planned** are designed and on the roadmap but **not in the app
yet**. Everything else is shipped behavior you can use today.

---

## 1. Getting started

### What the app is

Offline Web is a free desktop app for macOS, Windows, and Linux that
saves a **local copy** of a web page — or an entire website — to a folder on your
computer so you can read it offline. Think of it as a smarter "Save Page As" that
also grabs the images, styles, and linked pages you'd want to keep together, and
rewrites the links so everything opens from your own disk with no internet.

- **Free — no subscription.** There are no paid tiers and no usage meter.
- **Login required.** The app requires you to sign in with a free
  **InterlinedList** account (interlinedlist.com). Signing in is a simple access
  gate — once you're in, every feature is unlocked. Scraping is unavailable while
  you're signed out.
- **Honest static snapshots.** What you get is a *static* copy. Some dynamic
  features — logins, live feeds, search boxes, streaming — won't work offline.
  The app tells you this clearly and shows you exactly what it captured.

### Installing and running it

> **Right now, you run the app from source.** Ready-to-install downloads
> (a `.dmg` for macOS, an installer for Windows, and a Linux package) are
> **Planned** for a later release. Until then, follow the steps below once.

**You'll need:**

- **Node.js** (which includes `npm`).
- The **Rust toolchain** (install via [rustup](https://rustup.rs)).
- Your platform's build tools for the desktop shell:

| Platform | What to install |
|----------|-----------------|
| **macOS** | Xcode Command Line Tools (`xcode-select --install`) |
| **Linux** | `webkit2gtk`, `libssl`, and `build-essential` (package names vary by distro) |
| **Windows** | Microsoft Visual C++ build tools (MSVC) and the WebView2 runtime |

**Steps:**

1. Download or clone the project to a folder on your computer.
2. Open a terminal in that folder.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Launch the desktop app:
   ```bash
   npm run tauri dev
   ```

The app window opens with the InterlinedList sign-in screen. The first launch
takes a little longer while it compiles; later launches are faster.

> **Browser preview vs. the desktop app.** There is also a browser-only preview
> (`npm run dev`, served at `http://localhost:1420`) that lets you click through
> the screens. **Signing in and scraping only work in the desktop app** — the
> preview can't reach your keychain or fetch pages, so its Start button is
> disabled with a note. Always use `npm run tauri dev` to actually capture pages.

---

## 2. Signing in

Offline Web unlocks its features once you sign in with your free
InterlinedList account.

### Sign in

1. On launch you'll see the **Offline Web** sign-in card:
   *"Offline Web is free, but requires an InterlinedList account."*
2. Enter your account **Email**.
3. Enter your **Password**. Use the **show / hide** toggle next to the field if
   you want to check what you typed.
4. Click **Sign in**.

Your email and password are sent once, securely (HTTPS), to interlinedlist.com to
get a login token. **Your password is never saved** to disk, logs, or anywhere
else — only the resulting login token is stored, and it's kept in your operating
system's secure credential store (macOS Keychain, Windows Credential Manager, or
Linux Secret Service), not in a plain file.

### What signing in unlocks

Signing in unlocks **all features** — there are no tiers, quotas, or extras to
buy. It's simply the gate that turns scraping on. Once you're in, the app opens
your **Library** (your list of past and current mirrors).

### Forgot your password?

Click **Forgot password?** on the sign-in screen. This opens interlinedlist.com
in your normal web browser, where you can reset your password. The app itself
doesn't handle password resets.

### Signing out

Your account email and a **Sign out** button live at the bottom of the left
sidebar once you're signed in. Signing out clears your stored login token and
returns you to the sign-in screen. Your saved mirrors stay on your disk and
remain openable — see below.

### If your session expires

If your login expires while you're using the app, Offline Web **never
fails silently or throws away your work**:

- Any **running job auto-pauses** (it does not fail) and shows *"Your
  interlinedlist.com session expired. Sign in to resume."*
- You're routed back to the sign-in screen. After you sign in again, the app
  **resumes the exact paused job** right where it left off — no pages are
  re-fetched, and you don't have to reconfigure anything.

> **Browsing your existing mirrors never requires a login.** Your captured pages
> are local files. Opening them in your browser or revealing them in your file
> manager works signed-out and offline. Only starting a *new* scrape or a
> re-scrape needs an active session.

---

## 3. Make your first mirror

1. From the **Library**, click **+ New scrape** (or **New scrape** in the
   sidebar). This opens the **New scrape** screen.
2. In the **URL** field, type or paste the address of the page you want to save,
   e.g. `https://example.com`. It must start with `http://` or `https://`.
3. Choose **what to capture** — two cards:

   | Choice | What it does |
   |--------|--------------|
   | **This page only** *(default)* | Saves just that one page plus its immediate assets (images, styles, scripts). |
   | **Whole site** | Follows links within scope to capture many pages. See [§4](#4-whole-site--advanced-options). |

4. Under **Save to**, the app shows the default folder it will use:
   `~/Offline Web/<site>/` (on Windows, under your user profile).
5. Note the reminder near the bottom: *"Static snapshot — some dynamic features
   won't work offline."*
6. Click **Start scrape**.

For a simple, single-page capture the job runs immediately and takes you to the
live **Progress** screen, then to your **Results**.

> **What "assets" means.** By default the app captures the images, stylesheets,
> and scripts a page needs to look right offline, and rewrites the page's links
> and references so it opens correctly from your local disk with no network.

---

## 4. Whole-site & Advanced options

Choosing **Whole site** turns one page into a bounded crawl that follows links.
Everything here is designed to be **safe by default** — you can get a good result
without ever opening Advanced.

### Depth

When you pick **Whole site**, a **Depth** menu appears. It controls how many
"clicks" deep from the starting page the crawl follows links:

| Preset | Meaning |
|--------|---------|
| **Just this section (1)** | Only pages linked directly from the start page. |
| **A few levels (2)** *(default)* | A shallow, sensible crawl. |
| **Deeper (4)** | Follows links several levels down. |
| **Everything (unlimited)** | No depth limit — can be large. Choose deliberately. |

### The Advanced drawer

Click **▸ Advanced** on the New scrape screen to reveal expert controls. They come
pre-filled with polite, safe defaults:

| Option | Default | What it does |
|--------|---------|--------------|
| **Domain scope** | Same domain | Where the crawl is allowed to go: *Same domain*, *Include subdomains*, *Specific domains…* (you list them), or *Any domain* (danger). |
| **Rate (requests/sec/host)** | 1 | How fast the app fetches. A **polite zone of ≤ 1 req/s** is marked; a **hard ceiling of ~5 req/s** applies no matter what. |
| **Concurrency (workers)** | 2 | How many pages are fetched at once. |
| **robots.txt** | Respect (default) | Whether to honor the site's `robots.txt`. See below. |
| **User-agent** | Truthful Offline Web UA | The identity the app reports to sites. It is honest and not disguised. |
| **Max pages** | 500 | Safety cap — the crawl pauses when it hits this. |
| **Max size (GB)** | 2 | Safety cap on total downloaded data. |
| **Max time (minutes)** | 30 | Safety cap on run time. |

### robots.txt (respected by default)

Most sites publish a small `robots.txt` file telling automated tools which areas
to avoid. **By default, Offline Web reads and honors it** — blocked
pages are skipped and show up in your capture report as "Blocked by robots.txt,"
so nothing disappears silently.

You *can* switch robots.txt to **Ignore** in Advanced, but do so only for content
you have a clear right to mirror (ideally your own). Ignoring it overrides the
site's stated preferences and may conflict with its terms. See the
[Acceptable Use guide](acceptable-use.md).

### Safety caps

Every job has enforced caps — **500 pages, 2 GB, or 30 minutes** by default,
whichever comes first. When a job reaches a cap, it **pauses and keeps what it
captured** rather than truncating silently or running forever.

### The pre-flight confirmation

For a small, safe job, **Start scrape** goes straight to Progress — no nagging.
But if a job trips a threshold, a short **"Before we start"** sheet appears first.
It summarizes the scope in one sentence and shows a targeted caution line for each
risky choice. You then choose **Start anyway** or **Adjust settings**. It appears
when you:

- run a **whole-site crawl several levels deep**,
- choose to **ignore robots.txt**,
- allow **subdomains, specific domains, or any domain**, or
- **raise the safety limits** above their defaults.

---

## 5. Watching a job

When a scrape starts, the **Progress** screen opens with a live readout.

### The readout

- **Status badge** — *Starting…*, *Running*, *Paused*, *Finishing*, *Done*, and
  so on.
- **Now** — the page currently being fetched.
- **Progress bar and counts** — e.g. "128 of ~300 pages."
- **Stats line** — queue depth, pages-per-second, and data downloaded so far,
  e.g. *"Queue: 172 · 3.4 pg/s · 84 MB."*
- **Skipped / errored** — a running count with a breakdown grouped by reason
  (blocked by robots.txt, timed out, off-scope, HTTP error, and so on).

### Controls

| Control | What it does |
|---------|--------------|
| **Pause** / **Resume** | Safely pauses the crawl and resumes it exactly where it left off — no re-fetching. (Tip: press the **Space** bar to toggle pause.) |
| **Stop & keep results** | Finalizes the job, keeping everything captured so far as a partial result. |
| **Rate** slider | Speeds up or slows down the running job live, without restarting it. Rates above the polite zone show a ⚠ marker. |
| **Back** | Returns to the Library; the job keeps running. |

### Jobs survive quitting and crashes

A job's state is saved to disk as it runs. If you **quit the app, it crashes, or
you lose your network connection**, the job isn't lost — it appears in your
Library as **Paused** or **Partial** with a **Resume** button that continues it
from where it stopped. Jobs also keep running when the window is minimized.

The app pauses (rather than fails) and tells you plainly when:

- **your login expires** — sign in again to resume,
- **you go offline** — it waits and resumes automatically when you reconnect,
- **the disk fills up** — free some space, then Resume, or
- **a safety cap is reached** — keep the partial result or adjust and continue.

---

## 6. Your results

When a job finishes (or you Stop it), the **Results** screen shows what you
captured. You can also reach it any time from the Library by clicking **Open** on
a mirror.

### Header and actions

The header shows the site name, capture date, page count, asset count, total
size, and where it's saved. A persistent banner reminds you: *"Static snapshot —
interactive features (logins, live feeds, search boxes) may not work offline."*

| Action | What it does |
|--------|--------------|
| **Open in browser** | Opens the captured `index.html` in your default web browser, from your local disk (`file://`). This is your real browser — full fidelity for what was captured. |
| **Show in folder** | Reveals the saved files in Finder (macOS) / Explorer (Windows) / your file manager (Linux). |
| **Re-scrape** | Re-runs the same settings. You choose **New dated capture (keeps this one)** — the default — or **Overwrite this capture** in place. |
| **Delete** | Permanently removes the captured files. You'll be asked to confirm. |
| **Resume** | Appears on partial/paused mirrors — continues the job. |

### The capture report

Below the actions, a **Capture report** breaks down exactly what happened:

- **Captured** — the number of pages and assets and the total size, plus a
  browsable list of captured pages (each opens locally).
- **Skipped** — grouped by reason and explained in plain language: blocked by
  robots.txt, off-scope, too large, HTTP errors, timeouts, and needs-JavaScript.
  Where there's a fix, the report offers it inline as a button (for example
  *"Increase depth,"* *"Allow subdomains,"* or re-scrape with rendering).
- **What likely won't work offline** — an honest list of fidelity limits: server
  search, login areas, live or streamed content, and some interactive JavaScript.

### Fidelity: it's a static snapshot

Offline Web saves a **static** copy. It faithfully reproduces the
pages, images, and styles it captured, but anything that needs a live server or a
running app — search boxes, sign-in areas, live feeds, streaming, and some
interactive JavaScript — won't function in your offline copy. The capture report
tells you specifically what to expect.

### Special result states

- **Partial** — if a job was stopped early, capped, or interrupted, it's badged
  **Partial** and leads with what's missing plus a **Resume** / **Re-scrape**
  path.
- **Nothing captured** — if a job captured nothing (e.g. everything was blocked),
  Results shows a plain-language diagnosis and the single most likely fix as a
  button.
- **Files not found** — if you moved or deleted the saved files outside the app,
  Results shows *"Files not found"* with **Locate folder…** and **Re-scrape**
  instead of breaking.

---

## 7. Troubleshooting & FAQ

**I can't sign in.**
- Double-check your email and password on interlinedlist.com in your browser.
  Use **Forgot password?** on the sign-in screen if needed.
- *"Can't reach interlinedlist.com"* means a network problem — check your
  connection and try again.
- Signing in works only in the **desktop app** (`npm run tauri dev`), not the
  browser preview.

**Some pages were "Blocked by robots.txt."**
That site asked automated tools not to fetch those pages, and the app respected
that by default. This is normal and is shown in the capture report. You may change
the robots.txt setting to **Ignore** in **Advanced** — but only for content you
have a clear right to mirror. See the [Acceptable Use guide](acceptable-use.md).

**My captured page is blank or missing its content.**
The page likely builds its content with JavaScript, which a static capture can't
run. The report flags this as **Needs JavaScript**.
> **JavaScript rendering is Planned.** A "Render JavaScript" mode that loads such
> pages in a headless browser — with one-click re-scrape from the report — is on
> the roadmap (**M4**) and not shipped yet. For now these pages are honestly
> flagged rather than saved as silent blanks.

**The site is huge / the job is taking forever.**
Whole-site crawls stop at the safety caps (500 pages / 2 GB / 30 minutes by
default) and pause to ask you what to do. You can also **Stop & keep results** at
any time, lower the **Rate**, or reduce **Depth** and re-scrape.

**Results say "Files not found."**
The saved files were moved or deleted outside the app. Use **Locate folder…** to
re-check, or **Re-scrape** to capture the site again.

**The disk filled up mid-job.**
The job pauses with *"Ran out of disk space"* and keeps what it captured. Free
some space (or plan to change the save location) and click **Resume**.

**Can I change where mirrors are saved, or adjust global defaults?**
> **Settings is Planned.** A **Settings** area (Account, Defaults, Storage,
> Network) is designed and appears greyed-out in the sidebar, but is **not
> functional yet** (**M5**). For now, each job saves under
> `~/Offline Web/<site>/`.

**Where do my scraped pages go — does anything get uploaded?**
Nothing you scrape ever leaves your computer. Captured pages, assets, and reports
are written only to the folder you see under **Save to**. The only thing the app
talks to a server about is signing you in.

---

## 8. Using the app responsibly

Offline Web is safe and polite by default — respecting robots.txt,
fetching slowly, staying on the same domain, and stopping at finite caps. If you
never open Advanced, you can't produce an abusive crawl.

When you *do* use Advanced options, you take on responsibility for how you use
them. Please read:

> **➡ [Acceptable Use & Your Responsibilities](acceptable-use.md)** — what the
> app is for, how it protects sites, and the copyright and personal-data
> principles you're asked to follow. (It is guidance, not legal advice.)
