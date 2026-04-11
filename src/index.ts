import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// import { applyExtensionDefaults } from "../themeMap.ts";
import { registerVeniceCommands } from "./commands.ts";
import { notify, startPriceWidget, stopPriceWidget, tryAcquireWidgetLock, releaseWidgetLock } from "./helpers.ts";
import { DEFAULT_PANELS, detectTimezone } from "./panels.ts";
import { createVeniceRuntime } from "./runtime.ts";
import { registerVeniceTools } from "./tools/index.ts";

export default function (pi: ExtensionAPI) {
  const runtime = createVeniceRuntime(pi);

  // Eagerly register provider with cached models during extension loading.
  // This ensures Venice models are available when pi resolves its initial
  // model scope, before the async session_start event fires.
  runtime.eagerRegisterProvider();

  registerVeniceCommands(pi, runtime);
  registerVeniceTools(pi, runtime);

  const restoreAndUpdate = async (ctx: any) => {
    // applyExtensionDefaults(import.meta.url, ctx);
    runtime.restoreState(ctx);
  };

  pi.on("session_start", async (event: any, ctx) => {
    await restoreAndUpdate(ctx);

    // Start the live price widget once per session — never in session_tree
    // so the polling interval isn't torn down on every conversation change.
    // Acquire a PID-file lock so only one pi session polls venicestats.com
    // at a time (60 req/min per-IP limit).
    if (tryAcquireWidgetLock()) {
      startPriceWidget(
        ctx,
        () => runtime.getState().config.walletAddress ?? process.env["VENICE_WALLET"],
        () => runtime.getState().config.widgetPanels ?? DEFAULT_PANELS,
        () => runtime.getState().config.widgetBudget ?? 30,
        () => runtime.getState().config.widgetTimezone ?? detectTimezone(),
        () => runtime.getState().config.widgetTimeFormat ?? "24h",
        () => runtime.getState().config.billingInterval ?? 30,
      );
    } else {
      notify(
        ctx,
        "Venice stats widget skipped — another pi session is already polling venicestats.com.\n" +
        "To enable it here, close the other session first.\n" +
        "Run /venice-panel reset in the active session to restore the default panels.",
        "info",
      );
    }

    const reason = event?.reason;
    const shouldRefreshCatalog =
      reason === undefined || reason === "startup" || reason === "reload";

    if (!shouldRefreshCatalog) return;

    try {
      await runtime.refreshModels(ctx, true);
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
      notify(
        ctx,
        `Venice model refresh failed: ${runtime.getState().config.lastError}`,
        "error",
      );
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    releaseWidgetLock();
    stopPriceWidget(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    await restoreAndUpdate(ctx);
  });
}
