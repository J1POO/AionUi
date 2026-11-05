# AionUi 自定义分支说明

本仓库是 [iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi) 的定制 fork，用于「个人 AI 办公助手」的桌面端 + WebUI 部署与二次开发。

## 远程

- `origin` → `https://gitee.com/bu3-agent-project-team/AionUi.git`（可写，日常推送）
- `upstream` → `https://github.com/iOfficeAI/AionUi.git`（只 fetch，用于同步官方）

## 分支

| 分支 | 用途 |
|---|---|
| `custom/main` | 集成分支，所有自定义改动汇总于此 |
| `feat/*` | 单个功能分支（文档卡片、远程 Core、部署等） |

## 本 fork 的改动

1. **文档结果卡片**：对话中生成 docx/xlsx/pptx/pdf/csv 后，在消息流中显示「生成的文档」卡片，支持预览、下载；「用系统应用打开」仅在桌面端本地模式出现。
2. **远程 Core**：`AIONUI_REMOTE_CORE_URL` 指向远端 Core 时，桌面端不再启动本地 Core，HTTP 走 `Authorization: Bearer`，WebSocket 用 `Sec-WebSocket-Protocol` 带 token；CSRF 双提交头由前端从 Cookie 读取。
3. **WebUI 远程认证**：`aionui-web --remote` 启动的 Core 使用 WebUI 身份模式（登录 + CSRF），不再使用免认证的 `--local`。
4. **部署资产**：`deploy/Dockerfile`（全栈镜像，含国内 apt/pip 源）、`compose.docker.yml`、`deploy/DOCKER.md`。

## 构建

```bash
bun install
bun run package                 # renderer + preload
node scripts/build-with-builder.js x64 --win --x64   # Windows 安装包
```

全栈镜像：

```bash
docker compose -f compose.docker.yml build
docker compose -f compose.docker.yml up -d
```

## 远程 Core 配置

```powershell
setx AIONUI_REMOTE_CORE_URL "http://<core-host>:25808"
```

清空该变量并重启客户端即回到本地 Core 模式。

## 注意

- 远程模式首次启动没有本地 Core；Core 侧必须已经用 CLI 建好管理员密码。
- 不要把模型 API Key、`.env`、构建产物提交进仓库。
