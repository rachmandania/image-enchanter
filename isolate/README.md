ScanClip
=======

Clip loose scans into one ready-to-upload document — free, entirely in your
browser.

Two scans of the same paper page (front/back of an ID, page 1 and 2 of a
transcript) come out of the scanner as two files, but upload portals want one
file. ScanClip merges them — side by side or stacked — into a single JPG, PNG
or PDF, and doubles as a quick image converter (JPG ⇄ PNG ⇄ PDF).

What it does
------------

| Mode         | What you get                                                    |
| ------------ | --------------------------------------------------------------- |
| Side by side | 2+ images joined left → right (two-sided pages, page 1 & 2)     |
| Stacked      | 2+ images joined top → bottom (long receipts, chat threads)     |
| Convert only | File-type conversion without joining (JPG ⇄ PNG, → PDF)         |

**Output formats:** JPG, PNG, or PDF.

**PDF layouts** (choosable when the output is PDF):

- **One page** — all images joined into a single PDF page, exactly like the
  image joins, then wrapped in a PDF.
- **One page per image** — a normal multi-page PDF; each page is sized exactly
  to its scan (no letterboxing, no white borders).

**Advanced layout options** (join modes): cross-axis alignment
(top/left · center · bottom/right), pixel gap (0–100px), and background color
(white · black · transparent). Transparent backgrounds render with a
checkerboard preview; PNG keeps real transparency.

Behavior details
----------------

- **Switching output format resets the file list.** JPG, PNG and PDF are
  treated as separate jobs: pick a new format and you start fresh. This is
  intentional — it guarantees every format runs in a clean state (and it is
  also the practical workaround for browser canvas memory limits, see below).
- **Switching the join mode keeps your files**, because it only changes how
  the same images are arranged.
- **Multi-image "Convert only" is honest:** several images → PDF gives one
  PDF page per image, in the listed order. JPG/PNG files cannot hold multiple
  pages, so the app converts only the first image and says so instead of
  silently dropping files.
- **JPEG and PDF flatten transparency onto white** (those formats have no
  alpha channel); PNG preserves it.
- **The preview is the real output.** Image results are rendered at full
  resolution; what you download is exactly what you see.
- **Page order matters** and is adjustable: reorder uploaded files with the
  arrow buttons; the current order (left→right, top→bottom, or page 1→N) is
  always labeled.

Private by design
-----------------

Everything runs locally in your browser. Joining uses the HTML canvas, PDFs
are generated with jsPDF in the page. There is **no server code at all**: no
uploads, no accounts, no watermarks, no tracking. Sensitive documents (IDs,
transcripts) never leave your device, and the app works offline once loaded.

Getting started
---------------

    bun install
    bun run dev      # http://localhost:3000

    bun run build    # production build
    bun run start    # serve the production build

Project status
--------------

Working and manually verified: horizontal JPG join (two transcript scans →
one image) and PDF output. Recently hardened: canvases are freed immediately
after encoding, previous results are released before a new run, PDF previews
are downsampled thumbnails, and format switches reset the job — together
these fix "PDF only works after a page refresh" in Firefox; back-to-back
join→PDF across formats is the next thing to re-verify.

Not yet exercised end-to-end: PNG output, Stacked mode, advanced options
(alignment/gap/background), single-image convert. All of these run through
the same engine as the verified paths.

Roadmap ideas
-------------

- Drag-and-drop reordering (currently arrow buttons)
- PDF page-size presets (A4/Letter fit) and per-page quality/size control
- Image rotation before joining
- Progressive Web App manifest for install + full offline use
- Indonesian localization (the origin story is an Indonesian transcript scan)
- Automated tests for the join math (sizes, offsets, gap edges)

Tech
----

- Next.js 14 (App Router) + React 18 + TypeScript
- Tailwind CSS, dark theme (`tailwind.config.ts`)
- jsPDF for in-browser PDF generation
- No backend, no API routes, no accounts, no third-party services

Credits
-------

Built by Rachmandani Ardiyanto with [Codebuff](https://codebuff.com)
(Buffy agent). The idea came from a real problem: one academic transcript,
scanned as two files, rejected by every upload form that wanted one.
