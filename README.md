# 潮汐计 · TideGauge

一个属于我（这个 agent）的小插件：在 DeepSeek Harness 的 Web / 桌面界面上，用一个右上角的小图标（紧挨 Session log），点开后展开一块右侧浮层，实时展示 **模型用量、上下文占用、会话统计、账户余额与刷新时间**。

> 名字来自海洋学的「验潮仪 / Tide Gauge」——持续记录水位随时间变化。这里的水位就是你的 token 用量与余额。

## 功能

- **模型用量**（本会话）：输入/输出/缓存读写 token 合计；
- **上下文占用**：预计压力、窗口容量、占用率；
- **会话统计**：轮次/步数、模型耗时、首 token 延迟、解码 tokens；
- **账户余额**：按 provider 展示余额 + 上次/下次刷新时间。自动发现所有已配置 provider（`deepseek-official` + pi-ai 的 openai/anthropic/google/openrouter/… 等 OpenAI 兼容网关）；DeepSeek 官方 `GET /user/balance` 内置，其它网关通过 `config.providers` 追加（通用字段映射）。
- **费用估算**：按模型价格表（`config.pricing`，每百万 token 单价）把本会话 token 用量折算成费用。

## 安装

本插件是标准的 `dsh.bundle` + `dsh.client` 双面包，适配任何 profile（`web` / `desktop` / 自定义）。三种装法等价：

```sh
# 从 npm（推荐，发布后可用）
dsh plugin --profile <任意profile> add dsh-tide-gauge

# 从本地目录（开发态）
dsh plugin --profile web add ./dsh-tide-gauge

# DSH Desktop（桌面版用的是 desktop profile）
dsh plugin --profile desktop add dsh-tide-gauge
```

装完**重启对应 profile**（`dsh web` 重启进程，或完全退出重开 DSH Desktop），在会话头右上角看到波浪图标即可。

## 架构

- **node 半**（`lib/index.js`）：纯函数插件（零 import），通过 `ctx.llm` 自动发现 provider 与模型，在 `ctx.webServer` 上注册 `/tide-gauge/state` 路由，主机侧拉取并缓存余额，密钥不进入浏览器。
- **browser 半**（`lib/client.js`）：`window.__ModuleLoader__.load` 惰性 CJS 包，注册到 `conversation.session.header.utilities`（右上角），点击展开右侧浮层；余额/计价区 `fetch('/tide-gauge/state')`。

## 配置 provider 与计价

编辑 profile 的用户层 `cordis.patch.yml`（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`），给 `tide-gauge` 行加配置：

```yaml
- id: tide-gauge
  name: dsh-tide-gauge
  config:
    # ① 其它 provider 的余额接口
    providers:
      - provider: openrouter
        label: OpenRouter
        kind: openai-compatible
        balanceUrl: https://openrouter.ai/api/v1/credits
        currency: USD
        apiKeyEnv: OPENROUTER_API_KEY
        refreshMs: 600000

    # ② 按模型价格（每百万 token 单价）
    pricing:
      deepseek-v4-flash:
        label: DeepSeek-V4-Flash
        currency: CNY
        inputPer1M: 1.0
        outputPer1M: 2.0
        cacheReadPer1M: 0.1
      gpt-4o-mini:
        label: GPT-4o mini
        currency: USD
        inputPer1M: 0.15
        outputPer1M: 0.60
```

- `kind: deepseek` 支持 DeepSeek 的 `balance_infos[0]` 结构；`kind: openai-compatible` 尽力从响应里读 `totalBalance` / `total_balance` / `total` / `balance` / `credits` + `currency`。
- `pricing` 缺省为空，填入价格后才显示费用数字（插件不内置会变动的价格）。

## 已知边界

- token 数为近似值（提供方上报 + 启发式估算，CJK 文本会被低估）；
- 余额/计价路由绑定在 web server 上（默认 127.0.0.1，不对外暴露）；无密钥/无端点的 provider 显示「未配置」；
- 客户端 `client.js` 是预构建的 `window.__ModuleLoader__.load` 格式，跟随 harness 客户端模块协议版本。

## License

[MIT](./LICENSE)
