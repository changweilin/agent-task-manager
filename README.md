# Agent Task Manager (ATM)

Agent Task Manager (ATM) 是一套本機開發伺服器管理工具，專為需要同時管理多個 `npm run dev` 專案的 Windows 開發環境設計。它提供 Web 管理介面與 PowerShell CLI，可自動掃描含有 `package.json` 與 `scripts.dev` 的專案，集中啟動、停止、重啟、查看狀態與讀取 log，並支援透過 LAN 或 Tailscale 將開發中的網站分享給手機、平板或同一網路中的裝置測試。

專案主要由 Node.js HTTP/WebSocket 伺服器、靜態前端介面與 Windows PowerShell 輔助腳本組成。預設管理台連接埠為 `8787`，被管理的專案會從 `5173` 起自動分配 port。

## 核心功能特性

- **專案自動掃描**：遞迴尋找含有 `package.json` 且定義 `scripts.dev` 的專案，並寫入 `dev-projects.json`。
- **集中式 Web 管理台**：透過瀏覽器檢視專案狀態、啟動/停止/重啟服務、複製 Local、LAN、Tailscale URL。
- **多框架 dev server 支援**：可辨識 Vite、Next.js、Astro、Nuxt 與一般 Node 專案，啟動時自動帶入適合的 host/port 參數或環境變數。
- **Tailscale 與 LAN 分享**：管理台會偵測本機 LAN IP 與 Tailscale IPv4，方便在手機或平板直接開啟開發中的頁面。
- **Profile 批次操作**：可將多個專案組成 Profile，一次啟動、停止或重啟。
- **狀態保存與自動復原**：執行狀態會保存在 `.dev-manager/state.json`，可在 Agent Task Manager (ATM) 重啟後復原先前分享中的專案。
- **健康檢查與自動重啟**：可設定健康檢查失敗門檻，並選擇是否自動重啟異常專案。
- **即時 log 與終端管理**：Web UI 可讀取 stdout/stderr log，並透過 `node-pty` 與 xterm.js 管理專案終端工作階段。
- **Windows 防火牆輔助**：提供 Tailscale、LAN port 範圍規則，以及針對單一專案 port 的安全同意流程。
- **Android APK 安裝輔助**：若目標專案具備可辨識的 Android build 流程，可由 UI 觸發 build 並透過 ADB 安裝 APK。

## 系統需求與安裝步驟

### 系統需求

- Windows 10/11 或相容的 Windows PowerShell 環境
- Node.js `18` 或更新版本
- npm
- Tailscale（選用；需要跨裝置或手機測試時建議安裝並登入同一個 tailnet）
- Android SDK / ADB（選用；只有使用 APK build/install 功能時需要）

### 安裝

1. 進入專案目錄：

```powershell
cd C:\path\to\agent-task-manager
```

2. 安裝 Node.js 相依套件：

```powershell
npm install
```

3. 啟動 Agent Task Manager (ATM) 管理台：

```powershell
npm run dev -- --host 0.0.0.0 --port 8787
```

若 PowerShell 因 execution policy 阻擋 `npm.ps1`，可改用：

```powershell
npm.cmd run dev -- --host 0.0.0.0 --port 8787
```

也可以使用內建 PowerShell 包裝指令：

```powershell
.\dev-manager.ps1 ui -UiPort 8787
```

4. 開啟管理台：

- 本機：`http://127.0.0.1:8787`
- LAN：管理台會顯示類似 `http://192.168.x.x:8787` 的網址
- Tailscale：管理台會顯示類似 `http://100.x.y.z:8787` 的網址

## GitHub Pages 展示部署

本專案可透過 GitHub Actions 部署成 GitHub Pages 展示頁。展示頁只輸出靜態檔案，會強制啟用展示模式，使用去識別化樣本資料，不會連線到本機的 `/api`、WebSocket、LAN、Tailscale、PowerShell、ADB 或任何實際 dev server。

部署流程：

1. 到 GitHub repository 的 **Settings → Pages**，將 Source 設為 **GitHub Actions**。
2. 推送到 `main`，或到 Actions 手動執行 **Deploy GitHub Pages Demo** workflow。
3. Workflow 會執行 `npm ci --ignore-scripts` 與 `npm run build:pages`，再把 `dist/` 上傳到 GitHub Pages。

展示模式的隔離設計：

- 不打包 `dev-projects.json`、`.dev-manager/`、log、state 或任何本機設定。
- 不輸出 `mobile-install.js`，避免展示頁帶入 APK/ADB 輔助流程。
- `dist/demo-config.js` 會將 `window.AGENT_TASK_MANAGER_DEMO` 設為 `true`。
- 前端在展示模式下只讀取內建 mock API；所有啟動、停止、重啟、終端、資料夾、防火牆、複製連線等操作都會停用或顯示展示提示。
- 樣本資料會移除本機路徑、PID、stdout/stderr、LAN IP、Tailscale IP 與實際 URL，改用 `/demo/workspace/...` 與 `https://demo.invalid/...` 類型的展示值。

## 快速上手與使用範例

### 使用 Web UI

1. 啟動 Agent Task Manager (ATM) 管理台。
2. 在左側「專案來源」輸入要掃描的專案根目錄後按 Enter 或「加入」，或使用既有的 `dev-projects.json` 設定。
3. Agent Task Manager (ATM) 會自動找出可執行 `npm run dev` 的專案；重啟管理台時也會依既有來源自動掃描。
4. 在專案列表中按啟動按鈕，即可啟動對應專案。
5. 複製 Local、LAN 或 Tailscale URL，在本機或其他裝置開啟測試。
6. 需要批次管理時，可將目前篩選出的專案套用成 Profile，再一次啟動、停止或重啟。

### 使用 CLI

掃描專案並寫入設定檔：

```powershell
.\dev-manager.ps1 discover -Roots C:\path\to\projects -BasePort 5173
```

啟動全部已設定專案：

```powershell
.\dev-manager.ps1 start
```

查看目前狀態與可用 URL：

```powershell
.\dev-manager.ps1 status
```

只操作指定專案：

```powershell
.\dev-manager.ps1 start -Project my-app
.\dev-manager.ps1 stop -Project my-app
.\dev-manager.ps1 restart -Project my-app
```

查看指定專案最近 log：

```powershell
.\dev-manager.ps1 logs -Project my-app -LogLines 80
```

列出 Tailscale URL：

```powershell
.\dev-manager.ps1 urls
```

停止全部專案：

```powershell
.\dev-manager.ps1 stop
```

### Tailscale 手機測試流程

1. 確認電腦與手機都已登入同一個 Tailscale tailnet。
2. 使用 `0.0.0.0` 啟動管理台：

```powershell
npm.cmd run dev -- --host 0.0.0.0 --port 8787
```

3. 在手機瀏覽器開啟管理台顯示的 Tailscale URL，例如：

```text
http://100.x.y.z:8787
```

4. 從管理台啟動目標專案，再開啟該專案的 Tailscale URL，例如：

```text
http://100.x.y.z:5173
```

若手機無法連線，請以系統管理員身分開啟 PowerShell，依需求新增防火牆規則。

允許 Tailscale IPv4 範圍連入指定 port 區間：

```powershell
.\dev-manager.ps1 firewall -BasePort 5173 -PortCount 100
```

允許同一個 Private LAN 的 LocalSubnet 連入指定 port 區間：

```powershell
.\dev-manager.ps1 firewall-lan -BasePort 5173 -PortCount 100
```

## 專案架構說明

```text
agent-task-manager/
├─ .dev-manager/              # 執行時狀態、log 與偏好設定；由工具自動產生
├─ .github/workflows/
│  └─ deploy-pages.yml        # GitHub Pages 展示版部署 workflow
├─ public/
│  ├─ app.js                  # Web UI 前端邏輯、狀態管理、API 呼叫與終端介面
│  ├─ demo-config.js          # GitHub Pages 展示模式開關
│  ├─ index.html              # 管理台 HTML 入口
│  ├─ styles.css              # 管理台樣式
│  ├─ mobile-install.js       # 行動裝置 / APK 安裝相關前端輔助邏輯
│  ├─ logo.svg                # 管理台標誌
│  └─ favicon.svg             # 瀏覽器圖示
├─ scripts/
│  └─ build-pages.js          # 產出 GitHub Pages 靜態展示版
├─ dev-manager.ps1            # Windows PowerShell CLI，提供掃描、啟停、狀態、log、防火牆等指令
├─ dev-projects.json          # 專案來源、base port、Profile、健康檢查與專案清單設定
├─ package.json               # Node.js 專案資訊、指令與相依套件
├─ package-lock.json          # npm 鎖定檔
├─ rundev.bat                 # 快速啟動管理台的 Windows batch 檔
├─ server.js                  # Node.js HTTP/WebSocket 伺服器與主要後端 API
├─ tailscale-setup-guide.md   # Tailscale 啟用與手機測試補充教學
└─ README.md                  # 專案說明文件
```

### 主要檔案職責

- `server.js`：提供靜態檔案服務、REST API、WebSocket 終端通道、專案掃描、port 分配、狀態管理、log 讀取、健康檢查、Tailscale/LAN URL 偵測、防火牆輔助與 Android APK 安裝流程。
- `public/app.js`：管理 Web UI 狀態、專案表格、篩選排序、Profile、log 面板、終端 modal、xterm.js 互動與使用者偏好。
- `scripts/build-pages.js`：複製靜態前端與 xterm 前端資產到 `dist/`，並把展示模式開關設為啟用，供 GitHub Pages 使用。
- `dev-manager.ps1`：提供不依賴瀏覽器的 CLI 操作，適合批次掃描、啟停專案、查看狀態與設定 Windows 防火牆。
- `dev-projects.json`：保存預設掃描根目錄、base port、Profile、健康檢查設定與每個被管理專案的路徑、框架、dev script、port。

## 授權條款

本專案採用 **GNU General Public License v3.0（GPLv3）** 授權。

你可以依 GPLv3 條款使用、研究、修改與散布本專案；若散布修改後的版本，需同樣以 GPLv3 相容授權釋出，並提供相應原始碼。完整條款請參考 GNU 官方文件：<https://www.gnu.org/licenses/gpl-3.0.html>
