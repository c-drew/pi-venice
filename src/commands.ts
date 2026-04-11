import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { PANEL_REGISTRY, PANEL_IDS, DEFAULT_PANELS } from "./panels.ts";

import {
  DEFAULTABLE_FAMILIES,
  FILTER_FAMILIES,
  IMPLEMENTED_PROVIDER_FAMILIES,
  IMPLEMENTED_TOOL_FAMILIES,
  USER_CONFIGURABLE_FAMILIES,
} from "./constants.ts";
import {
  buildModelListing,
  buildStatusSummary,
  getEnabledButNotActionableFamilies,
  isDefaultableFamily,
  isUserConfigurableFamily,
  notify,
  pickDefaultModel,
} from "./helpers.ts";
import type { DefaultableFamily } from "./types.ts";
import type { VeniceRuntime } from "./runtime.ts";

export function registerVeniceCommands(pi: ExtensionAPI, runtime: VeniceRuntime) {
  pi.registerCommand("venice-refresh-models", {
    description: "Fetch Venice model catalog and re-register the Venice text provider",
    handler: async (_args, ctx) => {
      try {
        await runtime.refreshModels(ctx);
        notify(ctx, `Venice models refreshed: ${runtime.getState().models.length} total`, "success");
      } catch (error: any) {
        runtime.setState({
          ...runtime.getState(),
          config: {
            ...runtime.getState().config,
            lastRefreshStatus: "error",
            lastError: error?.message ?? String(error),
          },
        });
        runtime.saveState();
        runtime.updateStatus(ctx);
        notify(ctx, `Venice refresh failed: ${runtime.getState().config.lastError}`, "error");
      }
    },
  });

  pi.registerCommand("venice-status", {
    description: "Show Venice provider status, defaults, model counts, and future families",
    handler: async (_args, ctx) => {
      notify(ctx, buildStatusSummary(runtime.getState()), "info");
      runtime.updateStatus(ctx);
    },
  });

  pi.registerCommand("venice-models", {
    description: "Show Venice models: /venice-models [family|all] [limit]",
    handler: async (args, ctx) => {
      const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const family =
        parts[0] && (FILTER_FAMILIES as readonly string[]).includes(parts[0])
          ? parts[0]
          : "all";
      const limit = parts[1] ? Number(parts[1]) || 40 : 40;
      const listing = buildModelListing(runtime.getState().models, family, limit);
      notify(ctx, listing.text, "info");
    },
  });

  pi.registerCommand("venice-defaults", {
    description:
      "Show or set Venice default models: /venice-defaults or /venice-defaults <text|image|edit|upscale|video> <model-id|none>",
    handler: async (args, ctx) => {
      const state = runtime.getState();
      const parts = (args ?? "").trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        const summary = DEFAULTABLE_FAMILIES.map((family) => {
          return `${family}: ${pickDefaultModel(state, family) ?? "none"}`;
        }).join("\n");
        notify(ctx, summary, "info");
        return;
      }

      if (parts.length < 2 || !isDefaultableFamily(parts[0])) {
        notify(
          ctx,
          "Usage: /venice-defaults <text|image|edit|upscale|video> <model-id|none>",
          "error",
        );
        return;
      }

      const family = parts[0] as DefaultableFamily;
      const modelId = parts.slice(1).join(" ");
      if (modelId === "none") {
        delete state.config.defaults[family];
      } else if (
        !state.models.some((model) => model.family === family && model.id === modelId)
      ) {
        notify(ctx, `Unknown Venice ${family} model: ${modelId}`, "error");
        return;
      } else {
        state.config.defaults[family] = modelId;
      }

      runtime.setState({ ...state, config: { ...state.config, defaults: { ...state.config.defaults } } });
      runtime.saveState();
      runtime.registerProvider();
      runtime.updateStatus(ctx);
      notify(
        ctx,
        `Venice default ${family}: ${pickDefaultModel(runtime.getState(), family) ?? "none"}`,
        "success",
      );
    },
  });

  pi.registerCommand("venice-families", {
    description:
      "Show or set enabled Venice catalog families: /venice-families or /venice-families text,image,embedding,video or /venice-families all",
    handler: async (args, ctx) => {
      const raw = (args ?? "").trim();
      if (!raw) {
        const future = getEnabledButNotActionableFamilies(runtime.getState());
        notify(
          ctx,
          [
            `Enabled Venice catalog families: ${runtime.getState().config.enabledCatalogFamilies.join(", ")}`,
            `Implemented provider families: ${IMPLEMENTED_PROVIDER_FAMILIES.join(", ")}`,
            `Implemented tool families: ${IMPLEMENTED_TOOL_FAMILIES.join(", ")}`,
            `Enabled but not actionable yet: ${future.length ? future.join(", ") : "none"}`,
          ].join("\n"),
          "info",
        );
        return;
      }

      const parsed = raw
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      const nextFamilies = parsed.includes("all")
        ? [...USER_CONFIGURABLE_FAMILIES]
        : parsed.filter((item): item is Exclude<typeof USER_CONFIGURABLE_FAMILIES[number], never> =>
            isUserConfigurableFamily(item),
          );

      if (nextFamilies.length === 0) {
        notify(
          ctx,
          `No valid families provided. Use any of: ${USER_CONFIGURABLE_FAMILIES.join(", ")}`,
          "error",
        );
        return;
      }

      runtime.setState({
        ...runtime.getState(),
        config: {
          ...runtime.getState().config,
          enabledCatalogFamilies: nextFamilies,
        },
      });
      runtime.saveState();
      runtime.registerProvider();
      runtime.updateStatus(ctx);

      const future = getEnabledButNotActionableFamilies(runtime.getState());
      notify(
        ctx,
        `Enabled Venice catalog families: ${runtime.getState().config.enabledCatalogFamilies.join(", ")}${future.length ? `\nEnabled but not actionable yet: ${future.join(", ")}` : ""}`,
        "success",
      );
    },
  });

  pi.registerCommand("venice-panels", {
    description: "List all available dashboard panels with their descriptions and enabled status.",
    handler: async (_args, ctx) => {
      const enabled = runtime.getState().config.widgetPanels ?? DEFAULT_PANELS;
      const lines = PANEL_IDS.map((id) => {
        const panel = PANEL_REGISTRY[id];
        const idx   = enabled.indexOf(id);
        const status = idx >= 0 ? `[${idx + 1}] enabled` : "disabled";
        return `${status.padEnd(12)} ${panel.id.padEnd(12)} ${panel.label.padEnd(10)}  ${panel.description}`;
      });
      notify(ctx,
        `Venice dashboard panels\n\nUse /venice-panel add|remove|move|reset to configure.\n\n` +
        lines.join("\n"),
        "info"
      );
    },
  });

  pi.registerCommand("venice-panel", {
    description: "Manage dashboard panels: add <id> | remove <id> | move <id> up|down | reset",
    handler: async (args, ctx) => {
      const parts  = (args ?? "").trim().split(/\s+/).filter(Boolean);
      const action = parts[0];
      const state  = runtime.getState();
      const current = [...(state.config.widgetPanels ?? DEFAULT_PANELS)];

      const save = (panels: string[]) => {
        runtime.setState({ ...state, config: { ...state.config, widgetPanels: panels } });
        runtime.saveState();
      };

      if (action === "reset") {
        save([...DEFAULT_PANELS]);
        notify(ctx, `Dashboard reset to defaults: ${DEFAULT_PANELS.join(", ")}`, "success");
        return;
      }

      if (action === "add") {
        const id = parts[1];
        if (!id || !PANEL_REGISTRY[id]) {
          notify(ctx, `Unknown panel "${id ?? ""}". Run /venice-panels to see available panels.`, "error");
          return;
        }
        if (current.includes(id)) {
          notify(ctx, `Panel "${id}" is already enabled.`, "info");
          return;
        }
        save([...current, id]);
        notify(ctx, `Panel "${id}" added. Dashboard: ${[...current, id].join(", ")}`, "success");
        return;
      }

      if (action === "remove") {
        const id = parts[1];
        if (!id || !current.includes(id)) {
          notify(ctx, `Panel "${id ?? ""}" is not enabled.`, "error");
          return;
        }
        const next = current.filter((p) => p !== id);
        save(next);
        notify(ctx, `Panel "${id}" removed. Dashboard: ${next.join(", ") || "(empty)"}`, "success");
        return;
      }

      if (action === "move") {
        const id  = parts[1];
        const dir = parts[2];
        const idx = current.indexOf(id);
        if (!id || idx < 0) {
          notify(ctx, `Panel "${id ?? ""}" is not enabled.`, "error");
          return;
        }
        if (dir !== "up" && dir !== "down") {
          notify(ctx, `Usage: /venice-panel move <id> up|down`, "error");
          return;
        }
        const next = [...current];
        const swap = dir === "up" ? idx - 1 : idx + 1;
        if (swap < 0 || swap >= next.length) {
          notify(ctx, `"${id}" is already at the ${dir === "up" ? "top" : "bottom"}.`, "info");
          return;
        }
        [next[idx], next[swap]] = [next[swap], next[idx]];
        save(next);
        notify(ctx, `Moved "${id}" ${dir}. Dashboard: ${next.join(", ")}`, "success");
        return;
      }

      notify(ctx,
        `Usage: /venice-panel add <id> | remove <id> | move <id> up|down | reset\nRun /venice-panels to see all panels.`,
        "info"
      );
    },
  });

  pi.registerCommand("venice-wallet", {
    description: "Show or set your wallet address for the stats widget: /venice-wallet [0x...] or /venice-wallet clear",
    handler: async (args, ctx) => {
      const addr = (args ?? "").trim();

      if (!addr) {
        const current = runtime.getState().config.walletAddress ?? process.env["VENICE_WALLET"];
        notify(ctx, current ? `Wallet: ${current}` : "No wallet set. Use /venice-wallet <0x...>", "info");
        return;
      }

      if (addr === "clear") {
        runtime.setState({ ...runtime.getState(), config: { ...runtime.getState().config, walletAddress: undefined } });
        runtime.saveState();
        notify(ctx, "Wallet cleared.", "info");
        return;
      }

      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        notify(ctx, "Invalid address — must be 0x followed by 40 hex chars.", "error");
        return;
      }

      runtime.setState({ ...runtime.getState(), config: { ...runtime.getState().config, walletAddress: addr } });
      runtime.saveState();
      notify(ctx, `Wallet set: ${addr}`, "success");
    },
  });

  pi.registerCommand("venice-budget", {
    description: "Show or set the stats widget polling budget (1–59 req/min, default 30): /venice-budget [1-59|reset]",
    handler: async (args, ctx) => {
      const raw = (args ?? "").trim();
      const BUDGET_DEFAULT = 30;
      const BUDGET_MIN = 1;
      const BUDGET_MAX = 59;

      if (!raw) {
        const current = runtime.getState().config.widgetBudget ?? BUDGET_DEFAULT;
        notify(ctx, `Stats widget polling budget: ${current} req/min (range: ${BUDGET_MIN}–${BUDGET_MAX}, default: ${BUDGET_DEFAULT})`, "info");
        return;
      }

      if (raw === "reset") {
        runtime.setState({ ...runtime.getState(), config: { ...runtime.getState().config, widgetBudget: undefined } });
        runtime.saveState();
        notify(ctx, `Polling budget reset to default (${BUDGET_DEFAULT} req/min).`, "success");
        return;
      }

      const n = Number(raw);
      if (!Number.isInteger(n) || n < BUDGET_MIN || n > BUDGET_MAX) {
        notify(ctx, `Invalid budget "${raw}". Provide a whole number between ${BUDGET_MIN} and ${BUDGET_MAX}.`, "error");
        return;
      }

      runtime.setState({ ...runtime.getState(), config: { ...runtime.getState().config, widgetBudget: n } });
      runtime.saveState();
      notify(ctx, `Polling budget set to ${n} req/min. Takes effect on the next tick.`, "success");
    },
  });
}
