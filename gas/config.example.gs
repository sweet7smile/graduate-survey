/* 這是公開範本：複製成 config.gs 後填入自己的 ID 與 Email。
   config.gs 已列入 .gitignore，不會被推上 GitHub。            */

/**
 * 霧峰農工電子科 畢業生升學資料蒐集系統
 * config.gs — 常數、選項清單、資料表結構
 *
 * 改設定只需要動這個檔案。
 */

const CONFIG = {
  // ── 儲存位置 ────────────────────────────────────────────
  SHEET_ID: 'YOUR_SHEET_ID',
  DRIVE_FOLDER_ID: 'YOUR_DRIVE_FOLDER_ID',

  // ── 學校固定資訊 ────────────────────────────────────────
  SCHOOL: '國立霧峰高級農工職業學校',
  DEPT: '電子科',

  // ── 通知信 ──────────────────────────────────────────────
  NOTIFY_EMAIL: 'your-address@example.com',  // 承辦教師，收提交通知
  SEND_CONFIRM_MAIL: true,                      // 是否寄確認信給學生
  CONTACT_NAME: '霧峰農工電子科',

  // ── 上傳限制 ────────────────────────────────────────────
  MAX_FILES_PER_PRACTICAL: 5,
  MAX_FILES_TOTAL: 15,
  MAX_TOTAL_BYTES: 4 * 1024 * 1024,   // 單次提交所有圖片合計上限（base64 前）
  IMAGE_MAX_EDGE: 1600,               // 前端壓縮：長邊像素上限
  IMAGE_QUALITY: 0.8,                 // 前端壓縮：JPEG 品質

  // ── 表單限制 ────────────────────────────────────────────
  MAX_ADMISSIONS: 6,                  // 推甄校系筆數上限

  // ── 行為 ────────────────────────────────────────────────
  BLOCK_DUPLICATE: true,              // 同 Email + 同學年度 是否阻擋重複提交
  LOCK_TIMEOUT_MS: 30000,

  // ── 登入與審核 ──────────────────────────────────────────
  // ⚠️ 教師帳密不放這裡也不放任何前端檔案。
  //    本專案是公開 repo，且 build_pages.py 會把 config.gs 內嵌進公開網頁。
  //    帳密以「鹽值 + SHA-256 雜湊」存在 Script Properties，
  //    請執行一次 setupTeacherAccount() 設定（見 Code.gs）。
  SESSION_HOURS: 6,                   // 登入有效時數（CacheService 上限 6 小時）
  LOCK_AFTER_APPROVED: true,          // 審核「通過」後畢業生不能再修改
  BROWSE_REQUIRE_APPROVED: true,      // 瀏覽頁只顯示審核通過的資料

  // ── 刪除 ────────────────────────────────────────────────
  // false（預設）：相片搬到「_已刪除」資料夾，誤刪救得回來
  // true          ：相片直接丟進雲端硬碟垃圾桶（30 天後由 Google 永久清除）
  //                 學生依個資法要求徹底刪除時才建議開啟
  HARD_DELETE_FILES: false,
  TRASH_FOLDER_NAME: '_已刪除'

  // ── Sheet 分頁名稱 ──────────────────────────────────────
  SHEETS: {
    MAIN: 'Main',
    ADMISSIONS: 'Admissions',
    INTERVIEW: 'Interview',
    PRACTICAL: 'Practical',
    FILES: 'Files',
    CONFIG: 'Config',
    LOG: 'Log'
  }
};


/** 下拉／複選選項清單 */
const OPTIONS = {
  MAIN_PATHS: [
    '四技二專甄選入學', '科技校院繁星計畫', '技優甄審', '技優保送',
    '特殊選才', '四技二專登記分發', '大學申請入學（學測）',
    '就業', '服役', '其他'
  ],

  CHANNELS: [
    '四技二專甄選入學', '科技校院繁星計畫', '技優甄審', '技優保送',
    '特殊選才', '四技二專登記分發', '大學申請入學（學測）', '其他'
  ],

  EXAM_GROUPS: [
    '電機與電子群電子類', '電機與電子群電機類', '機械群',
    '設計群', '商業與管理群', '其他', '未報考統測'
  ],

  CERTIFICATES: [
    '丙級電腦硬體裝修', '丙級工業電子', '乙級工業電子',
    '丙級數位電子', '乙級數位電子', '丙級儀表電子',
    '丙級室內配線', '乙級機電整合', '雲端物聯網應用',
    'TQC 系列', 'ITE 資訊專業人員', '其他'
  ],

  STAGE1_RESULTS: ['通過', '未通過', '不適用（無一階篩選）'],

  STAGE2_ITEMS: [
    '書面審查', '個人面試', '團體面試', '筆試',
    '術科實作', '實作測驗', '作品集'
  ],

  FINAL_RESULTS: ['正取', '備取', '未錄取', '未參加二階'],

  INTERVIEW_FORMATS: ['個人面試', '團體面試', '線上面試', '未面試'],

  QUESTION_CATEGORIES: [
    '自我介紹', '專業知識', '專題內容', '備審內容', '生涯規劃',
    '時事', '英文', '情境題', '臨場反應', '其他'
  ],

  PRACTICAL_SUBJECTS: [
    '電子電路實作', '程式設計', '數學筆試', '專業科目筆試',
    '專題口說', '電腦繪圖', '英文測驗', '其他'
  ],

  PORTFOLIO_ASKED: ['有，被問很多', '有，稍微問到', '沒有', '不記得'],

  PUBLISH_LEVELS: [
    '完全公開（顯示姓名）',
    '匿名公開（僅顯示「電子科 OO 級 X 同學」）',
    '僅供校內教師參考，不公開'
  ],

  FILE_CATEGORIES: ['術科題目', '作品照', '備審目錄', '其他'],

  REVIEW_STATUSES: ['待審', '通過', '退回修改']
};


/**
 * 資料表結構。key = 程式用欄位名，label = Sheet 表頭中文。
 * 寫入時依此順序組列，改順序只要動這裡。
 */
const SCHEMA = {
  // 欄位順序＝Sheet 欄位順序。姓名刻意排在前面，
  // 搭配凍結前 4 欄，橫向捲動時仍看得到這是誰的資料。
  MAIN: [
    { key: 'submission_id',    label: '提交編號' },
    { key: 'submitted_at',     label: '提交時間' },
    { key: 'grad_year',        label: '畢業學年度' },
    { key: 'name',             label: '姓名' },
    { key: 'class_name',       label: '班級' },
    { key: 'seat_no',          label: '座號' },
    { key: 'email',            label: '聯絡Email' },
    { key: 'phone',            label: '手機' },
    { key: 'social_id',        label: 'IG/Line' },
    { key: 'current_place',    label: '目前就讀學校或服務單位' },
    { key: 'school',           label: '畢業學校' },
    { key: 'dept',             label: '科別' },
    { key: 'main_path',        label: '主要出路' },
    { key: 'exam_group',       label: '報考群類' },
    { key: 'tve_ch',           label: '統測-國文' },
    { key: 'tve_en',           label: '統測-英文' },
    { key: 'tve_math',         label: '統測-數學' },
    { key: 'tve_prof1',        label: '統測-專業一' },
    { key: 'tve_prof2',        label: '統測-專業二' },
    { key: 'tve_total',        label: '統測-總分' },
    { key: 'rank_pct',         label: '在校成績班排百分比' },
    { key: 'certificates',     label: '持有證照' },
    { key: 'experiences',      label: '競賽/專題經歷' },
    { key: 'activities',       label: '幹部/社團/志工' },
    { key: 'portfolio_pages',  label: '備審頁數' },
    { key: 'portfolio_tool',   label: '備審製作工具' },
    { key: 'portfolio_hours',  label: '備審花費時數' },
    { key: 'portfolio_focus',  label: '備審重點' },
    { key: 'portfolio_asked',  label: '面試是否問到備審' },
    { key: 'reflection',       label: '整體心得' },
    { key: 'advice_1',         label: '建議1' },
    { key: 'advice_2',         label: '建議2' },
    { key: 'advice_3',         label: '建議3' },
    { key: 'do_earlier',       label: '高一高二該先做什麼' },
    { key: 'regret',           label: '最後悔沒做的事' },
    { key: 'willing_share',    label: '願意回校分享' },
    { key: 'willing_qa',       label: '接受學弟妹提問' },
    { key: 'consent_pdpa',     label: '個資同意' },
    { key: 'publish_level',    label: '公開層級' },
    { key: 'consent_photo',    label: '相片授權' },
    { key: 'review_status',    label: '審核狀態' },
    { key: 'review_note',      label: '審核意見' },
    { key: 'reviewed_at',      label: '審核時間' },
    { key: 'updated_at',       label: '最後修改時間' }
  ],

  ADMISSIONS: [
    { key: 'submission_id',  label: '提交編號' },
    { key: 'idx',            label: '志願序' },
    { key: 'univ',           label: '學校名稱' },
    { key: 'major',          label: '科系名稱' },
    { key: 'channel',        label: '招生管道' },
    { key: 'stage1_result',  label: '一階篩選' },
    { key: 'stage2_items',   label: '二階項目' },
    { key: 'stage2_score',   label: '二階成績' },
    { key: 'final_result',   label: '最終結果' },
    { key: 'result_rank',    label: '名次' },
    { key: 'is_enrolled',    label: '最終就讀' }
  ],

  INTERVIEW: [
    { key: 'submission_id',  label: '提交編號' },
    { key: 'admission_idx',  label: '志願序' },
    { key: 'univ',           label: '學校名稱' },
    { key: 'major',          label: '科系名稱' },
    { key: 'format',         label: '面試形式' },
    { key: 'prof_count',     label: '教授人數' },
    { key: 'duration_min',   label: '時間長度(分)' },
    { key: 'flow',           label: '面試流程' },
    { key: 'q_no',           label: '題號' },
    { key: 'question',       label: '題目' },
    { key: 'categories',     label: '題目分類' },
    { key: 'my_answer',      label: '我當時的回答' },
    { key: 'better_answer',  label: '回頭看該怎麼答' },
    { key: 'difficulty',     label: '難度(1-5)' },
    { key: 'tip',            label: '給學弟妹的提醒' }
  ],

  PRACTICAL: [
    { key: 'submission_id',  label: '提交編號' },
    { key: 'admission_idx',  label: '志願序' },
    { key: 'univ',           label: '學校名稱' },
    { key: 'major',          label: '科系名稱' },
    { key: 'subject',        label: '術科科目' },
    { key: 'duration_min',   label: '考試時間(分)' },
    { key: 'equipment',      label: '提供的設備工具' },
    { key: 'content',        label: '題目內容' },
    { key: 'prep_advice',    label: '準備方式建議' },
    { key: 'file_urls',      label: '相關相片連結' }
  ],

  FILES: [
    { key: 'submission_id',  label: '提交編號' },
    { key: 'file_id',        label: '檔案ID' },
    { key: 'file_name',      label: '檔名' },
    { key: 'file_url',       label: '檢視連結' },
    { key: 'category',       label: '用途' },
    { key: 'ref_idx',        label: '對應志願序' },
    { key: 'prc_idx',        label: '對應術科序' },   // 編輯時要靠這個把相片還原到正確的術科項目
    { key: 'uploaded_at',    label: '上傳時間' }
  ],

  LOG: [
    { key: 'timestamp',      label: '時間' },
    { key: 'level',          label: '層級' },
    { key: 'submission_id',  label: '提交編號' },
    { key: 'message',        label: '訊息' },
    { key: 'detail',         label: '細節' }
  ]
};


/**
 * Sheet 版面設定 —— 讓 40 幾欄的資料還讀得下去。
 * 沒列到的欄位一律用 DEFAULT_COL_WIDTH。
 */
const LAYOUT = {
  DEFAULT_COL_WIDTH: 110,

  COL_WIDTHS: {
    submission_id: 95,  submitted_at: 135, grad_year: 85,  name: 95,
    class_name: 90,     seat_no: 60,       email: 195,     phone: 110,
    social_id: 110,     current_place: 230, school: 210,   dept: 70,
    main_path: 155,     exam_group: 165,   rank_pct: 100,
    certificates: 230,  experiences: 300,  activities: 230,
    portfolio_focus: 300, portfolio_tool: 120,
    reflection: 400,    advice_1: 230,     advice_2: 230,  advice_3: 230,
    do_earlier: 270,    regret: 270,       publish_level: 220,
    review_status: 90,  review_note: 260,  reviewed_at: 135,
    updated_at: 135,    idx: 65,           admission_idx: 65,
    prc_idx: 75,
    univ: 175,          major: 160,        channel: 155,
    stage1_result: 110, stage2_items: 205, stage2_score: 100,
    final_result: 105,  result_rank: 70,   is_enrolled: 80,
    format: 100,        prof_count: 80,    duration_min: 95,
    flow: 300,          q_no: 55,          question: 340,
    categories: 185,    my_answer: 300,    better_answer: 300,
    difficulty: 85,     tip: 250,
    subject: 140,       equipment: 270,    content: 350,
    prep_advice: 270,   file_urls: 230,
    file_id: 120,       file_name: 210,    file_url: 230,
    category: 100,      ref_idx: 75,       uploaded_at: 135,
    timestamp: 135,     level: 70,         message: 330,   detail: 330
  },

  // 凍結欄數：橫向捲動時保留辨識用的前幾欄
  FROZEN_COLUMNS: {
    MAIN: 4,        // 編號、時間、學年度、姓名
    ADMISSIONS: 4,  // 編號、志願序、學校、科系
    INTERVIEW: 4,
    PRACTICAL: 4,
    FILES: 1,
    LOG: 2
  }
};


/**
 * 產生可選的畢業學年度清單（民國制）。
 * 8 月起算新學年度：2026-08 → 115 學年度。
 */
function getGradYears_() {
  const now = new Date();
  let roc = now.getFullYear() - 1911;
  if (now.getMonth() + 1 < 8) roc -= 1;   // 1~7 月仍屬前一學年度
  const years = [];
  for (let y = roc; y >= roc - 6; y--) years.push(String(y));
  return years;
}


/** 傳給前端的設定（不含任何機密資訊） */
function getClientConfig() {
  return {
    school: CONFIG.SCHOOL,
    dept: CONFIG.DEPT,
    gradYears: getGradYears_(),
    maxAdmissions: CONFIG.MAX_ADMISSIONS,
    maxFilesPerPractical: CONFIG.MAX_FILES_PER_PRACTICAL,
    maxFilesTotal: CONFIG.MAX_FILES_TOTAL,
    maxTotalBytes: CONFIG.MAX_TOTAL_BYTES,
    imageMaxEdge: CONFIG.IMAGE_MAX_EDGE,
    imageQuality: CONFIG.IMAGE_QUALITY,
    lockAfterApproved: CONFIG.LOCK_AFTER_APPROVED,
    options: OPTIONS
  };
}
