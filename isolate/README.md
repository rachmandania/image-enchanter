ScanClip
========

Clip loose scans into one ready-to-upload document — free, entirely in your
browser.

Two scans of the same paper page (front/back of an ID, page 1 and 2 of a
transcript) come out of the scanner as two files, but upload portals want one
file. ScanClip merges them — side by side or stacked — into a single JPG, PNG
or PDF, and doubles as a quick image converter (JPG ⇄ PNG ⇄ PDF).

⭐ **Fork it, use it, remix it.** ScanClip is 100% free and open source —
no backend, no accounts, no tracking, nothing to pay for. If it solves a
problem for you, fork the repo and make it yours: rename it, translate it,
strip it down, build on it. The whole product is this folder; if you can run
`bun install`, you can run ScanClip. PRs are welcome too.

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
- **PDF pages respect the spec's 14,400 pt (200 in) size cap.** A page that
  would be larger is scaled down proportionally before the PDF is written —
  the embedded image keeps full resolution, so nothing is lost. Without this,
  PDF viewers silently clip oversized pages and a 6-scan-wide strip downloads
  cut in half.

Private by design
-----------------

Everything runs locally in your browser. Joining uses the HTML canvas, PDFs
are generated with jsPDF in the page. There is **no server code at all**: no
uploads, no accounts, no watermarks, no tracking. Sensitive documents (IDs,
transcripts) never leave your device, and the app works offline once loaded.

Run your own copy
-----------------

    bun install
    bun run dev      # http://localhost:3000

    bun run build    # production build
    bun start        # serve the production build

Forked it and want to ship it? It deploys anywhere static-ish Next.js runs —
Vercel, Netlify, Cloudflare, your own box. No environment variables, no
database, no secrets. The deploy is just `bun install && bun run build`.

Project status
--------------

Working and verified on Firefox (desktop + Android):

- Horizontal JPG join (two transcript scans → one image)
- PDF output for a 6-image side-by-side join (PDF page-size cap fix verified
  on-device after the "last image cut in half" bug report)
- Back-to-back runs no longer need a page refresh: canvases are freed
  immediately after encoding, previous results are released before a new
  run, and PDF previews are downsampled thumbnails.

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

License
-------

MIT — free to use, fork, modify, and ship. See [LICENSE](LICENSE).

Credits
-------

Built by Rachmandani Ardiyanto with [Codebuff](https://codebuff.com)
(Buffy agent). The idea came from a real problem: one academic transcript,
scanned as two files, rejected by every upload form that wanted one.
