# Second brain pipeline

The Python side of the **Second brain** page on vineetganti.com. It reads newsletters and company engineering blogs, triages them with an LLM, lets one person (the site owner) curate, and publishes a small **signed** snapshot that the website verifies and renders.

> This folder lives inside a **public** repository. Private data (database, ratings, notes, OAuth tokens, `.env`, signing keys) stays in `second-brain/data/` and the ignored files listed in `.gitignore`. `node scripts/check-public-safety.mjs` (also run in CI) fails if any of it is ever tracked.

## How it fits together

```text
sources (RSS, sitemaps, listing pages, allowlisted email)
   -> nb daily        fetch, triage, store           (data/…sqlite, private)
   -> nb brief        curate on localhost only       (rate, remove from Good reads)
   -> nb publish      whitelist + sign               (data/out/public/*.json|xml + .sig)
   -> node scripts/upload-second-brain.mjs           (Vercel Blob, token only on this machine)
   -> /second-brain   site verifies the signature, then renders   (no write path)
```

The contract between the two halves is in [docs/second-brain-contract.md](docs/second-brain-contract.md). The daily routine and the manual-to-automatic plan are in [docs/learning-loop.md](docs/learning-loop.md); sources are listed in [docs/sources.md](docs/sources.md).

## Set up (Windows PowerShell, from this folder)

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
copy .env.example .env      # then fill it in; .env is ignored by git
python -m pytest -q
```

## Commands

| Command | What it does |
|---|---|
| `nb daily` | read sources, triage what is new, write the digest; updates the Good reads shelf |
| `nb brief` | private curator on 127.0.0.1 (rate: skip / good / top learning; remove from Good reads) |
| `nb eval` | how closely the model's scores match your ratings, and the gates for automatic mode |
| `nb goodreads list\|add\|remove` | the Good reads shelf; a removal is a veto the model never overrides |
| `nb mode status\|manual\|automatic` | manual (default): you rate. automatic: model adds, 7-day retention |
| `nb purge --dry-run` | what retention would delete (the shelf and your rated items are kept) |
| `nb keys init` | create the signing key pair (refuses to overwrite) |
| `nb publish` | write and sign the public files |

## Layout

```text
src/newsletter_brief/   package, one subfolder per stage (ingest, parse, sources, summarize, brief, publish, db, memory)
tests/                  pytest
evals/                  hand-labelled evaluation set and metrics
scripts/                one-off entry points
docs/                   plan, sources, learning loop, website contract
data/                   IGNORED: database, signing keys, output
```
