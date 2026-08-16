// TideGauge 潮汐计 — node half (host entry).
//
// A usage & billing engine for the DeepSeek Harness web surface. It:
//  1. auto-discovers every configured LLM provider (deepseek-official, pi-ai
//     routes, OpenAI-compatible gateways) and their models via ctx.llm;
//  2. fetches and caches per-provider account balance (DeepSeek has a built-in
//     rule; other providers use a config-driven `providers` list);
//  3. passes a config-driven per-model pricing table through for client-side
//     cost estimation.
//
// Everything is served from one route, /tide-gauge/state. Balance is fetched
// server-side (the API key never leaves the host). No imports on purpose: a
// plain Cordis function plugin over Node globals, so an out-of-tree `link:`
// install needs no dependency resolution.

const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";

export const name = "tide-gauge";
export const inject = ["webServer"];

export function apply(ctx, config = {}) {
  const webServer = ctx.get("webServer");
  const llm = ctx.get("llm");
  if (webServer === undefined) return;

  // Balance rules: the built-in DeepSeek rule plus any providers the profile's
  // cordis.patch.yml adds. A provider rule: { provider, label?, kind:
  // 'deepseek'|'openai-compatible', balanceUrl?, currency?, apiKeyEnv?,
  // refreshMs? }.
  const rules = [
    {
      provider: "deepseek-official",
      label: "DeepSeek 官方",
      kind: "deepseek",
      balanceUrl: DEEPSEEK_BALANCE_URL,
      currency: "CNY",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      refreshMs: 300000
    },
    ...(Array.isArray(config.providers) ? config.providers : [])
  ];

  // Per-model pricing table from config: { "<modelId>": { label?, provider?,
  // currency?, inputPer1M, outputPer1M, cacheReadPer1M? } } — prices are per
  // one million tokens.
  const pricing = config.pricing && typeof config.pricing === "object" ? config.pricing : {};

  const cache = new Map();

  async function resolveKey(apiKeyEnv) {
    if (!apiKeyEnv) return "";
    const credentials = ctx.get("credentials");
    if (credentials && typeof credentials.resolve === "function") {
      try {
        const resolved = await credentials.resolve(apiKeyEnv);
        if (resolved && resolved.value) return resolved.value;
      } catch (_error) {
        /* fall through to the environment */
      }
    }
    return typeof process !== "undefined" && process.env ? process.env[apiKeyEnv] || "" : "";
  }

  async function fetchOne(rule, now) {
    const refreshMs = typeof rule.refreshMs === "number" ? rule.refreshMs : 300000;
    const base = {
      status: "unavailable",
      currency: rule.currency || "",
      totalBalance: "",
      grantedBalance: "",
      toppedUpBalance: "",
      refreshedAt: now,
      nextRefreshAt: now + refreshMs,
      error: ""
    };
    const key = await resolveKey(rule.apiKeyEnv);
    if (!key || !rule.balanceUrl) return base;
    try {
      const res = await fetch(rule.balanceUrl, { headers: { Authorization: "Bearer " + key } });
      if (!res.ok) return { ...base, status: "error", error: "HTTP " + res.status };
      const data = await res.json();
      if (rule.kind === "deepseek") {
        const info = data && Array.isArray(data.balance_infos) ? data.balance_infos[0] : null;
        if (info) {
          return {
            ...base,
            status: "ok",
            currency: String(info.currency ?? rule.currency ?? ""),
            totalBalance: String(info.total_balance ?? ""),
            grantedBalance: String(info.granted_balance ?? ""),
            toppedUpBalance: String(info.topped_up_balance ?? "")
          };
        }
        return { ...base, status: "error", error: "no balance_infos" };
      }
      // openai-compatible / generic gateway: best-effort field mapping.
      const total = data && (data.totalBalance ?? data.total_balance ?? data.total ?? data.balance ?? data.credits ?? "");
      const currency = data && (data.currency ?? rule.currency ?? "");
      return {
        ...base,
        status: total === "" ? "error" : "ok",
        totalBalance: String(total ?? ""),
        currency: String(currency ?? ""),
        error: total === "" ? "unrecognized balance shape" : ""
      };
    } catch (error) {
      return {
        ...base,
        status: "error",
        error: String(error && error.message ? error.message : error)
      };
    }
  }

  async function cachedBalance(rule, now) {
    const cached = cache.get(rule.provider);
    if (cached && now < cached.nextRefreshAt) return cached.report;
    const report = await fetchOne(rule, now);
    cache.set(rule.provider, { report, nextRefreshAt: report.nextRefreshAt });
    return report;
  }

  async function discoverProviders() {
    const found = new Map();
    if (llm) {
      // Live, registered provider routes.
      if (typeof llm.listProviders === "function") {
        for (const p of llm.listProviders()) {
          found.set(p.id, { provider: p.id, label: p.name || p.id, models: [] });
        }
      }
      // Dormant / configurable routes (pi-ai profiles, gateways not yet active).
      if (typeof llm.listConfigurableProviders === "function") {
        for (const c of llm.listConfigurableProviders()) {
          if (!found.has(c.provider)) {
            found.set(c.provider, { provider: c.provider, label: c.displayName || c.provider, models: [] });
          }
        }
      }
      // Models per live provider (advisory catalog; may be empty).
      if (typeof llm.listModels === "function") {
        for (const id of [...found.keys()]) {
          try {
            const models = await llm.listModels(id);
            found.get(id).models = (models || []).map((m) => ({ id: m.id, name: m.name || m.id }));
          } catch (_error) {
            /* models are advisory; leave empty */
          }
        }
      }
    }
    return found;
  }

  async function state() {
    const now = Date.now();
    const discovered = await discoverProviders();
    const ruleOf = (provider) => rules.find((r) => r.provider === provider);

    // Every configured balance rule that is not yet known from the LLM registry.
    for (const rule of rules) {
      if (!discovered.has(rule.provider)) {
        discovered.set(rule.provider, { provider: rule.provider, label: rule.label || rule.provider, models: [] });
      }
    }

    const providers = [];
    for (const d of discovered.values()) {
      const rule = ruleOf(d.provider);
      const balance = rule ? await cachedBalance(rule, now) : null;
      providers.push({
        provider: d.provider,
        label: rule && rule.label ? rule.label : d.label,
        models: d.models,
        balance
      });
    }

    return { providers, pricing, refreshedAt: now };
  }

  ctx.effect(
    () =>
      webServer.register({
        kind: "prefix",
        path: "/tide-gauge",
        handler: async (req, res) => {
          const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
          if (pathname !== "/tide-gauge/state" && pathname !== "/tide-gauge/balance") {
            res.writeHead(404);
            res.end();
            return;
          }
          if (req.method !== "GET" && req.method !== "HEAD") {
            res.writeHead(405);
            res.end();
            return;
          }
          const body = JSON.stringify(await state());
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-cache"
          });
          res.end(body);
        }
      }),
    "tide-gauge: state route"
  );
}
