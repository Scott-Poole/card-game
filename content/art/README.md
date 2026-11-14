# Card art

`manifest.json` is an array with at most one entry per roster `cardId`. Each entry records a `file` name in this directory (`.webp`, `.jpg`, or `.png`, at most 400,000 bytes), its hex `sha256`, and non-empty source `title` and `author`. `sourceUrl` and `licenseUrl` must use HTTPS; `retrievedOn` is a calendar date in `YYYY-MM-DD` form.

Allowed `license` values are `PDM-1.0`, `CC0-1.0`, `CC-BY-3.0`, `CC-BY-4.0`, `CC-BY-SA-3.0`, and `CC-BY-SA-4.0`. NC and ND variants are excluded because they restrict commercial use or image changes. `attribution` is the exact credit line to display and must be non-empty for every CC-BY family license; it may be empty for PDM and CC0.

`modifications` describes every change, including resizing and cropping; use an empty string for unmodified files. Keep only recorded images, `manifest.json` and this README in this directory; subdirectories are rejected. Run `pnpm test` to validate metadata, roster references, file sizes and hashes. The manifest starts empty; full roster coverage arrives with art sourcing.
