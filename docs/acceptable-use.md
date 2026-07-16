# InterlinedList Offline — Acceptable Use & Your Responsibilities

**Audience:** everyone who uses InterlinedList Offline.
**What this is:** a plain-language guide to what the app is for, how it protects
the sites you mirror, and what you're responsible for.

> **Not legal advice.** This document explains how the app behaves and the
> principles we ask you to follow. It is not legal advice and it isn't a
> substitute for a site's own terms of service or the law where you live. When
> in doubt about whether you're allowed to copy something, don't — or ask the
> site owner.

---

## 1. What InterlinedList Offline is for

InterlinedList Offline is a free desktop app that saves a **local, personal copy**
of a web page or website so you can read it offline. Think of it as a smarter
"Save Page As" that also captures the images, styles, and pages you'd want to
keep together.

**Good uses — this is what the app is built for:**

- Keeping an offline copy of an article, guide, or reference you're allowed to read.
- Archiving your own website or content you own or manage.
- Saving documentation for travel, spotty internet, or long-term reference.
- Capturing a page you have permission to mirror.

The guiding idea is simple: **mirror only content you're allowed to mirror, at a
polite pace, for your own use.**

### What it must not be used for

Please **do not** use InterlinedList Offline to:

- **Mass-scrape** sites for data harvesting, resale, or building a competing
  service.
- **Ignore a site's terms of service** when those terms forbid copying or
  automated access.
- **Infringe copyright** — copying and redistributing content you don't have the
  right to share.
- **Harvest personal data** about people (emails, profiles, contact details) or
  build databases of individuals.
- **Evade access controls**, paywalls, or login walls you aren't authorized to
  pass.
- **Overload or disrupt** a website by hammering it with requests.

> **⚠️ You are responsible for how you use the copies you make.** The app makes a
> local copy; what you do with it — read it, share it, republish it — is on you,
> and copyright and site terms still apply.

---

## 2. How the app protects sites by default

You don't have to be an expert to be a good web citizen. Out of the box,
InterlinedList Offline is deliberately cautious. If you never open **Advanced**,
you **cannot** produce an aggressive or abusive crawl. Here's what's working for
you, and why each one matters.

### It respects `robots.txt` by default

Most websites publish a small file called `robots.txt` that tells automated
tools which areas they'd prefer not to be crawled. **By default, InterlinedList
Offline reads and honors that file.** Pages the site asks crawlers to skip are
skipped, and they show up in your capture report as "blocked by robots.txt" — so
nothing disappears silently.

*Why it matters:* it's the web's long-standing, good-faith way for a site to
state its preferences. Respecting it keeps you on the right side of most sites'
expectations.

You *can* choose to ignore it, but only as a deliberate **Advanced** choice with
a one-time acknowledgment. See [§4](#4-the-robotstxt-override).

### It's polite about speed

The app fetches pages slowly and a few at a time on purpose:

- **1 request per second** by default.
- **2 pages at a time** (concurrency of 2) at most by default.
- A **hard ceiling** that prevents abusive rates even if you turn the rate up in
  Advanced.

If a site tells us it's overloaded (an HTTP 429 or 403 response), the app
automatically **slows down and backs off**, and lets you know gently.

*Why it matters:* a slow, steady trickle of requests behaves like a person
reading, not a machine attacking. It protects the site's servers **and** your own
IP address's reputation from being flagged or blocked.

### It stops before things get out of hand

Every job has built-in safety caps. By default a single job stops at:

- **500 pages**, or
- **2 GB** of downloaded data, or
- **30 minutes** of run time —

whichever comes first.

When a job reaches a cap it **pauses and asks you** what to do — it never
silently truncates your copy or silently keeps running forever.

*Why it matters:* these caps stop a "just this one site" job from quietly
ballooning into a multi-gigabyte, hours-long crawl that fills your disk and
pounds a server.

> **✅ Safe by default.** page-only, respect robots, polite rate, same domain,
> finite caps. A first-time user who never touches Advanced gets a good result
> *and* stays polite automatically.

---

## 3. Copyright and personal data

### Copyright

Making an offline copy does not give you rights you didn't already have. **Mirror
only content you have the right to mirror.** A personal offline copy for your own
reading is very different from republishing, redistributing, or repackaging
someone else's work. The app can't judge what you're allowed to copy — that
judgment is yours.

### Personal data

Don't use the app to collect information about people. Building lists of names,
emails, profiles, or contact details is a misuse of the tool and may break
privacy laws.

### Your copies stay on your device

> **🔒 What you scrape stays local.** InterlinedList Offline **never uploads your
> mirrored content anywhere.** Captured pages, assets, and reports are written
> only to the folder on your computer that you chose. There is no cloud sync, no
> server-side copy of what you scraped, and no back-channel that sends your
> saved pages off your machine.

The only thing the app talks to a server about is **signing you in** (your
InterlinedList account). Your scraped content is not part of that.

---

## 4. The `robots.txt` override

Because some legitimate needs exist (for example, archiving a site you own whose
`robots.txt` is overly broad), the app *lets you* turn off robots.txt respect —
but it puts real friction and responsibility in front of that choice.

**How it works:**

- The setting lives inside **Advanced**, not on the main screen. You have to go
  looking for it.
- The **first time** you enable it, you acknowledge a one-line caution. We don't
  nag you about it on every job after that.
- If a job is set to ignore robots.txt, the **pre-flight check restates** that
  choice in one line before the job starts, so it's never a surprise.
- The override is **recorded in the job's manifest**, so the copy itself carries
  an honest record of how it was made.

> **⚠️ Ignoring robots.txt is your call and your responsibility.** A site's
> `robots.txt` reflects how its owner wants automated tools to behave. Overriding
> it may conflict with the site's terms of service. Only do this for content you
> have a clear right to mirror — ideally content you own.

---

## 5. Privacy and telemetry

InterlinedList Offline is built to know as little about you as possible.

- **Crash reports are opt-in only.** The app does not send diagnostics unless you
  turn them on. You're asked once, at first run, and you can change your mind any
  time in Settings.
- **Crash reports never include your scraped content or the URLs you targeted.**
  A crash report is about the app failing — not about what you were saving.
- **Your credentials are never logged or transmitted anywhere except
  InterlinedList's sign-in.** Your password is used only to sign in, over a
  secure connection, and is never written to disk, logs, or crash reports.
- **No usage tracking of what you mirror.** The app doesn't phone home a list of
  sites you've saved.

---

## App copy (for engineering to wire in M5)

*The strings below are the exact text the app should display. They are written to
match the anti-nag principles in ux-design §5: shown once, never per-scrape,
honest, and non-blocking. Engineering can lift them verbatim.*

### First-run acknowledgment (shown once, non-blocking) — satisfies LG-TOS-1

Display this once on first run as a dismissible card or banner (not a blocking
modal), with a persistent link to this document from Settings and About.

> **A quick note before you start**
>
> InterlinedList Offline saves copies of web content to your computer for offline
> reading. You're responsible for respecting each site's terms and copyright —
> **mirror only content you're allowed to.** By default the app respects
> robots.txt, fetches politely, and keeps everything on your device — nothing you
> save is ever uploaded.
>
> [ Got it ]   [ Read the acceptable-use guide ]

Button label: **Got it** (dismiss). Secondary link: **Read the acceptable-use
guide** (opens this document).

### Pre-flight caution lines (shown only when the job trips that choice) — satisfies LG-TOS-2

Show only the line(s) that apply to the job about to start, inside the existing
pre-flight sheet (D2). One targeted line each — not a blanket warning. Do not
show any of these for a safe, default job.

- **Ignoring robots.txt:**
  > ⚠ You chose to ignore robots.txt for this job. Make sure you have the right
  > to mirror these pages.

- **Any-domain scope:**
  > ⚠ You allowed any domain. This job can follow links off the original site —
  > only do this for content you're allowed to mirror.

- **Unlimited / no caps:**
  > ⚠ You removed the safety limits. This job has no page, size, or time cap and
  > could get very large.

### First-time robots-override acknowledgment (shown once, when the setting is first enabled) — supports LG-ROBOTS-2

Show this once, inline in Advanced, the first time the user switches robots.txt to
"Ignore." Do not repeat it on later jobs.

> Ignoring robots.txt means fetching pages a site has asked automated tools to
> skip. Only do this for content you have the right to mirror — ideally your own.
>
> [ I understand — ignore robots.txt ]   [ Cancel ]

---

## Where this lives in the app

- A short first-run acknowledgment (the copy above) appears **once**.
- This full document is linked from **Settings** and **About** so it's always
  reachable, and it is never re-shown per scrape.

---

*This document covers the acceptable-use, copyright/PII, and first-run
acknowledgment requirements in the project plan (LG-TOS-1, LG-TOS-2, LG-PII-1,
and the robots-override path LG-ROBOTS-2). It is user-facing guidance, not legal
advice.*
