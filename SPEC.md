# 霧峰農工電子科 畢業生升學資料蒐集系統 — 規格書

- 建立日期：2026-08-10
- 範圍：P1–P3（填寫表單 + 相片上傳 + 資料進 Sheet），不含查詢頁與教師後台
- 技術：Google Apps Script Web App（HtmlService）+ Google Sheet + Google Drive

---

## 1. 定案決策

| 項目 | 決定 |
|---|---|
| 填寫對象 | 僅限臺中市立霧峰農業工業高級中等學校 **電子科** 畢業生 |
| 身分驗證 | **不需登入 Google**（部署：執行身分＝我；存取權＝任何人） |
| 成果範圍 | 表單填寫 + 相片上傳 + 寫入 Sheet；查詢頁/後台留待日後 |
| 學校/科別欄位 | 固定值，不開放輸入（顯示為唯讀文字） |

---

## 2. 系統架構

```
學生手機（RWD，手機優先）
   │  HTML/CSS/JS  單頁分區塊 + 進度條
   ▼
GAS Web App  doGet() → HtmlService.createTemplateFromFile('index')
   │  google.script.run.submitForm(payload)
   ▼
Code.gs
   ├─ LockService 取得寫入鎖
   ├─ 產生 submission_id (Utilities.getUuid())
   ├─ 寫入 Sheet：Main / Admissions / Interview / Practical / Files
   ├─ DriveApp：/畢業生資料/{學年度}/{姓名}_{submission_id前6碼}/
   └─ MailApp：寄確認信給學生 + 通知承辦教師
```

### Sheet 分頁

| 分頁 | 說明 | 主/外鍵 |
|---|---|---|
| `Main` | 一人一列 | PK `submission_id` |
| `Admissions` | 推甄校系，一列一校系 | FK `submission_id` |
| `Interview` | 口試題目，一列一題 | FK `submission_id` + `admission_idx` |
| `Practical` | 術科題目，一列一項 | FK `submission_id` + `admission_idx` |
| `Files` | 上傳檔案清單 | FK `submission_id` |
| `Config` | 下拉選單來源（學年度、管道、證照、題目分類） | — |
| `Log` | 提交/錯誤紀錄 | — |

---

## 3. 欄位定義

### 3.1 `Main`

| 欄位 key | 顯示名稱 | 型態 | 必填 | 備註 |
|---|---|---|---|---|
| submission_id | 提交編號 | UUID | 系統 | |
| submitted_at | 提交時間 | 時間 | 系統 | |
| grad_year | 畢業年度 | 下拉 | ✅ | 近 6 學年度自動產生 |
| school | 畢業學校 | 固定 | — | 臺中市立霧峰農業工業高級中等學校 |
| dept | 科別 | 固定 | — | 電子科 |
| class_name | 班級 | 文字 | | 例：電子三甲 |
| seat_no | 座號 | 文字 | | |
| name | 姓名 | 文字 | ✅ | |
| email | 聯絡 Email | Email | ✅ | 防重複提交 + 寄確認信 |
| phone | 手機 | 文字 | | |
| social_id | IG / Line ID | 文字 | | 願意接受提問才填 |
| current_place | 目前就讀學校／服務單位 | 文字 | ✅ | 最終落點 |
| main_path | 主要出路 | 單選 | ✅ | 甄選入學／繁星／技優甄審／技優保送／特殊選才／登記分發／大學申請／就業／服役／其他 |
| exam_group | 報考群類 | 下拉 | | 電機與電子群電子類／電機類／其他 |
| tve_ch, tve_en, tve_math, tve_prof1, tve_prof2, tve_total | 統測各科成績 | 數字 | | 可摺疊區塊，選填 |
| rank_pct | 在校成績班排百分比 | 數字 | | |
| certificates | 持有證照 | 多選+其他 | | 丙級電腦硬體裝修／工業電子丙級／乙級工業電子／雲端物聯網／TQC／其他 |
| experiences | 競賽/專題經歷 | 多行 | | |
| activities | 幹部/社團/志工 | 多行 | | |
| portfolio_pages | 備審頁數 | 數字 | | |
| portfolio_tool | 備審製作工具 | 文字 | | |
| portfolio_hours | 備審花費時間(小時) | 數字 | | |
| portfolio_focus | 備審重點放什麼 | 多行 | | |
| portfolio_asked | 面試有被問到備審內容嗎 | 單選 | | 有／沒有／不記得 |
| reflection | 整體心得 | 多行 | ✅ | 提示 200 字以上 |
| advice_1/2/3 | 給學弟妹的 3 個建議 | 文字 | ✅ | 至少填 1 |
| do_earlier | 高一高二該先做什麼 | 多行 | | |
| regret | 最後悔沒做的一件事 | 多行 | | |
| willing_share | 願意回校分享 | 勾選 | | |
| willing_qa | 接受學弟妹提問 | 勾選 | | |
| consent_pdpa | 個資蒐集同意 | 勾選 | ✅ | 必勾才能送出 |
| publish_level | 公開層級 | 單選 | ✅ | 完全公開／匿名公開／僅校內教師參考 |
| consent_photo | 相片授權校內教學使用 | 勾選 | | |
| review_status | 審核狀態 | 文字 | 系統 | 預設「待審」 |

### 3.2 `Admissions`（動態多筆，上限 6）

| 欄位 key | 顯示名稱 | 型態 |
|---|---|---|
| submission_id | 提交編號 | FK |
| idx | 志願序 | 數字 |
| univ | 學校名稱 | 文字（必填） |
| major | 科系名稱 | 文字（必填） |
| channel | 招生管道 | 下拉 |
| stage1_result | 一階篩選 | 通過／未通過／不適用 |
| stage2_items | 二階項目 | 多選：書面審查／個人面試／團體面試／筆試／術科實作／作品集 |
| stage2_score | 二階成績 | 文字 |
| final_result | 最終結果 | 正取／備取／未錄取／未參加 |
| result_rank | 名次 | 數字 |
| is_enrolled | 最終就讀 | 勾選（全表僅一筆為真） |

### 3.3 `Interview`（口試題目，動態多筆）

| 欄位 key | 顯示名稱 | 型態 |
|---|---|---|
| submission_id / admission_idx | 關聯校系 | FK |
| format | 面試形式 | 個人／團體／線上 |
| prof_count | 教授人數 | 數字 |
| duration_min | 時間長度(分) | 數字 |
| flow | 流程描述 | 多行 |
| question | **題目** | 多行（必填，一題一列） |
| categories | 題目分類 | 多選：自我介紹／專業知識／專題內容／備審內容／時事／英文／情境題／臨場反應 |
| my_answer | 我當時怎麼回答 | 多行 |
| better_answer | 現在回頭看該怎麼答 | 多行 |
| difficulty | 難度 1–5 | 星等 |
| tip | 給學弟妹的提醒 | 多行 |

### 3.4 `Practical`（術科/實作，動態多筆）

| 欄位 key | 顯示名稱 | 型態 |
|---|---|---|
| submission_id / admission_idx | 關聯校系 | FK |
| subject | 術科科目 | 電子電路實作／程式設計／數學筆試／專題口說／繪圖／其他 |
| duration_min | 考試時間(分) | 數字 |
| equipment | 提供的設備工具 | 多行 |
| content | 題目內容 | 多行（必填） |
| prep_advice | 準備方式建議 | 多行 |
| file_ids | 相關相片 | 關聯 `Files` |

### 3.5 `Files`

| 欄位 key | 說明 |
|---|---|
| submission_id | FK |
| file_id | Drive 檔案 ID |
| file_url | 檢視連結 |
| category | 用途：術科題目／作品照／備審目錄／其他 |
| ref_idx | 對應的 Practical/Admission 索引 |
| uploaded_at | 上傳時間 |

---

## 4. 相片上傳規格

- 前端 `FileReader` 讀檔 → `<canvas>` 壓縮（長邊上限 1600px、JPEG 品質 0.8）→ base64
- 單張壓縮後目標 < 500KB；單次提交所有圖片合計 < 4MB（`google.script.run` payload 安全值）
- 每個術科項目最多 5 張，全表最多 15 張
- 接受格式：jpg / jpeg / png / heic（heic 於前端轉檔失敗時提示改存 jpg）
- 儲存路徑：`畢業生資料/{學年度}/{姓名}_{submission_id前6碼}/{category}_{序號}.jpg`
- **上傳前強制顯示提醒**：請遮蔽准考證號、身分證字號、他人臉部與姓名

---

## 5. 前端行為

1. 分區塊呈現（A 基本 → B 升學 → C 校系 → D 口試 → E 術科 → F 備審 → G 心得 → H 授權），頂端進度條
2. 校系為動態卡片，可「新增校系」；口試題目、術科在各校系卡片內再動態新增
3. `localStorage` 每 30 秒自動存草稿，重新開啟時詢問是否還原
4. 未勾個資同意 → 送出鈕停用
5. 送出中顯示遮罩＋進度（圖片壓縮/上傳可能數秒）
6. 成功頁顯示提交編號，提示可截圖保存

## 6. 後端行為

1. `LockService.getScriptLock()`，等待上限 30 秒
2. 同一 Email + 同一學年度已存在 → 回傳提示，改為「更新」或拒絕（先採：提示已提交過，請聯絡老師）
3. 各分頁一次 `setValues` 批次寫入，避免逐列 append
4. 任一步驟例外 → 寫 `Log` 分頁並回傳友善錯誤訊息
5. 成功後 `MailApp` 寄確認信給學生，副本通知承辦教師

## 7. 檔案結構

```
畢業生資料蒐集Web/
├── SPEC.md            # 本文件
├── Code.gs            # 後端：doGet / submitForm / Sheet & Drive 寫入 / 寄信
├── index.html         # 表單主頁
├── styles.html        # CSS（RWD 手機優先）
├── script.html        # 前端 JS（動態區塊、壓縮、草稿、送出）
├── config.gs          # 常數：Sheet ID、Drive 資料夾 ID、選項清單
└── README.md          # 部署步驟說明
```

## 8. 待辦（日後階段）

- P4-1 學弟妹瀏覽查詢頁（依學校/科系/年度查歷屆口試題，只顯示同意公開者）
- P4-2 教師後台：審核、退回、匯出 Excel/PDF
- P4-3 統計圖表：歷年錄取分布
