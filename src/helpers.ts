import { appendFileSync, existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text, visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";
import {
  PANEL_REGISTRY,
  DEFAULT_PANELS,
  SOURCE_WEIGHTS,
  BILLING_INTERVAL_DEFAULT,
  BILLING_INTERVAL_MIN,
  BILLING_INTERVAL_MAX,
  fmtAddr,
  renderClock,
  detectTimezone,
  type AllData,
  type MetricsData,
  type WalletData,
  type SocialData,
  type MarketsData,
  type LiveData,
  type BillingData,
} from "./panels.ts";

import {
  CATALOG_FAMILIES,
  DEFAULTABLE_FAMILIES,
  IMPLEMENTED_PROVIDER_FAMILIES,
  IMPLEMENTED_TOOL_FAMILIES,
  USER_CONFIGURABLE_FAMILIES,
  VENICE_BASE_URL,
} from "./constants.ts";
import type {
  DefaultableFamily,
  ImplementedFamily,
  SavedFile,
  VeniceFamily,
  VeniceModelInfo,
  VeniceState,
  VeniceToolDetails,
} from "./types.ts";

export function truncate(value: string, max = 72): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(1, max - 3)) + "...";
}

export function slug(value: string, max = 48): string {
  const out = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return out || "venice";
}

export function makeJobKey(model: string, queueId: string): string {
  return `${model}:${queueId}`;
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function isDataUrl(value: string): boolean {
  return /^data:/i.test(value);
}

export function seemsBase64(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 64) return false;
  return /^[A-Za-z0-9+/=\s]+$/.test(trimmed);
}

export function familyFromRawType(type: string | undefined): VeniceFamily {
  switch (type) {
    case "text":
      return "text";
    case "image":
      return "image";
    case "inpaint":
      return "edit";
    case "upscale":
      return "upscale";
    case "video":
      return "video";
    case "music":
      return "music";
    case "tts":
      return "tts";
    case "asr":
      return "asr";
    case "embedding":
      return "embedding";
    case "audio":
      return "audio";
    default:
      return "unknown";
  }
}

export function isCatalogFamily(value: string): value is VeniceFamily {
  return (CATALOG_FAMILIES as readonly string[]).includes(value);
}

export function isUserConfigurableFamily(value: string): value is Exclude<VeniceFamily, "unknown"> {
  return (USER_CONFIGURABLE_FAMILIES as readonly string[]).includes(value);
}

export function isDefaultableFamily(value: string): value is DefaultableFamily {
  return (DEFAULTABLE_FAMILIES as readonly string[]).includes(value);
}

export function isImplementedProviderFamily(value: VeniceFamily): value is ImplementedFamily {
  return (IMPLEMENTED_PROVIDER_FAMILIES as readonly string[]).includes(value);
}

export function isImplementedToolFamily(value: VeniceFamily): value is ImplementedFamily {
  return (IMPLEMENTED_TOOL_FAMILIES as readonly string[]).includes(value);
}

export function getEnabledToolFamilies(state: VeniceState): VeniceFamily[] {
  return state.config.enabledCatalogFamilies.filter((family) =>
    isImplementedToolFamily(family),
  );
}

export function getEnabledButNotActionableFamilies(state: VeniceState): VeniceFamily[] {
  return state.config.enabledCatalogFamilies.filter(
    (family) =>
      !isImplementedToolFamily(family) && !isImplementedProviderFamily(family),
  );
}

export function ensureToolFamilyEnabled(
  state: VeniceState,
  family: VeniceFamily,
): string | undefined {
  if (!state.config.enabledCatalogFamilies.includes(family)) {
    return `Venice family '${family}' is disabled. Enable it with /venice-families.`;
  }
  if (!isImplementedToolFamily(family)) {
    return `Venice family '${family}' exists in the Venice catalog but is not implemented as a Pi tool yet.`;
  }
  return undefined;
}

export function mimeFromExtension(
  filePath: string,
  fallback = "application/octet-stream",
): string {
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".webp")) return "image/webp";
  if (filePath.endsWith(".gif")) return "image/gif";
  if (filePath.endsWith(".mp4")) return "video/mp4";
  if (filePath.endsWith(".mov")) return "video/quicktime";
  if (filePath.endsWith(".webm")) return "video/webm";
  if (filePath.endsWith(".wav")) return "audio/wav";
  if (filePath.endsWith(".mp3")) return "audio/mpeg";
  if (filePath.endsWith(".ogg")) return "audio/ogg";
  if (filePath.endsWith(".flac")) return "audio/flac";
  if (filePath.endsWith(".m4a")) return "audio/mp4";
  return fallback;
}

export function extensionFromMime(mimeType: string, fallback = ".bin"): string {
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("gif")) return ".gif";
  if (mimeType.includes("mp4")) return ".mp4";
  if (mimeType.includes("quicktime")) return ".mov";
  if (mimeType.includes("webm")) return ".webm";
  if (mimeType.includes("json")) return ".json";
  return fallback;
}

export function parseDataUrl(value: string): { mimeType: string; base64: string } {
  const match = value.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) {
    throw new Error("Invalid data URL input.");
  }
  return {
    mimeType: match[1],
    base64: match[2],
  };
}

export function getCountsByFamily(models: VeniceModelInfo[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const model of models) {
    counts[model.family] = (counts[model.family] || 0) + 1;
  }
  return counts;
}

export function costNumber(value: any): number {
  return typeof value === "number" ? value : 0;
}

export function normalizeModel(raw: any): VeniceModelInfo {
  const spec = raw?.model_spec ?? {};
  const capabilities = spec.capabilities ?? {};

  return {
    id: String(raw?.id ?? "unknown"),
    name: String(spec?.name ?? raw?.id ?? "Unknown model"),
    type: String(raw?.type ?? "unknown"),
    family: familyFromRawType(raw?.type),
    description:
      typeof spec?.description === "string" ? spec.description : undefined,
    traits: Array.isArray(spec?.traits)
      ? spec.traits.map((trait: any) => String(trait))
      : [],
    privacy: typeof spec?.privacy === "string" ? spec.privacy : undefined,
    offline: Boolean(spec?.offline),
    beta: Boolean(spec?.betaModel),
    contextWindow:
      typeof spec?.availableContextTokens === "number"
        ? spec.availableContextTokens
        : undefined,
    maxTokens:
      typeof spec?.maxCompletionTokens === "number"
        ? spec.maxCompletionTokens
        : undefined,
    pricing:
      spec?.pricing && typeof spec.pricing === "object" ? spec.pricing : undefined,
    constraints:
      spec?.constraints && typeof spec.constraints === "object"
        ? spec.constraints
        : undefined,
    supportsVision: Boolean(capabilities?.supportsVision),
    supportsVideoInput: Boolean(capabilities?.supportsVideoInput),
    supportsAudioInput: Boolean(capabilities?.supportsAudioInput),
    supportsFunctionCalling: Boolean(capabilities?.supportsFunctionCalling),
    supportsReasoning: Boolean(capabilities?.supportsReasoning),
    supportsReasoningEffort: Boolean(capabilities?.supportsReasoningEffort),
    supportsMultipleImages: Boolean(capabilities?.supportsMultipleImages),
    optimizedForCode: Boolean(capabilities?.optimizedForCode),
  };
}

export function coercePersistedModel(raw: any): VeniceModelInfo {
  if (raw?.model_spec) return normalizeModel(raw);

  return {
    id: String(raw?.id ?? "unknown"),
    name: String(raw?.name ?? raw?.id ?? "Unknown model"),
    type: String(raw?.type ?? raw?.family ?? "unknown"),
    family:
      typeof raw?.family === "string"
        ? familyFromRawType(raw.family === "edit" ? "inpaint" : raw.family)
        : familyFromRawType(raw?.type),
    description:
      typeof raw?.description === "string" ? raw.description : undefined,
    traits: Array.isArray(raw?.traits)
      ? raw.traits.map((trait: any) => String(trait))
      : [],
    privacy: typeof raw?.privacy === "string" ? raw.privacy : undefined,
    offline: Boolean(raw?.offline),
    beta: Boolean(raw?.beta),
    contextWindow:
      typeof raw?.contextWindow === "number" ? raw.contextWindow : undefined,
    maxTokens: typeof raw?.maxTokens === "number" ? raw.maxTokens : undefined,
    pricing:
      raw?.pricing && typeof raw.pricing === "object" ? raw.pricing : undefined,
    constraints:
      raw?.constraints && typeof raw.constraints === "object"
        ? raw.constraints
        : undefined,
    supportsVision: Boolean(raw?.supportsVision),
    supportsVideoInput: Boolean(raw?.supportsVideoInput),
    supportsAudioInput: Boolean(raw?.supportsAudioInput),
    supportsFunctionCalling: Boolean(raw?.supportsFunctionCalling),
    supportsReasoning: Boolean(raw?.supportsReasoning),
    supportsReasoningEffort: Boolean(raw?.supportsReasoningEffort),
    supportsMultipleImages: Boolean(raw?.supportsMultipleImages),
    optimizedForCode: Boolean(raw?.optimizedForCode),
  };
}

export function pickDefaultModel(
  state: VeniceState,
  family: DefaultableFamily,
): string | undefined {
  const configured = state.config.defaults[family];
  if (
    configured &&
    state.models.some((model) => model.family === family && model.id === configured)
  ) {
    return configured;
  }

  const familyModels = state.models.filter((model) => model.family === family);
  if (familyModels.length === 0) return undefined;

  const preferred = familyModels.find((model) =>
    model.traits.some((trait) => trait.toLowerCase().includes("default")),
  );

  return preferred?.id ?? familyModels[0].id;
}

export function toProviderModels(state: VeniceState): any[] {
  if (!state.config.enabledCatalogFamilies.includes("text")) return [];

  return state.models
    .filter((model) => model.family === "text" && !model.offline)
    .map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: Boolean(model.supportsReasoning),
      input:
        model.supportsVision || model.supportsMultipleImages
          ? (["text", "image"] as const)
          : (["text"] as const),
      cost: {
        input: costNumber(model.pricing?.input?.usd),
        output: costNumber(model.pricing?.output?.usd),
        cacheRead: costNumber(model.pricing?.cache_input?.usd),
        cacheWrite: costNumber(model.pricing?.cache_write?.usd),
      },
      contextWindow: model.contextWindow ?? 32768,
      maxTokens: model.maxTokens ?? 8192,
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: Boolean(model.supportsReasoningEffort),
      },
    }));
}

export function renderSavedFiles(
  files: SavedFile[] | undefined,
  expanded: boolean,
  theme: any,
): string {
  if (!files || files.length === 0) return "";
  const visible = expanded ? files : files.slice(0, 1);
  let text = "";
  for (const file of visible) {
    text += `\n${theme.fg("muted", file.path)}`;
  }
  if (!expanded && files.length > 1) {
    text += `\n${theme.fg("dim", `... ${files.length - 1} more`)}`;
  }
  return text;
}

export function renderToolSummary(
  title: string,
  result: any,
  expanded: boolean,
  isPartial: boolean,
  theme: any,
): Text {
  const details = (result.details ?? {}) as VeniceToolDetails;
  if (isPartial || details.status === "processing" || details.status === "queued") {
    let text = theme.fg("warning", `${title}: ${details.status || "working"}`);
    if (details.queueId) text += theme.fg("dim", ` · ${details.queueId}`);
    return new Text(text, 0, 0);
  }

  if (details.error || result.isError) {
    const message = details.error || (result.content?.[0]?.text ?? "Request failed");
    return new Text(theme.fg("error", `${title}: ${message}`), 0, 0);
  }

  let text = theme.fg("success", details.summary || `${title}: done`);
  if (details.model) text += theme.fg("dim", ` · ${details.model}`);
  if (details.quote !== undefined) text += theme.fg("dim", ` · quote $${details.quote}`);
  if (details.queueId) text += theme.fg("dim", ` · ${details.queueId}`);
  text += renderSavedFiles(details.savedFiles, expanded, theme);
  return new Text(text, 0, 0);
}

export function buildModelListing(
  models: VeniceModelInfo[],
  family: string,
  limit: number,
  reasoningOnly = false,
  visionOnly = false,
): { text: string; count: number } {
  let filtered = models;
  if (family !== "all") filtered = filtered.filter((model) => model.family === family);
  if (reasoningOnly) filtered = filtered.filter((model) => model.supportsReasoning);
  if (visionOnly) filtered = filtered.filter((model) => model.supportsVision);

  filtered = [...filtered].sort((a, b) => {
    if (a.family === b.family) return a.name.localeCompare(b.name);
    return a.family.localeCompare(b.family);
  });

  const total = filtered.length;
  const lines: string[] = [];
  let currentFamily = "";

  for (const model of filtered.slice(0, limit)) {
    if (model.family !== currentFamily) {
      currentFamily = model.family;
      lines.push(`\n[${currentFamily}]`);
    }

    const flags: string[] = [];
    if (model.supportsReasoning) flags.push("reasoning");
    if (model.supportsVision) flags.push("vision");
    if (model.supportsVideoInput) flags.push("video-input");
    if (model.optimizedForCode) flags.push("code");
    if (model.beta) flags.push("beta");

    const meta: string[] = [];
    if (model.contextWindow) meta.push(`${model.contextWindow} ctx`);
    if (model.maxTokens) meta.push(`${model.maxTokens} out`);
    if (flags.length > 0) meta.push(flags.join(", "));

    lines.push(`- ${model.id} — ${model.name}${meta.length ? ` (${meta.join(" · ")})` : ""}`);
  }

  if (total > limit) lines.push(`\n... ${total - limit} more model(s)`);

  return {
    text:
      lines.length > 0
        ? lines.join("\n")
        : "No Venice models matched the requested filters.",
    count: total,
  };
}

export function buildStatusSummary(state: VeniceState): string {
  const counts = getCountsByFamily(state.models);
  const activeJobs = Object.values(state.videoJobs).filter(
    (job) => job.status === "queued" || job.status === "processing",
  ).length;
  const defaults = DEFAULTABLE_FAMILIES.map((family) => {
    return `${family}=${pickDefaultModel(state, family) ?? "none"}`;
  }).join(", ");
  const countSummary = Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([family, count]) => `${family}:${count}`)
    .join(", ");
  const refreshed = state.config.lastRefreshAt
    ? new Date(state.config.lastRefreshAt).toLocaleString()
    : "never";
  const notActionable = getEnabledButNotActionableFamilies(state);

  return [
    `Venice extension status`,
    `- base URL: ${state.config.baseUrl}`,
    `- enabled catalog families: ${state.config.enabledCatalogFamilies.join(", ")}`,
    `- implemented provider families: ${IMPLEMENTED_PROVIDER_FAMILIES.join(", ")}`,
    `- implemented tool families: ${IMPLEMENTED_TOOL_FAMILIES.join(", ")}`,
    `- enabled but not actionable yet: ${notActionable.length ? notActionable.join(", ") : "none"}`,
    `- file storage adapter: ${state.config.storage.files.adapter}`,
    `- file output root: ${state.config.storage.files.adapter === "local" ? state.config.storage.files.local.baseDir : state.config.storage.files.s3?.bucket ?? "unconfigured-s3"}`,
    `- defaults: ${defaults}`,
    `- model counts: ${countSummary || "none"}`,
    `- active video jobs: ${activeJobs}`,
    `- last refresh: ${refreshed}`,
    `- refresh state: ${state.config.lastRefreshStatus}${state.config.lastError ? ` (${state.config.lastError})` : ""}`,
  ].join("\n");
}

// --- Venice stats widget ---------------------------------------------------
// Two separate polling systems:
//
// 1. venicestats.com sources share a configurable req/min budget, distributed
//    proportionally by SOURCE_WEIGHTS.  A 500ms master tick fires each fetcher
//    only when its computed interval has elapsed.
//
// 2. venice.ai /billing/balance uses its own independent timer with a
//    configurable interval (default 30s), since it's a separate API with
//    separate rate limits.
//
// With all panels enabled the weighted split produces ≈19 req/min on venicestats.com.
// Billing (venice.ai) uses a separate timer (default 30s).

const STATS_WIDGET_KEY  = "venice-stats";
const STATS_LOG         = join(homedir(), ".pi", "venice-stats.log");
const FLASH_MS          = 400;
const BUDGET_DEFAULT    = 30;  // req/min used when no user preference is set
const BUDGET_MIN        = 1;
const BUDGET_MAX        = 59;
const TICK_MS           = 500;

// ── multi-session lock ────────────────────────────────────────────────────────
// Only one pi session should poll venicestats.com at a time to avoid hitting
// the 60 req/min per-IP rate limit.  We use a PID file as a lightweight lock.

const WIDGET_LOCK       = join(homedir(), ".pi", "venice-stats.pid");
let _lockOwned          = false;

export function tryAcquireWidgetLock(): boolean {
  try {
    if (existsSync(WIDGET_LOCK)) {
      const raw = readFileSync(WIDGET_LOCK, "utf8").trim();
      const pid = Number(raw);
      if (!isNaN(pid) && pid !== process.pid) {
        try { process.kill(pid, 0); return false; } // another live session
        catch { /* stale PID — fall through and overwrite */ }
      }
    }
    writeFileSync(WIDGET_LOCK, String(process.pid), "utf8");
    _lockOwned = true;
    return true;
  } catch { return false; }
}

export function releaseWidgetLock(): void {
  if (!_lockOwned) return;
  try {
    if (readFileSync(WIDGET_LOCK, "utf8").trim() === String(process.pid)) {
      unlinkSync(WIDGET_LOCK);
    }
  } catch { /* ignore */ }
  _lockOwned = false;
}

// ── rate helpers ──────────────────────────────────────────────────────────────

function getActiveSources(panels: string[]): Set<string> {
  const sources = new Set<string>();
  for (const id of panels) {
    for (const src of (PANEL_REGISTRY[id]?.sources ?? [])) sources.add(src);
  }
  return sources;
}

function computeIntervals(activeSources: Set<string>, budgetPerMin: number): Map<string, number> {
  const budget = Math.max(BUDGET_MIN, Math.min(BUDGET_MAX, budgetPerMin));
  const minInterval = Math.ceil(60_000 / budget);
  const totalWeight = [...activeSources].reduce(
    (s, src) => s + (SOURCE_WEIGHTS[src] ?? 1), 0
  );
  const map = new Map<string, number>();
  for (const src of activeSources) {
    const reqPerMin = ((SOURCE_WEIGHTS[src] ?? 1) / totalWeight) * budget;
    map.set(src, Math.max(minInterval, Math.round(60_000 / reqPerMin)));
  }
  return map;
}

function plog(msg: string) {
  const ts = new Date().toISOString();
  try { appendFileSync(STATS_LOG, `[${ts}] ${msg}\n`); } catch { /* ignore */ }
}

export function startPriceWidget(
  ctx:               ExtensionContext,
  getWallet:         () => string | undefined,
  getPanels:         () => string[],
  getBudget:         () => number,
  getTimezone:       () => string,
  getTimeFormat:     () => "24h" | "12h",
  getBillingInterval: () => number,
): void {
  plog(`startPriceWidget called — hasUI=${ctx.hasUI}`);
  if (!ctx.hasUI) return;

  ctx.ui.setWidget(
    STATS_WIDGET_KEY,
    (tui, theme) => {
      plog("widget factory invoked");

      // ── data state ────────────────────────────────────────────────────────
      let metrics:  MetricsData  | null = null;
      let wallet:   WalletData   | null = null;
      let social:   SocialData   | null = null;
      let markets:  MarketsData  | null = null;
      let live:     LiveData     | null = null;
      let billing:  BillingData  | null = null;
      let lastWalletAddr: string | undefined;
      let disposed = false;

      // ── clock tick timer (renders every second for UTC + reset countdown) ─
      const clockTick = setInterval(() => {
        if (!disposed) tui.requestRender();
      }, 1000);

      // ── flash state (prices panel) ────────────────────────────────────────
      type Flash = "up" | "down" | null;
      let vvvFlash:       Flash = null;
      let diemFlash:      Flash = null;
      let vvvFlashTimer:  ReturnType<typeof setTimeout> | null = null;
      let diemFlashTimer: ReturnType<typeof setTimeout> | null = null;

      function setFlash(token: "vvv" | "diem", dir: Flash) {
        const isVvv = token === "vvv";
        if (isVvv) { if (vvvFlashTimer)  clearTimeout(vvvFlashTimer); }
        else       { if (diemFlashTimer) clearTimeout(diemFlashTimer); }
        if (isVvv) vvvFlash  = dir; else diemFlash  = dir;
        const t = setTimeout(() => {
          if (isVvv) vvvFlash = null; else diemFlash = null;
          if (!disposed) tui.requestRender();
        }, FLASH_MS);
        if (isVvv) vvvFlashTimer = t; else diemFlashTimer = t;
      }

      // ── billing fetcher (separate API — own timer) ────────────────────
      // The venice.ai /billing/balance endpoint is not part of venicestats.com
      // so it uses its own timer separate from the main ticker.
      async function fetchBilling() {
        const adminKey = process.env["VENICE_ADMIN_API_KEY"];
        if (!adminKey) { billing = null; return; }  // no key → no billing data
        try {
          const res = await fetch(`${VENICE_BASE_URL}/billing/balance`, {
            headers: { Authorization: `Bearer ${adminKey}` },
          });
          if (!res.ok) {
            plog(`billing error: ${res.status}`);
            return;
          }
          const d = await res.json() as any;
          billing = {
            canConsume: Boolean(d.canConsume),
            consumptionCurrency: d.consumptionCurrency ?? null,
            diemBalance: typeof d.balances?.diem === "number" ? d.balances.diem : null,
            usdBalance: typeof d.balances?.usd === "number" ? d.balances.usd : null,
            diemEpochAllocation: typeof d.diemEpochAllocation === "number" ? d.diemEpochAllocation : 0,
          };
          plog(`billing ok — DIEM=${billing.diemBalance}/${billing.diemEpochAllocation} USD=${billing.usdBalance} canConsume=${billing.canConsume}`);
          logPanels();
        } catch (err) { plog(`billing error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      // ── panel snapshot logger ─────────────────────────────────────────────
      // Renders every active panel to plain text (strips ANSI) and writes one
      // log line per panel so `tail -f ~/.pi/venice-stats.log` shows the full
      // dashboard state after each poll.
      function logPanels() {
        const noTheme = {
          fg: (_color: string, text: string) => text,
          bold: (text: string) => text,
        };
        const allData: AllData = {
          metrics, wallet, social, markets, live, billing,
          walletAddr: getWallet(),
          flash: { vvv: vvvFlash, diem: diemFlash },
        };
        for (const id of getPanels()) {
          const panel = PANEL_REGISTRY[id];
          if (!panel) continue;
          const line = panel.render(allData, noTheme, " · ");
          if (line) plog(`panel[${id}] ${line}`);
        }
      }

      // ── fetchers ──────────────────────────────────────────────────────────
      async function fetchMetrics() {
        try {
          const res = await fetch("https://venicestats.com/api/metrics");
          if (!res.ok) return;
          const d = await res.json() as any;
          if (typeof d.vvvPrice !== "number") return;
          if (metrics && d.vvvPrice  !== metrics.vvvPrice)  setFlash("vvv",  d.vvvPrice  > metrics.vvvPrice  ? "up" : "down");
          if (metrics && d.diemPrice !== metrics.diemPrice) setFlash("diem", d.diemPrice > metrics.diemPrice ? "up" : "down");
          metrics = {
            vvvPrice: d.vvvPrice, diemPrice: d.diemPrice, ethPrice: d.ethPrice ?? 0,
            priceChange24h: d.priceChange24h ?? 0, diemPriceChange24h: d.diemPriceChange24h ?? 0,
            marketCap: d.marketCap ?? 0, stakingRatio: (d.stakingRatio ?? 0) * 100,
            stakerApr: d.stakerApr ?? 0, lockRatio: (d.lockRatio ?? 0) * 100,
            mintRate: d.mintRate ?? 0, diemSupply: d.diemSupply ?? 0,
            daysUntilDiemCap: d.daysUntilDiemCap ?? 0, diemStakeRatio: d.diemStakeRatio ?? 0,
            stakingGrowth7d: d.stakingGrowth7d ?? 1, newStakers7dCount: d.newStakers7dCount ?? 0,
            cooldownVvv: d.cooldownVvv ?? 0, veniceRevenue: d.veniceRevenue ?? 0,
            burnRevenueAnnualized: d.burnRevenueAnnualized ?? 0,
            totalBurnedFromEvents: d.totalBurnedFromEvents ?? 0,
            organicBurned: d.organicBurned ?? 0, burnDeflationRate: d.burnDeflationRate ?? 0,
            emissionRate: d.emissionRate ?? 0,
          };
          plog(`metrics ok — VVV=$${d.vvvPrice?.toFixed(4)} DIEM=$${d.diemPrice?.toFixed(2)} ETH=$${d.ethPrice?.toFixed(2)}`);
          logPanels();
        } catch (err) { plog(`metrics error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      async function fetchWallet() {
        if (!getPanels().includes("wallet")) { wallet = null; return; }
        const addr = getWallet();
        if (!addr) { wallet = null; return; }
        if (addr !== lastWalletAddr) { wallet = null; lastWalletAddr = addr; }
        try {
          const res = await fetch(`https://venicestats.com/api/venetians?address=${addr}`);
          if (!res.ok) return;
          const d = await res.json() as any;
          wallet = {
            label: d.ensName ?? fmtAddr(d.address ?? addr),
            role: d.roleLabel ?? "", sizeLabel: d.sizeLabel ?? "",
            svvvBalance: d.svvvBalance ?? 0, diemStaked: d.diemStaked ?? 0,
            pendingRewards: d.pendingRewards ?? 0,
            rank: d.rank ?? 0, totalVenetians: d.totalVenetians ?? 0,
          };
          plog(`wallet ok — ${wallet.label} rank #${wallet.rank} sVVV=${wallet.svvvBalance.toFixed(0)} pending=${wallet.pendingRewards.toFixed(2)}`);
          logPanels();
        } catch (err) { plog(`wallet error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      async function fetchSocial() {
        if (!getPanels().includes("social")) return;
        try {
          const res = await fetch("https://venicestats.com/api/social");
          if (!res.ok) return;
          const d = await res.json() as any;
          social = {
            erikFollowers: d.erikFollowers ?? 0, sentimentUpPct: d.sentimentUpPct ?? 0,
            marketCapRank: d.marketCapRank ?? 0, diemMarketCapRank: d.diemMarketCapRank ?? 0,
            socialVolume: d.socialVolume ?? 0,
          };
          plog(`social ok — Erik ${social.erikFollowers} followers sentiment=${social.sentimentUpPct.toFixed(0)}% VVV#${social.marketCapRank}`);
          logPanels();
        } catch (err) { plog(`social error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      async function fetchMarkets() {
        if (!getPanels().includes("markets")) return;
        try {
          const res = await fetch("https://venicestats.com/api/markets?token=VVV&period=24h");
          if (!res.ok) return;
          const d = await res.json() as any;
          markets = { volume: d.kpis?.volume ?? 0, buyPct: d.kpis?.buyPct ?? 0, traders: d.kpis?.traders ?? 0 };
          plog(`markets ok — vol=$${markets.volume.toFixed(0)} buys=${markets.buyPct}% traders=${markets.traders}`);
          logPanels();
        } catch (err) { plog(`markets error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      async function fetchLive() {
        if (!getPanels().includes("live")) return;
        try {
          const res = await fetch("https://venicestats.com/api/live?limit=1");
          if (!res.ok) return;
          const d = await res.json() as any;
          const ev = d.events?.[0];
          if (ev) {
            live = { type: ev.type, source: ev.source, amount: ev.amount ?? 0, address: ev.address ?? "", timestamp: ev.timestamp };
            plog(`live ok — ${live.type} ${live.amount.toFixed(2)} ${live.address ? fmtAddr(live.address) : ""}`);
            logPanels();
          }
        } catch (err) { plog(`live error: ${err}`); }
        if (!disposed) tui.requestRender();
      }

      // ── dynamic single-ticker polling ─────────────────────────────────────
      // The 500ms master tick fires each fetcher only when its computed
      // interval has elapsed. Two independent scheduling groups share the tick
      // but not their rate limits:
      //
      //   1. venicestats.com sources (metrics/wallet/social/markets/live)
      //      share the req/min budget distributed by SOURCE_WEIGHTS.
      //   2. billing (venice.ai /billing/balance) uses its own fixed interval
      //      from /venice-billing-interval — a different API with a different
      //      rate limit, so it must not compete for the venicestats budget.

      const fetchFns: Record<string, () => Promise<void>> = {
        metrics: fetchMetrics,
        wallet:  fetchWallet,
        social:  fetchSocial,
        markets: fetchMarkets,
        live:    fetchLive,
        billing: fetchBilling,
      };

      const lastFetch = new Map<string, number>();

      function clampBillingMs(): number {
        return Math.max(
          BILLING_INTERVAL_MIN * 1000,
          Math.min(BILLING_INTERVAL_MAX * 1000, getBillingInterval() * 1000),
        );
      }

      // Log computed schedule then fire each active source once immediately
      const initSrcs = getActiveSources(getPanels());
      const initIntervals = computeIntervals(initSrcs, getBudget());
      const scheduleLines = [...initSrcs].map(src => {
        const ms = initIntervals.get(src) ?? 0;
        return `${src}=${(ms / 1000).toFixed(1)}s`;
      });
      plog(`venicestats schedule (budget=${getBudget()} req/min, panels=${getPanels().join(",")}): ${scheduleLines.join(" | ")}`);
      plog(`billing schedule: interval=${clampBillingMs() / 1000}s`);

      for (const src of initSrcs) {
        fetchFns[src]?.();
        lastFetch.set(src, Date.now());
      }
      // Fire billing once immediately alongside the venicestats sources
      fetchFns.billing();
      lastFetch.set("billing", Date.now());

      const ticker = setInterval(() => {
        if (disposed) return;
        const now        = Date.now();
        const activeSrcs = getActiveSources(getPanels());
        const intervals  = computeIntervals(activeSrcs, getBudget());

        // venicestats sources — budget-driven
        for (const src of activeSrcs) {
          const due = (lastFetch.get(src) ?? 0) + (intervals.get(src) ?? Math.ceil(60_000 / getBudget()));
          if (now >= due) {
            lastFetch.set(src, now);
            fetchFns[src]?.();
          }
        }

        // billing — independent interval, live-reconfigurable via getBillingInterval()
        const billingDue = (lastFetch.get("billing") ?? 0) + clampBillingMs();
        if (now >= billingDue) {
          lastFetch.set("billing", now);
          fetchFns.billing();
        }
      }, TICK_MS);

      // ── component ─────────────────────────────────────────────────────────
      return {
        invalidate() {},

        render(width: number): string[] {
          const sep: string = theme.fg("dim", "  ·  ");
          const allData: AllData = {
            metrics, wallet, social, markets, live, billing,
            walletAddr: getWallet(),
            flash: { vvv: vvvFlash, diem: diemFlash },
          };
          const rows: string[] = [];
          for (const id of getPanels()) {
            const panel = PANEL_REGISTRY[id];
            if (!panel) continue;
            const line = panel.render(allData, theme as any, sep);
            if (line) rows.push(line);
          }

          // Always render the clock overlay (right-aligned on the first row)
          const clockStr = renderClock(theme, getTimezone(), getTimeFormat(), billing);
          const clockWidth = visibleWidth(clockStr);
          const minPadding = 2;

          if (rows.length > 0) {
            // Append clock to right side of first row
            const firstRow = rows[0];
            const firstRowWidth = visibleWidth(firstRow);
            const totalNeeded = firstRowWidth + minPadding + clockWidth;

            if (totalNeeded <= width) {
              // Both fit — pad to right-align the clock
              const padding = " ".repeat(width - firstRowWidth - clockWidth);
              rows[0] = firstRow + padding + clockStr;
            } else {
              // Not enough room for both — truncate first row to make space
              const availForFirst = width - minPadding - clockWidth;
              if (availForFirst > 10) {
                rows[0] = truncateToWidth(firstRow, availForFirst, "") + " ".repeat(minPadding) + clockStr;
              }
              // If terminal is too narrow for anything meaningful, leave first row as-is
            }
          } else {
            // No panel rows yet — clock is the only row, right-aligned
            if (clockWidth < width) {
              rows.push(" ".repeat(width - clockWidth) + clockStr);
            } else {
              rows.push(clockStr);
            }
          }

          return rows;
        },

        dispose() {
          plog("dispose() called");
          disposed = true;
          clearInterval(ticker);
          clearInterval(clockTick);
          if (vvvFlashTimer)  clearTimeout(vvvFlashTimer);
          if (diemFlashTimer) clearTimeout(diemFlashTimer);
        },
      };
    },
    { placement: "belowEditor" },
  );
  plog("setWidget call returned");
}

export function stopPriceWidget(ctx: ExtensionContext): void {
  plog("stopPriceWidget called");
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(STATS_WIDGET_KEY, undefined);
}

export function updateStatus(ctx: ExtensionContext, state: VeniceState) {
  if (!ctx.hasUI) return;

  const activeJobs = Object.values(state.videoJobs).filter(
    (job) => job.status === "queued" || job.status === "processing",
  ).length;
  const textCount = state.models.filter((model) => model.family === "text").length;
  const statusLabel =
    state.config.lastRefreshStatus === "ok"
      ? "online"
      : state.config.lastRefreshStatus === "error"
        ? "degraded"
        : "loading";
  const notActionable = getEnabledButNotActionableFamilies(state).length;

  ctx.ui.setStatus(
    "venice",
    `Venice ${statusLabel} · ${textCount} text · ${state.models.length} total · ${activeJobs} jobs${notActionable ? ` · ${notActionable} future` : ""}`,
  );
}

export function notify(
  ctx: ExtensionContext,
  message: string,
  kind: "info" | "success" | "error" = "info",
) {
  if (!ctx.hasUI) return;

  ctx.ui.notify(message, kind === "success" ? "info" : kind);
}
