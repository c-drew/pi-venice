/**
 * Venice stats widget panel registry.
 *
 * Each panel is a named row in the belowEditor widget. Users enable/disable
 * panels with /venice-panel add|remove|reset and reorder with /venice-panel move.
 *
 * Adding a new panel:
 *   1. Add a key to PANEL_REGISTRY with id, label, description, and render().
 *   2. If it needs data beyond /api/metrics, add a `source` entry to DATA_SOURCES
 *      and handle the fetch in startPriceWidget() in helpers.ts.
 *   3. That's it — commands and persistence are automatic.
 */

// ---------------------------------------------------------------------------
// Data snapshot types (populated by widget fetchers in helpers.ts)
// ---------------------------------------------------------------------------

export interface MetricsData {
  vvvPrice: number;
  diemPrice: number;
  ethPrice: number;
  priceChange24h: number;
  diemPriceChange24h: number;
  marketCap: number;
  stakingRatio: number;
  stakerApr: number;
  lockRatio: number;
  mintRate: number;
  diemSupply: number;
  daysUntilDiemCap: number;
  diemStakeRatio: number;
  stakingGrowth7d: number;
  newStakers7dCount: number;
  cooldownVvv: number;
  veniceRevenue: number;
  burnRevenueAnnualized: number;
  totalBurnedFromEvents: number;
  organicBurned: number;
  burnDeflationRate: number;
  emissionRate: number;
}

export interface WalletData {
  label: string;
  role: string;
  sizeLabel: string;
  svvvBalance: number;
  diemStaked: number;
  pendingRewards: number;
  rank: number;
  totalVenetians: number;
}

export interface SocialData {
  erikFollowers: number;
  sentimentUpPct: number;
  marketCapRank: number;
  diemMarketCapRank: number;
  socialVolume: number;
}

export interface MarketsData {
  volume: number;
  buyPct: number;
  traders: number;
}

export interface LiveData {
  type: string;
  source: string;
  amount: number;
  address: string;
  timestamp: string;
}

export interface AllData {
  metrics: MetricsData | null;
  wallet: WalletData | null;
  walletAddr: string | undefined;
  social: SocialData | null;
  markets: MarketsData | null;
  live: LiveData | null;
  flash: { vvv: "up" | "down" | null; diem: "up" | "down" | null };
}

// ---------------------------------------------------------------------------
// Thin theme duck-type (avoids importing the full Theme class)
// ---------------------------------------------------------------------------

export interface MiniTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

export function fmtUSD(n: number, decimals = 2): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(decimals)}`;
}

export function fmtPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function fmtAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function fmtAge(ts: string): string {
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

// ---------------------------------------------------------------------------
// Panel definition type
// ---------------------------------------------------------------------------

/**
 * Data source keys and their relative polling weights.
 * Higher weight = larger share of the 50 req/min budget.
 * These are used by helpers.ts to compute per-source intervals dynamically.
 */
export const SOURCE_WEIGHTS: Record<string, number> = {
  metrics: 10, // backbone — prices + all protocol KPIs
  live:     5, // real-time on-chain events
  markets:  2, // DEX aggregates
  wallet:   1, // Venetian wallet data (changes slowly)
  social: 0.5, // social signals (changes very slowly)
};

export interface PanelDef {
  id: string;
  label: string;
  /** One-line description shown in /venice-panels list */
  description: string;
  /**
   * All data sources this panel needs. Must be keys of SOURCE_WEIGHTS.
   * The widget uses this to compute which sources to poll and at what rate.
   */
  sources: Array<keyof typeof SOURCE_WEIGHTS>;
  /**
   * Render to a single terminal line. Return null to hide the row (e.g. data not
   * yet loaded). The sep helper produces the themed mid-dot separator.
   */
  render(data: AllData, theme: MiniTheme, sep: string): string | null;
}

// ---------------------------------------------------------------------------
// Panel registry — add new panels here
// ---------------------------------------------------------------------------

export const PANEL_REGISTRY: Record<string, PanelDef> = {

  // ── prices ────────────────────────────────────────────────────────────────
  prices: {
    id: "prices",
    label: "Prices",
    description: "VVV + DIEM spot prices with 24h % change and ETH. Prices flash green/red on tick.",
    sources: ["metrics"],
    render({ metrics, flash }, theme, sep) {
      if (!metrics) return null;
      const vvvColor  = flash.vvv  === "up" ? "success" : flash.vvv  === "down" ? "error" : "text";
      const diemColor = flash.diem === "up" ? "success" : flash.diem === "down" ? "error" : "text";
      const vvvChg    = metrics.priceChange24h  >= 0 ? "success" : "error";
      const diemChg   = metrics.diemPriceChange24h >= 0 ? "success" : "error";
      return (
        theme.fg("dim",    "VVV ")  +
        theme.fg(vvvColor, `$${metrics.vvvPrice.toFixed(4)}`) +
        theme.fg(vvvChg,   ` ${fmtPct(metrics.priceChange24h)} 24h`) +
        sep +
        theme.fg("dim",     "DIEM ") +
        theme.fg(diemColor, `$${metrics.diemPrice.toFixed(2)}`) +
        theme.fg(diemChg,   ` ${fmtPct(metrics.diemPriceChange24h)} 24h`) +
        sep +
        theme.fg("dim",  "ETH ") + theme.fg("text", `$${metrics.ethPrice.toFixed(2)}`)
      );
    },
  },

  // ── protocol ─────────────────────────────────────────────────────────────
  protocol: {
    id: "protocol",
    label: "Protocol",
    description: "Market cap, staking ratio, staker APR, and sVVV lock ratio.",
    sources: ["metrics"],
    render({ metrics }, theme, sep) {
      if (!metrics) return null;
      return (
        theme.fg("dim",  "MCap ")   + theme.fg("text", fmtUSD(metrics.marketCap)) +
        sep +
        theme.fg("dim",  "Staked ") + theme.fg("text", `${metrics.stakingRatio.toFixed(1)}%`) +
        theme.fg("dim",  " @ ")     + theme.fg("text", `${metrics.stakerApr.toFixed(1)}% APR`) +
        sep +
        theme.fg("dim",  "Locked ") + theme.fg("text", `${metrics.lockRatio.toFixed(1)}%`)
      );
    },
  },

  // ── wallet ────────────────────────────────────────────────────────────────
  wallet: {
    id: "wallet",
    label: "Wallet",
    description: "Your Venetian: sVVV staked, DIEM staked, pending rewards, role and rank. Set address with /venice-wallet <0x…>.",
    sources: ["wallet"] as Array<keyof typeof SOURCE_WEIGHTS>,
    render({ wallet, walletAddr }, theme, sep) {
      if (!walletAddr) {
        return theme.fg("dim", "Wallet: /venice-wallet <0x…> or VENICE_WALLET=0x…");
      }
      if (!wallet) {
        return theme.fg("dim", `Loading ${fmtAddr(walletAddr)}…`);
      }
      return (
        theme.fg("accent", wallet.label) +
        (wallet.role      ? theme.fg("dim", `  ${wallet.role}`)      : "") +
        (wallet.sizeLabel ? theme.fg("dim", ` ${wallet.sizeLabel}`)  : "") +
        sep +
        theme.fg("dim", "sVVV ")         + theme.fg("text", fmtK(wallet.svvvBalance)) +
        sep +
        theme.fg("dim", "DIEM staked ")  + theme.fg("text", wallet.diemStaked.toFixed(2)) +
        sep +
        theme.fg("dim", "Pending ")      + theme.fg("success", `${wallet.pendingRewards.toFixed(2)} VVV`) +
        sep +
        theme.fg("dim", "Rank #")        + theme.fg("text", String(wallet.rank)) +
        theme.fg("dim", `/${fmtK(wallet.totalVenetians)}`)
      );
    },
  },

  // ── diem ─────────────────────────────────────────────────────────────────
  diem: {
    id: "diem",
    label: "DIEM",
    description: "DIEM supply, daily mint rate, days until cap, and stake ratio.",
    sources: ["metrics"],
    render({ metrics }, theme, sep) {
      if (!metrics) return null;
      return (
        theme.fg("dim",  "Supply ")    + theme.fg("text", fmtK(metrics.diemSupply)) +
        sep +
        theme.fg("dim",  "Mint ")      + theme.fg("text", `${metrics.mintRate.toFixed(0)}/day`) +
        sep +
        theme.fg("dim",  "Cap in ")    + theme.fg("text", `${metrics.daysUntilDiemCap}d`) +
        sep +
        theme.fg("dim",  "Staked ")    + theme.fg("text", `${(metrics.diemStakeRatio * 100).toFixed(1)}%`)
      );
    },
  },

  // ── social ────────────────────────────────────────────────────────────────
  social: {
    id: "social",
    label: "Social",
    description: "Erik Voorhees followers, CoinGecko sentiment %, VVV + DIEM market cap ranks.",
    sources: ["social"] as Array<keyof typeof SOURCE_WEIGHTS>,
    render({ social }, theme, sep) {
      if (!social) return null;
      const sentColor = social.sentimentUpPct >= 50 ? "success" : "error";
      return (
        theme.fg("dim",      "Erik ")       + theme.fg("text", fmtK(social.erikFollowers)) +
        theme.fg("dim",      " followers")  +
        sep +
        theme.fg("dim",      "Sentiment ")  + theme.fg(sentColor, `${social.sentimentUpPct.toFixed(0)}% ↑`) +
        sep +
        theme.fg("dim",      "VVV #")       + theme.fg("text", String(social.marketCapRank)) +
        sep +
        theme.fg("dim",      "DIEM #")      + theme.fg("text", String(social.diemMarketCapRank))
      );
    },
  },

  // ── burns ─────────────────────────────────────────────────────────────────
  burns: {
    id: "burns",
    label: "Burns",
    description: "Total VVV burned, organic burn volume, and annual deflation rate.",
    sources: ["metrics"],
    render({ metrics }, theme, sep) {
      if (!metrics) return null;
      return (
        theme.fg("dim",  "Burned ")   + theme.fg("text", fmtK(metrics.totalBurnedFromEvents) + " VVV") +
        sep +
        theme.fg("dim",  "Organic ")  + theme.fg("text", fmtK(metrics.organicBurned) + " VVV") +
        sep +
        theme.fg("dim",  "Deflation ") + theme.fg("text", `${metrics.burnDeflationRate.toFixed(2)}%/yr`)
      );
    },
  },

  // ── staking ───────────────────────────────────────────────────────────────
  staking: {
    id: "staking",
    label: "Staking",
    description: "New stakers (7d), 7d staking growth, and VVV currently in cooldown.",
    sources: ["metrics"],
    render({ metrics }, theme, sep) {
      if (!metrics) return null;
      const growthColor = metrics.stakingGrowth7d >= 1 ? "success" : "error";
      const growthPct   = (metrics.stakingGrowth7d - 1) * 100;
      return (
        theme.fg("dim",        "New stakers 7d ") + theme.fg("text", String(metrics.newStakers7dCount)) +
        sep +
        theme.fg("dim",        "Growth ")         + theme.fg(growthColor, fmtPct(growthPct)) +
        sep +
        theme.fg("dim",        "Cooldown ")        + theme.fg("text", `${fmtK(metrics.cooldownVvv)} VVV`)
      );
    },
  },

  // ── markets ───────────────────────────────────────────────────────────────
  markets: {
    id: "markets",
    label: "Markets",
    description: "VVV DEX 24h trading volume, buy%, and unique traders.",
    sources: ["markets"] as Array<keyof typeof SOURCE_WEIGHTS>,
    render({ markets }, theme, sep) {
      if (!markets) return null;
      const buyColor = markets.buyPct >= 50 ? "success" : "error";
      return (
        theme.fg("dim",   "Vol ")      + theme.fg("text", fmtUSD(markets.volume)) + theme.fg("dim", " 24h") +
        sep +
        theme.fg("dim",   "Buys ")     + theme.fg(buyColor, `${markets.buyPct}%`) +
        sep +
        theme.fg("dim",   "Traders ")  + theme.fg("text", fmtK(markets.traders))
      );
    },
  },

  // ── live ──────────────────────────────────────────────────────────────────
  live: {
    id: "live",
    label: "Live",
    description: "Most recent on-chain event (swap, stake, DIEM mint/burn).",
    sources: ["live"] as Array<keyof typeof SOURCE_WEIGHTS>,
    render({ live }, theme, sep) {
      if (!live) return null;
      const label = live.type.replace(/_/g, " ");
      const amt   = live.amount > 0 ? ` ${live.amount.toFixed(2)}` : "";
      const token = live.type.includes("diem") ? " DIEM" : " VVV";
      const who   = live.address ? ` ${fmtAddr(live.address)}` : "";
      return (
        theme.fg("accent", "● ") +
        theme.fg("text",   label + amt + token + who) +
        theme.fg("dim",    `  ${fmtAge(live.timestamp)}`)
      );
    },
  },

  // ── revenue ───────────────────────────────────────────────────────────────
  revenue: {
    id: "revenue",
    label: "Revenue",
    description: "Venice protocol revenue to date, annualized burn revenue, and VVV emission rate.",
    sources: ["metrics"],
    render({ metrics }, theme, sep) {
      if (!metrics) return null;
      return (
        theme.fg("dim",  "Revenue ")    + theme.fg("text", fmtUSD(metrics.veniceRevenue)) +
        sep +
        theme.fg("dim",  "Annualized ") + theme.fg("text", fmtUSD(metrics.burnRevenueAnnualized)) +
        sep +
        theme.fg("dim",  "Emission ")   + theme.fg("text", `${(metrics.emissionRate * 100).toFixed(1)}%/yr`)
      );
    },
  },

};

export const PANEL_IDS = Object.keys(PANEL_REGISTRY) as (keyof typeof PANEL_REGISTRY)[];
export const DEFAULT_PANELS: string[] = ["prices", "protocol", "wallet"];
