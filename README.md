DocClip
=======

Clip loose scans into one ready-to-upload document — free, in your browser.

Two scans of the same paper page (front/back of an ID, page 1 and 2 of a
transcript) come out of the scanner as two files, but upload portals want one.
DocClip merges them — side by side or stacked — into a single JPG, PNG, or
PDF, and doubles as a quick image ⇄ JPG/PNG/PDF converter.

What it does
------------

| Mode         | What you get                                                    |
| ------------ | --------------------------------------------------------------- |
| Side by side | 2+ images joined left → right (two-sided pages)                 |
| Stacked      | 2+ images joined top → bottom (long receipts, chat threads)     |
| Convert only | File-type conversion without joining (JPG ⇄ PNG, → PDF)         |

- **Output formats:** JPG, PNG, or PDF. PDF offers two layouts: one joined
  page, or one page per image — each page sized exactly to its scan.
- **Layout controls** (advanced): cross-axis alignment, pixel gap, background
  (white / black / transparent).
- **Honest multi-image convert:** converting several images to PDF produces a
  multi-page PDF in your chosen order; JPG/PNG can't hold pages, so the app
  warns you instead of silently dropping files.

Private by design
-----------------

Everything runs locally in your browser: joining uses the HTML canvas and
PDFs are generated with jsPDF. No uploads, no accounts, no watermarks — there
is no server code at all. Sensitive documents (IDs, transcripts) never leave
your device, and the app works offline once loaded.

Getting started
---------------

    bun install
    bun run dev      # http://localhost:3000

    bun run build    # production build
    bun run start    # serve the production build

Tech
----

- Next.js 14 (App Router) + React 18 + TypeScript
- Tailwind CSS, dark theme (`tailwind.config.ts`)
- jsPDF for in-browser PDF generation
- No backend, no API routes, no accounts, no third-party services
