# Agent Task Manager (ATM) 啟用教學（Tailscale 可開啟版）

## 目標
讓你的 Agent Task Manager (ATM) 管理台與啟動的 dev server，可在 **手機/平板（同一個 Tailscale 網路）** 上直接開啟。

## 1) 啟動前準備
- Node.js 版本：**18+**
- 於專案目錄執行

```powershell
cd C:\path\to\agent-task-manager
```

## 2) 啟動 Agent Task Manager (ATM) 管理台（Tailscale 可存取）
關鍵在於綁定 `0.0.0.0`：

```powershell
npm run dev -- --host 0.0.0.0 --port 8787
```

> 如果有 `npm.ps1` execution policy 問題，改用：

```powershell
npm.cmd run dev -- --host 0.0.0.0 --port 8787
```

或用腳本：

```powershell
.\dev-manager.ps1 ui -UiPort 8787
```

## 3) 開啟管理台
- 本機：`http://127.0.0.1:8787`
- Tailscale（同一 Tailnet）：`http://100.x.y.z:8787`

## 4) 在 UI 啟用專案供手機連線
1. 在管理台按「掃描」找到專案
2. 對目標專案按「啟用 Tailscale」
3. 系統會顯示此專案的 Tailscale 連結，例如：`http://100.x.y.z:5173`
4. 手機瀏覽器打開該網址即可開發測試

## 5) CLI 常用指令（含 Tailscale 流程）

```powershell
# 掃描專案，寫入 dev-projects.json
.\dev-manager.ps1 discover -Roots C:\path\to\projects -BasePort 5173

# 啟動全部（含上次設定）
.\dev-manager.ps1 start

# 查看狀態（會列出可用 URL）
.\dev-manager.ps1 status

# 啟動/停止指定專案（仍需確保專案自身可被 0.0.0.0 綁定）
.\dev-manager.ps1 start -Project my-app
.\dev-manager.ps1 stop -Project my-app

# 查看 log
.\dev-manager.ps1 logs -Project my-app -LogLines 80

# 全部停止
.\dev-manager.ps1 stop
```

## 6) 專案本身也要能被網路存取（關鍵）
Agent Task Manager (ATM) 會幫你啟動時加入 `--host 0.0.0.0` 的參數（Vite / Next / Astro / Nuxt 常見框架皆已支援），
但若某些專案有自訂 script，請確認會綁在 `0.0.0.0` 或環境變數 `HOST`。

## 7) 防火牆（Windows，必要時執行）
管理台與專案啟動後，若手機仍連不到，先依網路型態加規則：

- 僅允許 Tailscale IP 範圍 `100.64.0.0/10`：
```powershell
.\dev-manager.ps1 firewall -BasePort 5173 -PortCount 100
```

- 僅允許區域網（同 Wi-Fi 私人網段）：
```powershell
.\dev-manager.ps1 firewall-lan -BasePort 5173 -PortCount 100
```

> 以上兩個指令都需要系統管理員權限。

---
更新重點：所有管理與啟動流程已改為可供 Tailscale 直接開啟。
