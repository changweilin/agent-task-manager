# CLAUDE.md — Agent Task Manager (ATM)

## 1. 專案定位與架構
- 本機 dev server 管理台：掃描多專案的 `npm run dev`，集中啟動/停止/重啟、log、port 自動分配（5173 起）、Tailscale/LAN 分享、node-pty 終端、AI agent pipeline 編排。管理台 port `8787`。
- 技術棧：純 Node.js ≥18。**無 TypeScript、無 bundler、無框架、無測試、無 linter。** 依賴僅 `ws`、`node-pty`、`@xterm/*`。
- 全部邏輯集中在兩個巨型檔案 — 這是刻意設計，**MUST NOT** 未經指示拆檔或模組化重構：
  - `server.js`（~7,700 行）：單一 HTTP + WebSocket 伺服器、REST `/api/*`、PTY 終端、專案掃描、防火牆/Tailscale/ADB 輔助、自我重啟。
  - `public/app.js`（~11,000 行）：瀏覽器原生 ESM（直接 import `./vendor/xterm/*.mjs`），單一 `state` 物件 + `render*()` 全量重繪，1s poll `/api/status`。
- 心智模型：**伺服器是唯一事實來源**；client（含手機透過 Tailscale 的唯讀鏡像）只是同一 UI 對 server 狀態的投影。執行永遠只發生在本機。
- 持久化：`dev-projects.json`（掃描結果+設定）、`.dev-manager/state.json`（執行中 PID/port）、`.dev-manager/terminal-preferences.json`（終端工作區 + pipeline 設定 + 記事本草稿，跨裝置共享）。
- 所有使用者可見字串 **MUST** 為繁體中文（台灣用語）。

## 2. 通用開發規則 (RFC-2119)

### 程式碼品質與型別安全
- **MUST** 沿用現有風格：server 端 CommonJS、client 端 ESM、`function` 宣告、早期 return。
- **MUST NOT** 引入 TypeScript、build step、新 npm 依賴或前端框架 — 前端必須維持零建置、直接可被 server 服務。
- 改動後 **MUST** 執行 `node --check server.js` 與 `node --check public/app.js`；這裡沒有測試套件，語法檢查 + 開頁手動驗證是唯一防線。
- 對外部程序的呼叫（spawn、pty、tailscale/adb CLI）**MUST** try/catch 並降級（參考檔頭 `pty = null` fallback）；單一專案異常 **MUST NOT** 讓 ATM server crash。

### 狀態管理與資料流
- 衍生欄位（`role`、`backends`、各種 URL）**MUST** 在 `getStatusPayload` 時即時計算，**MUST NOT** 寫進掃描/持久化資料（見 §3 INC-311）。
- client **MUST** 走 `state` + `render*()` 更新 UI，**MUST NOT** 在 render 流程外直接改 DOM。
- 重繪含 `<select>`/輸入框的區塊前 **MUST** 檢查 `document.activeElement` 是否位於其中，是則跳過 innerHTML 重建 — 否則 1s poll 會把使用者正在操作的下拉打斷收合（`renderTerminalProjectBar` 已示範）。
- `terminal-preferences.json` 採部分合併：client 在唯讀（遠端）狀態 **MUST** 省略 `workspace` 欄位，否則手機端會清空本機的終端分頁；server 端新增欄位一律 passthrough、缺 key = 保留舊值。

### 效能與安全邊界
- **執行權限是本專案最重要的安全邊界**：所有會執行程式碼的 endpoint（`POST /api/terminals`、`terminal-agent`、`terminal-claude`、start/stop/restart、firewall）**MUST** 以 `isLocalRequest(request)` 把關，非本機回 `403`。遠端裝置僅允許：唯讀鏡像終端（WS `readOnly` 不收輸入）、讀寫 `terminal-preferences`。新增 endpoint 時 **MUST** 先歸類「執行」或「讀取/設定」並套用同一 gate。
- Demo 模式（GitHub Pages）**MUST NOT** 發出真實請求或執行任何指令：`DEMO_MODE` 分支只吃 `demo-config.js` 假資料。app.js 新功能 **MUST** 確認在 DEMO_MODE 下被 gate。
- AI quota 探測（`getSingleAiQuotaPayload`）會 spawn 完整 agent CLI，單次 ~25–35 秒；**MUST NOT** 放進 poll 迴圈或預設對每個 pipeline 步驟開啟。
- client 輪詢刻意分頻（sessions 每 tick、遠端 session 探索每 4 tick、pipeline 設定同步每 6 tick）；新輪詢 **SHOULD** 掛進既有 tick，**MUST NOT** 另開 `setInterval`。

## 3. 危險模式與歷史教訓（Incident-Dated）
- `[2026-06-25 #INC-311]` **normalizeProjects 白名單吞欄位**：`normalizeProjects`/`normalizeProjectBranches` 以固定欄位白名單重建物件（無 spread）— 在掃描階段新增的任何欄位會在存檔時被靜默丟棄。衍生資訊一律在 status 時計算。
- `[2026-06-21 #INC-287]` **終端畫面震盪**：`.terminal-modal-panel` 的 `height: calc(100dvh - 16px)` 是「定值」而非 max-height — 移除後 xterm `fit()` 與 flex layout 互相觸發、畫面抖動不止。mount 時的 ResizeObserver 已用 rAF 去抖（`view.fitRaf`），兩者 **MUST NOT** 移除。
- `[2026-06-23 #INC-298]` **Pipeline 完成偵測是啟發式**：`pipelineWaitForCompletion` 靠輸出靜默 `idleSeconds` 判定完成，沒有真正的 done 訊號；「開新對話」是往同一 CLI 程序送 `/clear`（claude）/`/new`（codex），**不是**重啟程序。**MUST NOT** 「改良」成 kill+respawn 或 exit-code 判定 — 會破壞續跑與 session 復用。
- `[2026-06-23 #INC-301]` **quota reset 解析是 best-effort**：`parseQuotaResetSeconds` 用 regex 解析 `/usage` 文字輸出（"resets in 3h 21m" 等），格式隨 CLI 版本漂移；`resetSeconds` 為 null 時降級為每 60s 重探。修改時 **MUST** 保留 null fallback。
- `[2026-06-24 #INC-305]` **ATM 自我重啟鏈**：`restartAtm()` spawn detached 替身程序（`ATM_RESTART=1`、stdio 導向 `.atm-restart.*.log`）→ 舊程序 shutdown → 新程序對 `EADDRINUSE` 重試 ~20s 搶 port。重啟後的終端/伺服器復原由 **client 端** localStorage snapshot 驅動（key `atm-resume-snapshot`、5 分 TTL），依賴「死掉的終端分頁保留 localId 變回可重啟 draft」。**MUST NOT** 改成 server 端復原而破壞這條 reload 鏈。
- `[2026-06-22 #INC-294]` **Windows 訊號陷阱**：Git Bash 的 `kill` 無法對原生 Windows node 送出可攔截訊號；只有真 console Ctrl+C / 關窗會觸發 `shutdownAtm` 清理子程序。驗證 shutdown 邏輯 **MUST** 用真 Ctrl+C；`taskkill /F` 會遺留孤兒 dev server 佔 port。
- **多行 prompt 進終端 MUST 用 bracketed paste**（`\x1b[200~ … \x1b[201~` 後接 `\r`），否則內嵌換行會提早送出；client 無 socket 時 fallback 為 `POST /api/terminals/:id` 帶 `{raw:true}`。
- `dist/` 為 build 產物（GitHub Pages demo），**MUST NOT** 手改；改完 `public/` 後跑 `npm run build:pages` 重建。

## 4. 核心指令與工作流
```sh
npm run dev              # start ATM (node server.js) at http://127.0.0.1:8787
npm run build:pages      # rebuild dist/ demo (flips DEMO flag, copies xterm vendor files)
node --check server.js   # syntax gate — no test suite exists in this repo
node --check public/app.js
rundev.bat               # Windows one-click launch
.\dev-manager.ps1        # PowerShell CLI: scan/start/stop without the web UI
```
- 環境變數：`DEV_DOCK_CONFIG` 覆寫 `dev-projects.json` 路徑；`ATM_RESTART=1` 僅供重啟替身程序使用，**MUST NOT** 手動設定。
- 標準驗證流程：`node --check` 兩檔 → `npm run dev` → 開 `http://127.0.0.1:8787` 手動走過改動路徑；涉及權限 gate 時，另以非 localhost 來源確認執行類 endpoint 回 `403`。
