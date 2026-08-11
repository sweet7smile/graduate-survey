# 霧峰農工電子科 畢業生升學資料蒐集系統

Google Apps Script + Google Sheet + Google Drive。
學生**不需登入 Google 帳號**即可填寫並上傳相片。

同一份前端程式碼支援三種執行模式，會自動判斷：

| 模式 | 觸發條件 | 行為 |
|---|---|---|
| **gas** | 由 Apps Script 的 `HtmlService` 託管 | 走 `google.script.run`，正式運作 |
| **api** | 靜態託管 + `docs/config.js` 填了 `/exec` 網址 | 走 `doPost` 跨網域送出，正式運作 |
| **demo** | 靜態託管但沒填網址 | 介面示範版，可完整操作但**不寫入任何資料** |

---

## 檔案

| 檔案 | GAS 編輯器檔名 | 說明 |
|---|---|---|
| `gas/config.gs` | `config` | **含真實 ID，已列入 .gitignore，不會上傳** |
| `gas/config.example.gs` | — | 公開範本（ID 與 Email 已抹除），自動產生 |
| `gas/Code.gs` | `Code` | 後端：`doGet` 表單頁、`doPost` API、寫入、上傳、寄信 |
| `gas/index.html` | `index` | 表單頁樣板 |
| `gas/styles.html` | `styles` | CSS |
| `gas/script.html` | `script` | 前端邏輯 |
| `index.html` | — | **自動產生**的靜態版，GitHub Pages 服務的就是它，勿手改 |
| `config.js` | — | Pages 用的 API 網址設定 |
| `tools/build_pages.py` | — | 由 `gas/` 產生根目錄的靜態版 |
| `SPEC.md` | — | 規格書 |

> GAS 原始碼放在 `gas/`，建置後的靜態網頁放在根目錄。
> 這樣 GitHub Pages 用**預設的 `/(root)`** 設定就會服務正確的檔案 ——
> 若把兩者放反或改用 `/docs` 卻忘了在 Settings 改資料夾，
> Pages 會直接把 GAS 樣板原始碼當網頁送出，畫面會變成沒有 CSS 也沒有 JS 的裸 HTML。

> 從 GitHub clone 下來的人：先把 `gas/config.example.gs` 複製成 `gas/config.gs`，
> 填入自己的 Sheet ID、Drive 資料夾 ID 與通知信箱。

---

## A. 部署 Apps Script（正式運作必要）

### 1. 建立專案

1. <https://script.google.com> →「新增專案」，改名為「畢業生資料蒐集」
2. 建立以下檔案並整段貼上內容：
   - 指令碼 `Code`（先刪掉預設的 `myFunction`）
   - 指令碼 `config`
   - HTML `index`、`styles`、`script`（建立時不用打 `.html`）

### 2. 初始化 Sheet

1. 函式下拉選 `initSetup` → 執行
2. 首次會要求授權：選學校帳號 →「進階」→「前往…（不安全）」→ 允許
   （自己寫的未驗證專案，正常現象）
3. 執行紀錄顯示「初始化完成」即成功，試算表會長出 7 個分頁

### 3. 部署

「部署」→「新增部署作業」→ 齒輪選「網頁應用程式」：

- **執行身分：我** ← 否則學生要登入才寫得進去
- **誰可以存取：所有人** ← 否則學生要登入才進得來

複製「網頁應用程式」網址（結尾 `/exec`）。這個網址：

- 直接給學生，就是完整可用的表單
- 或填進 `docs/config.js`，讓 GitHub Pages 版本變成正式站

> 改完程式碼要「部署 → 管理部署作業 → 編輯（鉛筆）→ 版本改『新版本』→ 部署」，網址不變。
> 只按儲存不會更新學生看到的頁面。

---

## B. 發布到 GitHub Pages

### 1. 產生靜態版

```bash
python tools/build_pages.py
```

會在**根目錄**產生 `index.html`（styles / script / config 全部內嵌成單一檔案），
並自動把 `gas/config.gs` 裡的 Sheet ID、Drive 資料夾 ID、通知信箱抹成佔位字串後
寫入 `gas/config.example.gs`。**改過任何原始碼都要重跑一次。**

### 2. 推上 GitHub

```bash
git remote add origin https://github.com/<你的帳號>/<repo名稱>.git
git branch -M main
git push -u origin main
```

### 3. 開啟 Pages

repo → Settings → Pages →
Source 選 **Deploy from a branch** → Branch 選 **main**、資料夾維持預設的 **`/(root)`** → Save。

約一分鐘後開 `https://<帳號>.github.io/<repo名稱>/`。

### 4.（選用）讓 Pages 變成正式站

編輯根目錄的 `config.js`，把 A-3 拿到的 `/exec` 網址填進去：

```javascript
window.GRAD_API_URL = 'https://script.google.com/macros/s/AKfy...../exec';
```

commit + push 後，Pages 上的表單就會真的寫進你的 Sheet。
留空則維持示範模式，頁面頂端會顯示「這是介面示範版」的警告。

---

## ⚠️ 學校 Workspace 可能擋住「所有人」

若貴校 Google Workspace 管理員限制了 Apps Script 對外分享，
「誰可以存取」會只剩「wufai.tc.edu.tw 內的所有人」，畢業生就登不進來。

三個解法，擇一：

1. 請資訊組在管理主控台 → 應用程式 → Google Workspace → Apps Script
   開啟「允許使用者將網頁應用程式部署給任何人」
2. 改用**個人 Gmail 帳號**建立 Apps Script 專案，
   並把 Sheet 與 Drive 資料夾共用給該帳號的編輯權限
3. 退而求其次，改成「擁有 Google 帳戶的任何人」，接受學生需登入

---

## 常用調整

全部在 `config.gs`：

| 想改什麼 | 改哪裡 |
|---|---|
| 換 Sheet / Drive 資料夾 | `SHEET_ID` / `DRIVE_FOLDER_ID` |
| 通知信收件者 | `NOTIFY_EMAIL` |
| 不要寄確認信給學生 | `SEND_CONFIRM_MAIL: false` |
| 允許同一人重複提交 | `BLOCK_DUPLICATE: false` |
| 校系筆數上限 | `MAX_ADMISSIONS` |
| 相片張數 / 容量上限 | `MAX_FILES_PER_PRACTICAL`、`MAX_FILES_TOTAL`、`MAX_TOTAL_BYTES` |
| 相片壓縮強度 | `IMAGE_MAX_EDGE`、`IMAGE_QUALITY` |
| 新增證照 / 群類 / 題目分類 | `OPTIONS` 內對應陣列 |
| 新增欄位 | `SCHEMA` 加一列 `{key, label}`，再到 `index.html` 加對應 `data-m` 欄位 |

- 改 `SCHEMA` 後要**重新執行 `initSetup`** 更新表頭
- 改任何東西後要**重跑 `build_pages.py`** 才會同步到 GitHub Pages
- 選項清單只有 `config.gs` 一份來源，靜態版是內嵌它產生的，不會不同步

---

## 設計重點

- **不需登入**：部署為「執行身分＝我 + 所有人可存取」，`DriveApp` 用你的權限寫檔
- **相片前端壓縮**：長邊 1600px、JPEG 0.8，一張約 200–400KB，避開 `google.script.run` 的 payload 上限
- **CORS**：`doPost` 用 `Content-Type: text/plain` 避免觸發 preflight，
  因為 Apps Script 無法回應 `OPTIONS` 請求
- **關聯式資料表**：口試題目一題一列，日後才做得出「依學校/科系查歷屆題目」的查詢頁
- **草稿自動存**：`localStorage`，表單很長不怕填一半跳掉（相片不存草稿）
- **防重複**：同 Email + 同學年度擋下，提示聯絡老師
- **併發安全**：`LockService` script lock，多人同時送出不會覆蓋

## 尚未實作（P4）

- 學弟妹瀏覽查詢頁（依學校/科系/年度查歷屆口試題，只顯示同意公開者）
- 教師後台：審核、退回、匯出 Excel/PDF
- 歷年錄取分布統計圖表
