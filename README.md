# pi-venice

>  [Pi Coding Agent](https://pi.dev) extension for using Venice.AI as provider. All text, image, edit, video models and tools with support for S3 output storage.

A Pi extension that adds:

- Venice text models to Pi's `/model` picker
- Venice image/video models & media tools for image generation, image editing, upscale, background removal, and video generation
- configurable local or S3-compatible image/edit/video output storage

## Quick start

```bash
export VENICE_API_KEY="your-venice-api-key"
pi -e npm:pi-venice

# or from Github

pi -e https://github.com/tunnckoCore/pi-venice

# or direct install

pi install npm:pi-venice
```

## What it supports

### Text models
The extension fetches the Venice model catalog and registers Venice text models as a Pi provider named `venice`.

That means you can use Venice text models through Pi's normal model selection flow, eg. with `/model`

### Included tools

- `venice_list_models`
- `venice_image_generate`
- `venice_image_edit`
- `venice_image_multi_edit`
- `venice_image_upscale`
- `venice_background_remove`
- `venice_video_generate`
- `venice_video_retrieve`
- `venice_video_complete`

### Catalog families
The extension can track broader Venice catalog families such as:

- ✅ `text`
- ✅ `image`
- ✅ `edit`
- ✅ `upscale`
- ✅ `video`
- ❌ `embedding`
- ❌ `music`
- ❌ `tts`
- ❌ `asr`
- ❌ `audio`

**NOTE:** Not every catalog family has a dedicated Pi tool. Families without runtime support are still visible in catalog/config output so the extension stays honest about what Venice exposes.

## Authentication

The extension currently supports **API key authentication**.

It looks for a Venice API key in either:

- `VENICE_API_KEY`
- `~/.pi/agent/auth.json`

Example `auth.json` using an environment variable name:

```json
{
  "venice": {
    "type": "api_key",
    "key": "VENICE_API_KEY"
  }
}
```

Example `auth.json` using a literal API key:

```json
{
  "venice": {
    "type": "api_key",
    "key": "vnc_live_abc123"
  }
}
```

OAuth is **not implemented** in this extension today. If Venice exposes a stable OAuth flow in the future, it could be added through Pi's custom-provider OAuth hooks and `/login`, but that is not wired up yet.

## Make Venice your default provider

Example `~/.pi/agent/settings.json`:

```json
{
  "defaultProvider": "venice",
  "defaultModel": "zai-org-glm-5",
  "enabledModels": ["venice/*"]
}
```

## `pi-venice` settings

Extension-specific settings live under:

```json
{
  "pi-venice": {
    "...": "..."
  }
}
```

Supported locations:

- global: `~/.pi/agent/settings.json`
- project: `.pi/settings.json`

Project settings override global settings.

### Local output example

```json
{
  "pi-venice": {
    "apiKeyEnv": "VENICE_API_KEY",
    "families": {
      "enabled": ["text", "image", "edit", "video"],
      "defaults": {
        "text": "zai-org-glm-5",
        "image": "flux-2-max",
        "edit": "qwen-edit",
        "video": "seedance-2-0-text-to-video"
      }
    },
    "output": {
      "rootDir": ".pi/venice-output"
    },
    "storage": {
      "files": {
        "adapter": "local",
        "local": {
          "baseDir": ".pi/venice-output"
        }
      }
    }
  }
}
```

### S3 / R2 output example

Output generated images or videos to external S3-compatible storage:

```json
{
  "pi-venice": {
    "storage": {
      "files": {
        "adapter": "s3",
        "s3": {
          "endpoint": "https://<accountid>.r2.cloudflarestorage.com",
          "bucket": "pi-venice-artifacts",
          "region": "auto",
          "prefix": "my-project",
          "forcePathStyle": true,
          "publicBaseUrl": "https://cdn.example.com/pi-venice",
          "credentials": {
            "accessKeyId": "env:R2_ACCESS_KEY_ID",
            "secretAccessKey": "env:R2_SECRET_ACCESS_KEY"
          }
        }
      }
    }
  }
}
```

Adapter credential references support:

- `env:NAME`
- literal values - eg. you access key and secret keys inside your Pi config.

## Live stats dashboard

When running in interactive mode (`pi`), the extension renders a live stats widget below the editor powered by [venicestats.com](https://venicestats.com). It polls protocol KPIs, DEX data, social signals, and your wallet in real time.

### Default view

```
VVV $8.54  +13.4% 24h  ·  DIEM $1109.77  +17.4% 24h  ·  ETH $2320.86
MCap $393.4M  ·  Staked 67.8% @ 18.2% APR  ·  Locked 25.9%
gekko.eth  Consul Dolphin  ·  sVVV 12.1k  ·  DIEM staked 33.14  ·  Pending 92.47 VVV  ·  Rank #18/14.4k
```

VVV and DIEM prices flash **green** on uptick and **red** on downtick.

### Tracking your wallet

Set your wallet address to see your Venetian stats (sVVV, DIEM staked, pending rewards, rank):

```bash
export VENICE_WALLET=0x<your-address>
```

Or set it from inside the TUI (persisted across sessions):

```text
/venice-wallet 0x<your-address>
/venice-wallet          ← show current
/venice-wallet clear    ← remove
```

### Dashboard panels

The dashboard is built from composable panels. Each panel is a single row.

**List all panels:**
```text
/venice-panels
```

**Add / remove / reorder:**
```text
/venice-panel add <id>
/venice-panel remove <id>
/venice-panel move <id> up
/venice-panel move <id> down
/venice-panel reset        ← restore defaults: prices, protocol, wallet
```

**Available panels:**

| id | Label | What it shows | Data source |
|----|-------|---------------|-------------|
| `prices` | Prices | VVV + DIEM + ETH spot prices with 24h % change. Prices flash on tick. | `/api/metrics` every 5s |
| `protocol` | Protocol | Market cap, staking ratio, APR, sVVV lock ratio | `/api/metrics` every 5s |
| `wallet` | Wallet | Your Venetian: sVVV staked, DIEM staked, pending rewards, role and rank | `/api/venetians` every 60s |
| `diem` | DIEM | DIEM supply, daily mint rate, days until cap, stake ratio | `/api/metrics` every 5s |
| `social` | Social | Erik Voorhees followers, CoinGecko sentiment %, VVV + DIEM market cap ranks | `/api/social` every 5m |
| `burns` | Burns | Total VVV burned, organic burn volume, annual deflation rate | `/api/metrics` every 5s |
| `staking` | Staking | New stakers (7d), 7-day staking growth, VVV in cooldown | `/api/metrics` every 5s |
| `markets` | Markets | VVV DEX 24h volume, buy %, unique trader count | `/api/markets` every 30s |
| `live` | Live | Most recent on-chain event (swap, stake, DIEM mint/burn) | `/api/live` every 10s |
| `revenue` | Revenue | Venice protocol revenue to date, annualized burn revenue, emission rate | `/api/metrics` every 5s |

**Dynamic rate allocation** — the extension targets a configurable budget (default **30 req/min**, range **1–59**), shared automatically across whichever data sources your active panels need.

```text
/venice-budget          ← show current budget
/venice-budget 10       ← low-bandwidth mode
/venice-budget 30       ← default
/venice-budget 59       ← near-maximum
/venice-budget reset    ← restore default (30)
```

A single 500 ms master ticker fires each source only when its computed interval has elapsed. Sources are weighted by how time-sensitive they are:

| Source | Weight | 3 panels @ 30 req/min | All 10 panels @ 30 req/min |
|--------|--------|----------------------|---------------------------|
| `/api/metrics` | 10 | ~27 req/min (2.2s) | ~16 req/min (3.8s) |
| `/api/live` | 5 | — | ~8 req/min (7.5s) |
| `/api/markets` | 2 | — | ~3 req/min (18s) |
| `/api/wallet` | 1 | ~3 req/min (20s) | ~2 req/min (37s) |
| `/api/social` | 0.5 | — | ~1 req/min (75s) |
| **Total** | | **~30 req/min** | **~30 req/min** |

- Panels that are disabled make **zero requests**.
- Adding panels shifts budget away from currently active sources — total stays near your configured budget.
- The minimum interval per source is `floor(60s / budget)` to prevent bursting.
- venicestats.com allows 60 req/min per IP; the default leaves a comfortable margin.

> **Multi-session warning** — if you open more than one `pi` session, only the **first** session to start will show the stats widget. Additional sessions display an info notice and make no API requests. This prevents two sessions from doubling the request rate and hitting the rate limit. To transfer the widget to a different session, close the first one.

## Commands

### `/venice-refresh-models`
Refresh the Venice model catalog and re-register Venice text models.

### `/venice-status`
Show:

- enabled catalog families
- implemented provider families
- implemented tool families
- enabled but not actionable families
- file storage adapter
- defaults
- model counts
- last refresh status
- active video jobs

### `/venice-models [family|all] [limit]`
Examples:

```text
/venice-models
/venice-models text 30
/venice-models embedding 20
/venice-models video 20
```

### `/venice-defaults`
Show or set default model IDs used by the extension.

### `/venice-families`
Show or set enabled Venice catalog families.

Examples:

```text
/venice-families
/venice-families text,image,embedding,video
/venice-families tts,asr,audio
/venice-families all
```

## Tool summary

### `venice_list_models`
List Venice models from the cached catalog.

### `venice_image_generate`
Generate images with `/image/generate`.

### `venice_image_edit`
Edit a single image with `/image/edit`.

### `venice_image_multi_edit`
Edit or composite up to 3 images with `/image/multi-edit`.

### `venice_image_upscale`
Upscale or enhance an image with `/image/upscale`.

### `venice_background_remove`
Remove an image background with `/image/background-remove`.

### `venice_video_generate`
Queue a video job, optionally quote it, poll for completion, and save the result.

### `venice_video_retrieve`
Retrieve or continue polling a previously queued video job.

### `venice_video_complete`
Delete a completed remote Venice video job from Venice storage.

## Non-interactive support

The extension works in headless and non-TUI flows for core functionality, including:

- provider registration
- model refresh
- media tools
- local file output
- S3-compatible output upload
- session state restoration

UI-only features are guarded so the extension can still be used in print, JSON, and embedded agent workflows.

## Output behavior

By default, outputs are written locally under `.pi/venice-output`.

If `pi-venice.storage.files.adapter` is set to `s3`, generated outputs are uploaded to the configured S3-compatible backend instead.

## License

Apache-2.0
