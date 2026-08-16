window.__ModuleLoader__.load({
  id: "dsh-tide-gauge",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");

    var inject = ["slots"];

    var el = React.createElement;

    // -------------------------------------------------------------------------
    // Formatting helpers
    // -------------------------------------------------------------------------

    function isNum(n) {
      return typeof n === "number" && Number.isFinite(n);
    }

    function fmtCompact(n) {
      if (!isNum(n)) return "—";
      if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
      if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
      if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
      return String(Math.round(n));
    }

    function fmtMs(ms) {
      if (!isNum(ms)) return "—";
      if (ms >= 60000) return (ms / 60000).toFixed(1) + " min";
      if (ms >= 1000) return (ms / 1000).toFixed(1) + " s";
      return Math.round(ms) + " ms";
    }

    function fmtTime(ms) {
      if (!isNum(ms)) return "—";
      try {
        return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      } catch (_e) {
        return String(ms);
      }
    }

    function fmtMoney(cost, currency) {
      if (!isNum(cost)) return "—";
      var n = cost < 0.001 ? cost.toFixed(6) : cost.toFixed(4);
      return n + (currency ? " " + currency : "");
    }

    function occupancyPct(num, den) {
      if (!isNum(num) || !isNum(den) || den <= 0) return null;
      return Math.max(0, Math.min(100, (num / den) * 100));
    }

    // -------------------------------------------------------------------------
    // Tiny presentational primitives (no external UI package dependency)
    // -------------------------------------------------------------------------

    function Row(props) {
      return el("div", {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          padding: "6px 0",
          borderBottom: "1px solid rgba(128, 128, 128, 0.14)"
        }
      },
        el("span", { style: { color: "var(--dsw-alias-label-secondary, #8a8a8a)", fontSize: 12 } }, props.label),
        el("span", {
          style: {
            color: "var(--dsw-alias-label-primary, #e8e8e8)",
            fontSize: 12,
            fontVariantNumeric: "tabular-nums"
          }
        }, props.value)
      );
    }

    function Section(props) {
      return el("div", { style: { marginTop: 14 } },
        el("div", {
          style: {
            fontSize: 11,
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "var(--dsw-alias-label-caption, #666)",
            marginBottom: 2
          }
        }, props.title),
        props.children
      );
    }

    function WaveIcon() {
      return el("svg", {
        width: 16,
        height: 16,
        viewBox: "0 0 24 24",
        fill: "none",
        "aria-hidden": true,
        style: { display: "block" }
      },
        el("path", {
          d: "M2 12c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          fill: "none"
        })
      );
    }

    // -------------------------------------------------------------------------
    // Cost estimation: session token usage × per-model pricing
    // -------------------------------------------------------------------------

    function computeCosts(tokenUsage, pricing) {
      var rows = [];
      if (!pricing) return rows;
      var uncached = (tokenUsage && tokenUsage.uncachedInputTokens) || 0;
      var cached = (tokenUsage && tokenUsage.cacheReadTokens) || 0;
      var out = (tokenUsage && tokenUsage.outputTokens) || 0;
      for (var modelId of Object.keys(pricing)) {
        var p = pricing[modelId] || {};
        var inputPer1M = Number(p.inputPer1M) || 0;
        var outputPer1M = Number(p.outputPer1M) || 0;
        var cacheReadPer1M = Number(p.cacheReadPer1M) || 0;
        var cost = (uncached * inputPer1M + cached * cacheReadPer1M + out * outputPer1M) / 1e6;
        rows.push({ modelId: modelId, label: p.label || modelId, currency: p.currency || "", cost: cost });
      }
      return rows;
    }

    // -------------------------------------------------------------------------
    // Balance + cost section (fetches host-side /tide-gauge/state)
    // -------------------------------------------------------------------------

    function BillingSection(props) {
      var state = React.useState({ loading: true, data: null, error: null });
      var snapshot = state[0];
      var setSnapshot = state[1];
      var refreshTick = React.useState(0);
      var tick = refreshTick[0];
      var setTick = refreshTick[1];
      var activeState = React.useState("");
      var activeProvider = activeState[0];
      var setActiveProvider = activeState[1];

      React.useEffect(function () {
        var cancelled = false;
        setSnapshot(function (prev) { return { ...prev, loading: true }; });
        fetch("/tide-gauge/state")
          .then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.json();
          })
          .then(function (data) {
            if (!cancelled) setSnapshot({ loading: false, data: data, error: null });
          })
          .catch(function (err) {
            if (!cancelled) setSnapshot({ loading: false, data: null, error: String(err && err.message ? err.message : err) });
          });
        return function () { cancelled = true; };
      }, [tick]);

      var refreshButton = el("button", {
        type: "button",
        onClick: function () { setTick(function (n) { return n + 1; }); },
        style: {
          background: "none",
          border: "1px solid var(--dsw-alias-border-l1, #2a2a2a)",
          color: "var(--dsw-alias-label-secondary, #9a9a9a)",
          cursor: "pointer",
          fontSize: 11,
          padding: "2px 8px",
          borderRadius: 6
        }
      }, "刷新");

      if (snapshot.loading) {
        return el("div", { style: { padding: "10px 0", fontSize: 12, color: "var(--dsw-alias-label-caption, #666)" } }, "余额加载中…", " ", refreshButton);
      }
      if (snapshot.error) {
        return el("div", { style: { padding: "10px 0", fontSize: 12, color: "var(--dsw-alias-state-error-primary, #d44)" } }, "余额读取失败: " + snapshot.error, " ", refreshButton);
      }

      var providers = (snapshot.data && snapshot.data.providers) || [];
      var pricing = (snapshot.data && snapshot.data.pricing) || {};

      // The host already only returns providers with a configured balance
      // endpoint; filter defensively in case an older host returns the full
      // registry (which would otherwise list every provider as "未配置").
      var balanceProviders = providers.filter(function (p) {
        return p && p.balance;
      });

      // Keep the active tab valid across refreshes.
      var current = null;
      if (balanceProviders.length > 0) {
        var found = null;
        for (var i = 0; i < balanceProviders.length; i++) {
          if (balanceProviders[i].provider === activeProvider) { found = balanceProviders[i]; break; }
        }
        current = found || balanceProviders[0];
      }

      // Provider selector: one pill per configured provider. Only rendered when
      // more than one provider is configured, so the panel stays compact.
      var tabs = null;
      if (balanceProviders.length > 1) {
        tabs = el("div", {
          style: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }
        },
          balanceProviders.map(function (p) {
            var active = current && p.provider === current.provider;
            return el("button", {
              key: p.provider,
              type: "button",
              onClick: function () { setActiveProvider(p.provider); },
              "aria-pressed": active,
              title: p.label || p.provider,
              style: {
                background: active
                  ? "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.18))"
                  : "transparent",
                border: "1px solid " + (active
                  ? "var(--dsw-alias-interactive-accent, #4a8cff)"
                  : "var(--dsw-alias-border-l1, #2a2a2a)"),
                color: active
                  ? "var(--dsw-alias-label-primary, #e8e8e8)"
                  : "var(--dsw-alias-label-secondary, #9a9a9a)",
                cursor: "pointer",
                fontSize: 11,
                padding: "3px 10px",
                borderRadius: 999
              }
            }, p.label || p.provider);
          })
        );
      }

      // Selected provider's metering (balance + refresh times).
      var balanceDetail = null;
      if (current) {
        var b = current.balance;
        var text, color;
        if (b.status === "ok") {
          text = (b.totalBalance || "0") + (b.currency ? " " + b.currency : "");
          color = "var(--dsw-alias-label-primary, #e8e8e8)";
        } else if (b.status === "error") {
          text = "错误: " + (b.error || "?");
          color = "var(--dsw-alias-state-error-primary, #d44)";
        } else {
          text = "未配置余额端点";
          color = "var(--dsw-alias-label-caption, #666)";
        }

        balanceDetail = el("div", { style: { padding: "6px 0" } },
          el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline" } },
            el("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #8a8a8a)" } }, current.label || current.provider),
            el("span", { style: { fontSize: 15, fontWeight: 600, color: color, fontVariantNumeric: "tabular-nums" } }, text)
          ),
          el("div", { style: { marginTop: 4, fontSize: 11, color: "var(--dsw-alias-label-caption, #666)" } },
            "刷新于 " + fmtTime(b.refreshedAt) + " · 下次 " + fmtTime(b.nextRefreshAt))
        );
      }

      var costRows = computeCosts(props.tokenUsage, pricing);
      var costContent = costRows.length === 0
        ? el("div", { style: { padding: "8px 0", fontSize: 12, color: "var(--dsw-alias-label-caption, #666)" } }, "在 config.pricing 里填入各模型价格后即可估算费用。")
        : costRows.map(function (r) {
            return el(Row, { key: r.modelId, label: r.label, value: fmtMoney(r.cost, r.currency) });
          });

      return el(React.Fragment, null,
        el(Section, { title: "账户余额" },
          balanceProviders.length === 0
            ? el("div", { style: { padding: "8px 0", fontSize: 12, color: "var(--dsw-alias-label-caption, #666)" } }, "未配置任何余额端点（在 config.providers 中追加）。")
            : el(React.Fragment, null, tabs, balanceDetail),
          el("div", { style: { marginTop: 8, textAlign: "right" } }, refreshButton)
        ),
        el(Section, { title: "费用估算" },
          costContent,
          costRows.length > 0 && el("div", { style: { marginTop: 8, fontSize: 11, color: "var(--dsw-alias-label-caption, #666)" } }, "费用为近似估算,以实际账单为准。")
        )
      );
    }

    // -------------------------------------------------------------------------
    // The top-right icon + right-side panel
    // -------------------------------------------------------------------------

    function TideGaugeButton(props) {
      var openState = React.useState(false);
      var open = openState[0];
      var setOpen = openState[1];

      var tokenUsage = props.useProjection("tokenUsage");
      var contextPressure = props.useProjection("contextPressure");
      var sessionStats = props.useProjection("sessionStats");

      var totalTokens = null;
      if (tokenUsage) {
        totalTokens =
          (tokenUsage.uncachedInputTokens || 0) +
          (tokenUsage.outputTokens || 0) +
          (tokenUsage.cacheReadTokens || 0) +
          (tokenUsage.cacheWriteTokens || 0);
      }

      var occupancy = null;
      if (contextPressure) {
        var pressure = contextPressure.projectedTokens ?? contextPressure.pressureTokens;
        occupancy = occupancyPct(pressure, contextPressure.contextWindow);
      }

      var button = el("button", {
        type: "button",
        title: "潮汐计 TideGauge",
        "aria-label": "潮汐计 TideGauge",
        "aria-expanded": open,
        onClick: function () { setOpen(!open); },
        style: {
          width: 28,
          height: 28,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
          border: "none",
          background: open
            ? "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.16))"
            : "transparent",
          color: open
            ? "var(--dsw-alias-label-primary, #e8e8e8)"
            : "var(--dsw-alias-label-secondary, #9a9a9a)",
          cursor: "pointer",
          padding: 0
        }
      }, el(WaveIcon));

      var panel = open ? el("div", {
        role: "dialog",
        "aria-label": "潮汐计 TideGauge",
        style: {
          position: "fixed",
          top: 52,
          right: 16,
          width: 336,
          maxHeight: "calc(100vh - 72px)",
          overflow: "auto",
          background: "var(--dsw-alias-bg-base, #141414)",
          border: "1px solid var(--dsw-alias-border-l1, #2a2a2a)",
          borderRadius: 12,
          padding: 16,
          zIndex: 9999,
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          color: "var(--dsw-alias-label-primary, #e8e8e8)",
          fontFamily: "inherit"
        }
      },
        el("div", {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 2
          }
        },
          el("span", { style: { fontSize: 14, fontWeight: 600 } }, "潮汐计 TideGauge"),
          el("button", {
            type: "button",
            "aria-label": "关闭",
            onClick: function () { setOpen(false); },
            style: {
              background: "none",
              border: "none",
              color: "var(--dsw-alias-label-secondary, #8a8a8a)",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
              padding: "2px 4px"
            }
          }, "×")
        ),

        el(Section, { title: "模型用量 · 本会话" },
          el(Row, { label: "输入（未缓存）", value: fmtCompact(tokenUsage && tokenUsage.uncachedInputTokens) }),
          el(Row, { label: "输出", value: fmtCompact(tokenUsage && tokenUsage.outputTokens) }),
          el(Row, { label: "缓存读取", value: fmtCompact(tokenUsage && tokenUsage.cacheReadTokens) }),
          el(Row, { label: "缓存写入", value: fmtCompact(tokenUsage && tokenUsage.cacheWriteTokens) }),
          el(Row, { label: "合计", value: fmtCompact(totalTokens) })
        ),

        el(Section, { title: "上下文占用" },
          el(Row, { label: "预计压力", value: fmtCompact(contextPressure && (contextPressure.projectedTokens ?? contextPressure.pressureTokens)) }),
          el(Row, { label: "窗口容量", value: fmtCompact(contextPressure && contextPressure.contextWindow) }),
          el(Row, { label: "占用率", value: occupancy === null ? "—" : occupancy.toFixed(1) + "%" })
        ),

        el(Section, { title: "会话统计" },
          el(Row, { label: "轮次 / 步数", value: sessionStats ? sessionStats.turns + " / " + sessionStats.steps : "—" }),
          el(Row, { label: "模型耗时", value: fmtMs(sessionStats && sessionStats.llmMs) }),
          el(Row, { label: "首 token 延迟", value: fmtMs(sessionStats && sessionStats.ttftMs) }),
          el(Row, { label: "解码 tokens", value: fmtCompact(sessionStats && sessionStats.decodeTokens) })
        ),

        el(BillingSection, { tokenUsage: tokenUsage }),

        el("div", {
          style: {
            marginTop: 14,
            fontSize: 11,
            lineHeight: 1.5,
            color: "var(--dsw-alias-label-caption, #666)"
          }
        },
          "token 数为近似值（提供方上报 + 启发式估算，CJK 文本会被低估）。余额与计价由主机侧处理,密钥不会进入浏览器。")
      ) : null;

      return el(React.Fragment, null, button, panel);
    }

    // -------------------------------------------------------------------------
    // Plugin body
    // -------------------------------------------------------------------------

    function apply(ctx) {
      ctx.slots.inject("conversation.session.header.utilities", function () {
        return ctx.slots.register(
          {
            name: "conversation.session.header.utilities",
            id: "tide-gauge",
            order: 1000
          },
          TideGaugeButton
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
