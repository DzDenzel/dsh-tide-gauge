# 潮汐计 · TideGauge

DeepSeek Harness 的用量与账单浮层插件。它在 Web / 桌面会话头右上角注入一枚波浪图标，点击后展开右侧浮层，实时呈现 **本会话的模型用量、上下文占用、会话统计、各 provider 账户余额与费用估算**。

> 「TideGauge / 验潮仪」取自海洋学术语，用于持续记录水位随时间的变化。本插件以同样的思路，持续记录 token 用量与余额的“水位”。

## 目录

- [特性](#特性)
- [安装](#安装)
- [使用](#使用)
- [配置](#配置)
- [余额解析规则](#余额解析规则)
- [架构与数据流](#架构与数据流)
- [API 参考](#api-参考)
- [已知限制](#已知限制)
- [License](#license)

## 特性

| 模块 | 说明 |
| --- | --- |
| **模型用量** | 本会话的未缓存输入 / 输出 / 缓存读取 / 缓存写入 token 及合计 |
| **上下文占用** | 预计压力、窗口容量、占用率 |
| **会话统计** | 轮次 / 步数、模型耗时、首 token 延迟、解码 tokens |
| **账户余额** | 仅展示配置了余额端点的 provider；多个 provider 时以标签页切换 |
| **费用估算** | 按 `config.pricing` 价格表，将本会话 token 用量折算为费用 |
| **密钥安全** | 密钥仅在主机侧解析，余额请求由主机发出，浏览器只接收结果，密钥永不进入浏览器 |

## 安装

本插件是标准的 `dsh.bundle` + `dsh.client` 双面包，适配任意 profile（`web` / `desktop` / 自定义）。三种安装方式等价：

```sh
# 从 npm（发布后可用）
dsh plugin --profile <任意profile> add dsh-tide-gauge

# 从本地目录（开发态）
dsh plugin --profile web add ./dsh-tide-gauge

# DSH Desktop（桌面版使用 desktop profile）
dsh plugin --profile desktop add dsh-tide-gauge
```

安装后**重启对应 profile**（重启 `dsh web` 进程，或完全退出并重开 DSH Desktop）。会话头右上角出现波浪图标即表示加载成功。

## 使用

1. 点击会话头右上角的波浪图标，展开右侧浮层；再次点击或按右上角「×」关闭。
2. 「账户余额」区右上角的「刷新」按钮会立即重新拉取余额；各 provider 余额也会按 `refreshMs` 自动缓存刷新。
3. 当配置了多个 provider 时，「账户余额」区顶部会出现以配置名称命名的胶囊按钮，点击即可在 provider 间切换，查看对应 provider 的余额与刷新时间。

## 配置

编辑 profile 的用户层配置 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`，为 `tide-gauge` 行追加 `config`。内置的 DeepSeek 官方余额规则始终启用，无需配置。

### `providers` — 其它 provider 的余额接口

`providers` 是一个数组，每个元素描述一个额外 provider 的余额端点：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `provider` | `string` | 是 | — | provider 唯一 id，同时作为缓存键与切换按钮标识 |
| `label` | `string` | 否 | `provider` | 面板按钮与余额项展示的友好名称 |
| `kind` | `string` | 否 | `openai-compatible` | 余额响应解析方式：`deepseek` 或 `openai-compatible` |
| `balanceUrl` | `string` | 是 | — | 余额查询端点 URL；未配置的 provider 不会出现在面板中 |
| `currency` | `string` | 否 | `""` | 默认币种符号，响应未返回 `currency` 时兜底 |
| `apiKeyEnv` | `string` | 否 | `DEEPSEEK_API_KEY` | 密钥来源：优先 `credentials.resolve`，其次 `process.env` |
| `refreshMs` | `number` | 否 | `300000` | 余额缓存刷新间隔（毫秒） |

### `pricing` — 按模型的价格表

`pricing` 是一个以 **模型 id 为键** 的对象，价格为 **每百万 token** 单价；仅列入此表的模型会参与费用估算。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `label` | `string` | 否 | 费用估算区展示的模型名称 |
| `provider` | `string` | 否 | 归属 provider（元数据，暂不参与过滤） |
| `currency` | `string` | 否 | 币种符号 |
| `inputPer1M` | `number` | 是 | 未缓存输入 token 每百万单价 |
| `outputPer1M` | `number` | 是 | 输出 token 每百万单价 |
| `cacheReadPer1M` | `number` | 否 | 缓存读取 token 每百万单价 |

### 完整示例

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

## 余额解析规则

主机侧以 `Authorization: Bearer <key>` 请求 `balanceUrl`，并按 `kind` 解析响应：

- **`deepseek`**：读取 `balance_infos[0]`，映射 `total_balance` / `granted_balance` / `topped_up_balance` 与 `currency`。
- **`openai-compatible`**：尽力从响应中读取 `totalBalance` → `total_balance` → `total` → `balance` → `credits`（按顺序取第一个命中），并读取 `currency`；响应缺省时回退到规则里的 `currency`。

未命中任何可识别字段时，该 provider 标记为 `error`，面板显示错误原因。

## 架构与数据流

本插件由主机侧与浏览器侧两半组成：

- **主机侧（`lib/index.js`）**：纯函数 Cordis 插件（零 import），注入 `webServer`。仅收录配置了余额端点的 provider，在主机上拉取并缓存余额，并通过 `/tide-gauge/state` 路由对外提供数据；密钥永不进入浏览器。
- **浏览器侧（`lib/client.js`）**：`window.__ModuleLoader__.load` 惰性 CJS 包，注入 `slots`，注册到 `conversation.session.header.utilities` 槽位（右上角），负责渲染图标与浮层，并通过 `fetch("/tide-gauge/state")` 拉取余额与计价数据。

```text
┌──────────────┐   GET /tide-gauge/state   ┌─────────────────┐
│   浏览器 UI    │ ────────────────────────▶ │  lib/index.js   │
│ (client.js)  │ ◀──────────────────────── │   (主机侧)       │
└──────────────┘   JSON（余额 + 计价）        └───────┬─────────┘
                                                     │ Bearer <key>
                                                     ▼
                                            ┌─────────────────┐
                                            │  各 provider API │
                                            └─────────────────┘
```

## API 参考

### `GET /tide-gauge/state`

返回各 provider 的余额与计价表（`/tide-gauge/balance` 为等价别名）。响应为 `application/json`，`Cache-Control: no-cache`：

```json
{
  "providers": [
    {
      "provider": "deepseek-official",
      "label": "DeepSeek 官方",
      "balance": {
        "status": "ok",
        "currency": "CNY",
        "totalBalance": "…",
        "grantedBalance": "…",
        "toppedUpBalance": "…",
        "refreshedAt": 1710000000000,
        "nextRefreshAt": 1710000300000,
        "error": ""
      }
    }
  ],
  "pricing": { "deepseek-v4-flash": { "inputPer1M": 1.0 } },
  "refreshedAt": 1710000000000
}
```

其中 `balance.status` 取值：`ok`（成功）、`error`（请求或解析失败）、`unavailable`（未配置密钥或端点）。

## 已知限制

- **token 为近似值**：由提供方上报 + 启发式估算得到，CJK 文本会被低估；
- **路由仅绑定主机**：余额/计价路由绑定在 web server 上（默认 `127.0.0.1`，不对公网暴露）；无 API Key / 无端点的 provider 显示「未配置余额端点」；
- **协议耦合**：浏览器侧 `client.js` 为预构建的 `window.__ModuleLoader__.load` 格式，跟随 harness 客户端模块协议版本，升级 harness 时需同步校验；
- **价格不内置**：`pricing` 缺省为空，需自行填入价格后才会显示费用数字。

## License

[MIT](./LICENSE)
