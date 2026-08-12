/**
 * 霧峰農工電子科 畢業生升學資料蒐集系統
 * Code.gs — 後端主程式
 *
 * 首次使用請先在編輯器選擇 initSetup 執行一次，會自動建立
 * 所有 Sheet 分頁與表頭，並確認 Drive 資料夾可存取。
 */

// ═══════════════════════════════════════════════════════════
//  Web App 進入點
// ═══════════════════════════════════════════════════════════

/**
 * 允許的頁面：檔名 → 標題。用白名單避免 ?page= 被亂帶值。
 * index 是封面頁（先選要做什麼，再進對應頁面），不帶 ?page= 時的預設值；
 * 原本「index＝表單頁」的角色搬到獨立的 form 頁。
 */
const PAGES = {
  index:  '首頁',
  form:   '填寫表單',
  browse: '歷屆經驗查詢',
  login:  '登入',
  admin:  '教師後台'
};

function doGet(e) {
  const req = (e && e.parameter && e.parameter.page) ? String(e.parameter.page) : 'index';
  const page = PAGES[req] ? req : 'index';

  return HtmlService.createTemplateFromFile(page)
    .evaluate()
    .setTitle(CONFIG.DEPT + ' 畢業生升學資料蒐集 — ' + PAGES[page])
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 供各頁面以 <?!= include('styles') ?> 引入其他檔案 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 給外部靜態網頁（例如 GitHub Pages）呼叫的 API 進入點。
 *
 * 前端必須用 Content-Type: text/plain 送出，才會被瀏覽器當成「簡單請求」
 * 而不觸發 CORS preflight（OPTIONS），因為 Apps Script 無法回應 OPTIONS。
 * 回應會經由 script.googleusercontent.com 轉址，該網域帶有
 * Access-Control-Allow-Origin: *，所以前端讀得到回傳的 JSON。
 */
function doPost(e) {
  let res;
  try {
    if (!e || !e.postData || !e.postData.contents) {
      res = fail_('沒有收到資料內容。');
    } else {
      const req = JSON.parse(e.postData.contents);
      res = routeApi_(req);
    }
  } catch (err) {
    // requireRole_ 之類的權限錯誤走這裡，轉成前端看得懂的訊息
    const msg = err && err.message ? err.message : String(err);
    writeLog_('ERROR', '', 'doPost 失敗：' + msg, String(err && err.stack ? err.stack : ''));
    res = fail_(msg);
  }
  return ContentService
    .createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 給 google.script.run 呼叫的公開包裝。
 * Apps Script 規定底線結尾的函式為私有、前端叫不到，所以不能直接暴露 routeApi_。
 */
function apiCall(req) {
  try {
    return routeApi_(req || {});
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    writeLog_('ERROR', '', 'apiCall 失敗：' + msg, String(err && err.stack ? err.stack : ''));
    return fail_(msg);
  }
}

/** GAS 模式下頁面之間互相連結需要的基底網址；尚未部署時回空字串 */
function getWebAppUrl() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}

/** action 路由。沒帶 action 視為 submit，維持舊版前端相容 */
function routeApi_(req) {
  switch (String(req.action || 'submit')) {
    case 'submit':       return submitForm(req);
    case 'loginTeacher': return loginTeacher_(req);
    case 'loginStudent': return loginStudent_(req);
    case 'logout':       return logout_(req);
    case 'loadOwn':      return loadOwn_(req);
    case 'updateOwn':    return updateOwn_(req);
    case 'adminList':    return adminList_(req);
    case 'adminDetail':  return adminDetail_(req);
    case 'adminReview':  return adminReview_(req);
    case 'adminEditField':  return adminEditField_(req);
    case 'adminEditHistory': return adminEditHistory_(req);
    case 'adminDelete':  return adminDelete_(req);
    case 'adminExport':  return adminExport_(req);
    case 'browse':       return browse_(req);
    default:             return fail_('不支援的操作：' + req.action);
  }
}


// ═══════════════════════════════════════════════════════════
//  初始化：建立分頁與表頭（手動執行一次）
// ═══════════════════════════════════════════════════════════

function initSetup() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const created = [];

  Object.keys(SCHEMA).forEach(function (schemaKey) {
    const name = CONFIG.SHEETS[schemaKey];
    const headers = SCHEMA[schemaKey].map(function (c) { return c.label; });
    const existed = !!ss.getSheetByName(name);
    const sh = ensureSheet_(ss, name, headers);
    applyFormatting_(sh, SCHEMA[schemaKey], schemaKey);
    if (!existed) created.push(name);
  });

  // Config 分頁：把選項清單寫進去備查（純參考，程式不讀它）
  const cfgSheet = ensureSheet_(ss, CONFIG.SHEETS.CONFIG, ['選項類別', '選項值']);
  cfgSheet.getRange(2, 1, Math.max(cfgSheet.getLastRow() - 1, 1), 2).clearContent();
  const cfgRows = [];
  Object.keys(OPTIONS).forEach(function (k) {
    OPTIONS[k].forEach(function (v) { cfgRows.push([k, v]); });
  });
  getGradYears_().forEach(function (y) { cfgRows.push(['GRAD_YEARS', y]); });
  if (cfgRows.length) cfgSheet.getRange(2, 1, cfgRows.length, 2).setValues(cfgRows);

  // 檢查 Drive 資料夾
  let folderName = '';
  try {
    folderName = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID).getName();
  } catch (e) {
    throw new Error('無法存取 Drive 資料夾，請確認 CONFIG.DRIVE_FOLDER_ID 正確且此帳號有權限：' + e.message);
  }

  const msg = '初始化完成。\n試算表：' + ss.getName() +
              '\n新建分頁：' + (created.length ? created.join(', ') : '（無，皆已存在）') +
              '\n相片資料夾：' + folderName +
              '\n已套用版面：中文表頭、欄位代碼註解、欄寬、凍結欄、篩選器、交錯底色' +
              '\n（本函式可重複執行，只調整版面不會動到資料；' +
              '但若 SCHEMA 欄位順序有改，請先確認分頁沒有舊資料，否則會與新表頭對不上）';
  Logger.log(msg);
  return msg;
}

// ═══════════════════════════════════════════════════════════
//  證照選項改名：批次更新舊資料（手動執行一次）
// ═══════════════════════════════════════════════════════════

/**
 * 只預覽會影響哪幾筆資料，不會寫入任何東西。
 * 請先執行這支、在「執行紀錄」看過清單確認沒問題，
 * 再執行 applyCertificateRename() 真正寫入。
 */
function previewCertificateRename() {
  const changes = findCertificateRenameChanges_();

  if (!changes.length) {
    const msg = '沒有資料需要更新，所有證照名稱都已經是新的了。';
    Logger.log(msg);
    return msg;
  }

  const lines = changes.map(function (c) {
    return c.code + '（' + c.name + '）第 ' + c.row + ' 列\n  舊：' + c.before + '\n  新：' + c.after;
  });
  const msg = '共 ' + changes.length + ' 筆會被更新：\n\n' + lines.join('\n\n') +
              '\n\n確認無誤後，執行 applyCertificateRename() 才會真的寫入。';
  Logger.log(msg);
  return msg;
}

/**
 * 實際把舊證照名稱改成新名稱，直接覆寫 Main 分頁的「持有證照」欄位。
 * 請先執行 previewCertificateRename() 確認清單再執行這支。
 */
function applyCertificateRename() {
  const changes = findCertificateRenameChanges_();
  if (!changes.length) {
    const msg = '沒有資料需要更新。';
    Logger.log(msg);
    return msg;
  }

  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
      const msg = '系統忙碌中，請稍後再試一次。';
      Logger.log(msg);
      return msg;
    }

    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const sh = ss.getSheetByName(CONFIG.SHEETS.MAIN);
    const colCert = indexOfKey_(SCHEMA.MAIN, 'certificates') + 1;

    changes.forEach(function (c) {
      sh.getRange(c.row, colCert).setValue(c.after);
    });
    SpreadsheetApp.flush();

    const msg = '完成，共更新 ' + changes.length + ' 筆資料的證照名稱。';
    Logger.log(msg);
    writeLog_('INFO', '', '批次更新證照名稱', msg + '\n' +
      changes.map(function (c) { return c.code + '：' + c.before + ' → ' + c.after; }).join('\n'));
    return msg;
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

/** 掃描 Main 分頁，回傳含有舊證照名稱的列與改名後的結果，不寫入任何東西 */
function findCertificateRenameChanges_() {
  const map = CONFIG.CERTIFICATE_RENAME_MAP;
  const rows = readSheetObjects_(CONFIG.SHEETS.MAIN, SCHEMA.MAIN);
  const changes = [];

  rows.forEach(function (r) {
    const raw = String(r.data.certificates || '');
    if (!raw.trim()) return;

    let changed = false;
    const newList = splitList_(raw).map(function (c) {
      if (map[c]) { changed = true; return map[c]; }
      return c;
    });
    if (!changed) return;

    changes.push({
      row: r.row,
      code: String(r.data.submission_id || '').substring(0, 6).toUpperCase(),
      name: String(r.data.name || ''),
      before: raw,
      after: newList.join('、')
    });
  });

  return changes;
}


/** 取得分頁，不存在就建立；表頭與 SCHEMA 不符時重寫表頭 */
function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const width = headers.length;

  // 新分頁預設只有 26 欄，Main 有 40 欄以上，不先擴充會讓 getRange 超出範圍
  const maxCols = sh.getMaxColumns();
  if (maxCols < width) sh.insertColumnsAfter(maxCols, width - maxCols);

  const current = sh.getLastColumn() > 0
    ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    : [];
  const same = current.length === width && current.every(function (v, i) { return v === headers[i]; });
  if (!same) {
    sh.getRange(1, 1, 1, width).setValues([headers]);
    sh.getRange(1, 1, 1, width)
      .setFontWeight('bold')
      .setBackground('#1a3a5c')
      .setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}


/**
 * 套用閱讀用版面：表頭樣式、欄寬、凍結、篩選器、交錯底色。
 * 可重複執行，不會動到任何資料。
 */
function applyFormatting_(sh, schema, schemaKey) {
  const width = schema.length;

  // ── 表頭：深藍底白字、置中、自動換行，並在每欄加上欄位代碼註解 ──
  const head = sh.getRange(1, 1, 1, width);
  head.setFontWeight('bold')
      .setBackground('#1a3a5c')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setWrap(true);
  sh.setRowHeight(1, 46);

  const notes = [schema.map(function (c) {
    return '欄位代碼：' + c.key + '\n（改欄位請對照 config.gs 的 SCHEMA）';
  })];
  head.setNotes(notes);

  // ── 欄寬 ──
  schema.forEach(function (col, i) {
    const w = LAYOUT.COL_WIDTHS[col.key] || LAYOUT.DEFAULT_COL_WIDTH;
    sh.setColumnWidth(i + 1, w);
  });

  // ── 凍結：橫向捲動時保留辨識用欄位 ──
  sh.setFrozenRows(1);
  const frozen = LAYOUT.FROZEN_COLUMNS[schemaKey] || 0;
  if (frozen > 0 && frozen <= width) sh.setFrozenColumns(frozen);

  // ── 資料區：切齊上方、長文字裁切不換行，避免一篇心得把整列撐到滿螢幕 ──
  const dataRows = sh.getMaxRows() - 1;
  if (dataRows > 0) {
    sh.getRange(2, 1, dataRows, width)
      .setVerticalAlignment('top')
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  }

  // ── 篩選器：方便依學年度、學校、結果快速過濾 ──
  const existingFilter = sh.getFilter();
  if (existingFilter) existingFilter.remove();
  sh.getRange(1, 1, sh.getMaxRows(), width).createFilter();

  // ── 交錯底色：只套資料區，不含表頭，否則佈景主題的表頭色會蓋掉上面的深藍 ──
  // 重套前必須先移除舊的，同一範圍套第二次會拋錯。
  sh.getBandings().forEach(function (b) { b.remove(); });
  if (dataRows > 0) {
    sh.getRange(2, 1, dataRows, width)
      .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  }
}


// ═══════════════════════════════════════════════════════════
//  主要提交流程
// ═══════════════════════════════════════════════════════════

const SUBMIT_RATE_KEY = 'submit_rate_window';

/**
 * 送出前的防灌水檢查：蜜罐欄位 + 全站流量限制。
 *
 * 刻意放在 LockService.tryLock() 之前執行 —— 灌水請求若先排隊等鎖
 * （最多可等 30 秒），等於讓每一筆垃圾請求都佔用一個執行環境的時間，
 * 反而變成另一種形式的阻斷服務。先擋掉可疑請求，合法使用者才不受影響。
 *
 * 回傳非 null 代表要擋下，訊息可直接回給前端；回傳 null 代表放行。
 */
function checkSubmitAbuse_(payload) {
  // 蜜罐：這個欄位在畫面上對真人不可見，只有無腦把整份表單欄位都填一遍的
  // 自動化機器人才會填到它。擋不住讀過原始碼、刻意針對本站寫程式的人，
  // 但那種對手本來就不是這一層要防的範圍。
  const hp = payload && payload.main ? payload.main[CONFIG.HONEYPOT_FIELD] : '';
  if (String(hp || '').trim() !== '') {
    writeLog_('WARN', '', '疑似機器人提交（蜜罐欄位被填寫）', String(hp).slice(0, 100));
    return '提交失敗，請重新整理頁面再試一次。';
  }

  // 全站流量限制：短時間內提交嘗試過多就先擋下，避免灌爆 Sheet／Drive／寄信配額。
  // 用全站共用計數器而非依來源區分，因為 Apps Script 拿不到穩定的來源 IP。
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get(SUBMIT_RATE_KEY) || 0) + 1;
  cache.put(SUBMIT_RATE_KEY, String(count), CONFIG.SUBMIT_WINDOW_MIN * 60);
  if (count > CONFIG.MAX_SUBMISSIONS_PER_WINDOW) {
    writeLog_('WARN', '', '觸發全站流量限制',
      '這個 ' + CONFIG.SUBMIT_WINDOW_MIN + ' 分鐘的時間窗已有 ' + count + ' 筆提交嘗試');
    return '目前提交人數較多，請幾分鐘後再試一次。';
  }

  return null;
}

/**
 * 前端呼叫入口。
 * @param {Object} payload { main: {...}, admissions: [ {..., interviews:[], practicals:[]} ] }
 * @return {Object} { ok:boolean, submissionId?:string, message?:string }
 */
function submitForm(payload) {
  const abuseMsg = checkSubmitAbuse_(payload);
  if (abuseMsg) return fail_(abuseMsg);

  const lock = LockService.getScriptLock();
  let submissionId = '';

  try {
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
      return fail_('系統忙碌中（同時有其他人送出），請 10 秒後再試一次。');
    }

    // ── 驗證 ──
    const err = validate_(payload);
    if (err) return fail_(err);

    const main = payload.main;
    const admissions = payload.admissions || [];

    // ── 重複提交檢查 ──
    if (CONFIG.BLOCK_DUPLICATE) {
      const dup = findDuplicate_(main.email, main.grad_year);
      if (dup) {
        return fail_('這個 Email 在「' + gradYearLabel_(main.grad_year) + '」已經填過了（提交編號 ' +
                     dup + '）。如需修改，請聯絡 ' + CONFIG.CONTACT_NAME + ' 承辦老師。');
      }
    }

    submissionId = Utilities.getUuid();
    const now = new Date();
    const shortId = submissionId.substring(0, 6).toUpperCase();

    // ── 上傳相片（先做，失敗才不會留下半筆資料）──
    const uploaded = uploadAllFiles_(admissions, main, submissionId, shortId);

    // ── 寫入（與「畢業生修改」共用同一段邏輯，避免兩邊格式走鐘）──
    const n = writeRecord_(submissionId, main, admissions, uploaded, {
      submitted_at: now,
      review_status: '待審'
    });
    SpreadsheetApp.flush();

    writeLog_('INFO', submissionId,
      '提交成功：' + main.name + ' / ' + main.grad_year + ' 學年度',
      '校系 ' + n.adm + ' 筆、口試題 ' + n.itv +
      ' 題、術科 ' + n.prc + ' 項、相片 ' + n.file + ' 張');

    // ── 寄信（失敗不影響資料已寫入）──
    try {
      sendMails_(main, shortId, n.adm, n.itv, n.prc);
    } catch (mailErr) {
      writeLog_('WARN', submissionId, '寄信失敗（資料已成功寫入）', String(mailErr));
    }

    return { ok: true, submissionId: shortId };

  } catch (e) {
    writeLog_('ERROR', submissionId, String(e && e.message ? e.message : e), String(e && e.stack ? e.stack : ''));
    return fail_('儲存時發生錯誤：' + (e && e.message ? e.message : e) +
                 '\n請稍後再試，若持續失敗請聯絡承辦老師。');
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function fail_(message) {
  return { ok: false, message: message };
}


// ═══════════════════════════════════════════════════════════
//  驗證
// ═══════════════════════════════════════════════════════════

function validate_(payload) {
  if (!payload || !payload.main) return '表單資料不完整，請重新整理頁面再試。';
  const m = payload.main;

  const required = [
    ['grad_year', '畢業學年度'],
    ['name', '姓名'],
    ['email', '聯絡 Email'],
    ['current_place', '目前就讀學校／服務單位'],
    ['main_path', '主要出路'],
    ['reflection', '整體心得'],
    ['publish_level', '公開層級']
  ];
  for (let i = 0; i < required.length; i++) {
    if (!String(m[required[i][0]] || '').trim()) {
      return '「' + required[i][1] + '」為必填欄位。';
    }
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(m.email).trim())) {
    return 'Email 格式看起來不正確，請再檢查一次。';
  }
  if (!m.consent_pdpa) {
    return '需要勾選個人資料蒐集同意才能送出。';
  }
  if (!String(m.advice_1 || '').trim() &&
      !String(m.advice_2 || '').trim() &&
      !String(m.advice_3 || '').trim()) {
    return '「給學弟妹的建議」至少要填寫一則。';
  }

  const adms = payload.admissions || [];
  if (adms.length > CONFIG.MAX_ADMISSIONS) {
    return '推甄校系最多 ' + CONFIG.MAX_ADMISSIONS + ' 筆。';
  }
  for (let j = 0; j < adms.length; j++) {
    const a = adms[j];
    const hasAny = String(a.univ || '').trim() || String(a.major || '').trim();
    if (hasAny && (!String(a.univ || '').trim() || !String(a.major || '').trim())) {
      return '第 ' + (j + 1) + ' 個志願的學校名稱與科系名稱都要填寫。';
    }
  }

  // 檔案數量與大小
  let fileCount = 0;
  let totalBytes = 0;
  for (let k = 0; k < adms.length; k++) {
    const prcs = adms[k].practicals || [];
    for (let n = 0; n < prcs.length; n++) {
      const files = prcs[n].files || [];
      if (files.length > CONFIG.MAX_FILES_PER_PRACTICAL) {
        return '每個術科項目最多上傳 ' + CONFIG.MAX_FILES_PER_PRACTICAL + ' 張相片。';
      }
      for (let f = 0; f < files.length; f++) {
        fileCount++;
        totalBytes += Math.floor(String(files[f].data || '').length * 3 / 4);
      }
    }
  }
  if (fileCount > CONFIG.MAX_FILES_TOTAL) {
    return '整份表單最多上傳 ' + CONFIG.MAX_FILES_TOTAL + ' 張相片，目前有 ' + fileCount + ' 張。';
  }
  if (totalBytes > CONFIG.MAX_TOTAL_BYTES) {
    return '相片總容量超過上限（' + Math.round(CONFIG.MAX_TOTAL_BYTES / 1024 / 1024) +
           ' MB），請減少張數。目前約 ' + (totalBytes / 1024 / 1024).toFixed(1) + ' MB。';
  }

  return null;
}


/** 回傳既有的提交編號短碼，沒有則回 null */
function findDuplicate_(email, gradYear) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sh = ss.getSheetByName(CONFIG.SHEETS.MAIN);
  if (!sh || sh.getLastRow() < 2) return null;

  const colId = indexOfKey_(SCHEMA.MAIN, 'submission_id') + 1;
  const colEmail = indexOfKey_(SCHEMA.MAIN, 'email') + 1;
  const colYear = indexOfKey_(SCHEMA.MAIN, 'grad_year') + 1;

  const n = sh.getLastRow() - 1;
  const width = sh.getLastColumn();
  if (width < Math.max(colId, colEmail, colYear)) return null;   // 表頭不完整，跳過檢查
  const values = sh.getRange(2, 1, n, width).getValues();
  const target = String(email).trim().toLowerCase();

  for (let i = 0; i < values.length; i++) {
    const e = String(values[i][colEmail - 1] || '').trim().toLowerCase();
    const y = String(values[i][colYear - 1] || '').trim();
    if (e && e === target && y === String(gradYear).trim()) {
      return String(values[i][colId - 1] || '').substring(0, 6).toUpperCase();
    }
  }
  return null;
}


// ═══════════════════════════════════════════════════════════
//  Drive 相片上傳
// ═══════════════════════════════════════════════════════════

/**
 * 上傳全部相片。回傳 [{ id, name, url, category, admIdx, prcIdx }]
 * 目錄：{根資料夾}/{學年度}學年度/{姓名}_{短碼}/
 */
function uploadAllFiles_(admissions, main, submissionId, shortId) {
  const result = [];
  let hasAnyFile = false;
  admissions.forEach(function (a) {
    (a.practicals || []).forEach(function (p) {
      if ((p.files || []).length) hasAnyFile = true;
    });
  });
  if (!hasAnyFile) return result;

  const root = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  const yearFolder = getOrCreateFolder_(root, String(main.grad_year) + '學年度');
  const safeName = String(main.name || '未具名').replace(/[\\/:*?"<>|]/g, '_');
  const personFolder = getOrCreateFolder_(yearFolder, safeName + '_' + shortId);

  let seq = 0;
  admissions.forEach(function (a, ai) {
    (a.practicals || []).forEach(function (p, pi) {
      (p.files || []).forEach(function (f) {
        seq++;
        const category = f.category || '術科題目';
        const ext = mimeToExt_(f.mimeType);
        const fileName = [
          String(ai + 1) + '-' + String(pi + 1),
          (a.univ || '未填校名').replace(/[\\/:*?"<>|]/g, '_'),
          category,
          String(seq)
        ].join('_') + ext;

        const blob = Utilities.newBlob(
          Utilities.base64Decode(f.data),
          f.mimeType || 'image/jpeg',
          fileName
        );
        const file = personFolder.createFile(blob);
        result.push({
          id: file.getId(),
          name: fileName,
          url: file.getUrl(),
          category: category,
          admIdx: ai,
          prcIdx: pi
        });
      });
    });
  });

  return result;
}

function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function mimeToExt_(mime) {
  switch (String(mime).toLowerCase()) {
    case 'image/png': return '.png';
    case 'image/webp': return '.webp';
    default: return '.jpg';
  }
}


// ═══════════════════════════════════════════════════════════
//  Sheet 寫入工具
// ═══════════════════════════════════════════════════════════

/** 依 schema 順序把物件組成一維陣列 */
function buildRow_(schema, obj) {
  return schema.map(function (col) {
    const v = obj[col.key];
    if (v === undefined || v === null) return '';
    if (v === true) return 'V';
    if (v === false) return '';
    if (Array.isArray(v)) return joinList_(v);
    return v;
  });
}

function appendRows_(ss, sheetName, schema, rows) {
  if (!rows || !rows.length) return;
  const sh = ss.getSheetByName(sheetName) ||
             ensureSheet_(ss, sheetName, schema.map(function (c) { return c.label; }));
  const start = Math.max(sh.getLastRow(), 1) + 1;

  // 列數不足時先補列，避免 setValues 超出範圍
  const need = start + rows.length - 1;
  const maxRows = sh.getMaxRows();
  if (maxRows < need) sh.insertRowsAfter(maxRows, need - maxRows);

  sh.getRange(start, 1, rows.length, schema.length).setValues(rows);
}

function indexOfKey_(schema, key) {
  for (let i = 0; i < schema.length; i++) if (schema[i].key === key) return i;
  return -1;
}

function joinList_(v) {
  if (!v) return '';
  if (Array.isArray(v)) return v.filter(String).join('、');
  return String(v);
}

function writeLog_(level, submissionId, message, detail) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const sh = ss.getSheetByName(CONFIG.SHEETS.LOG) ||
               ensureSheet_(ss, CONFIG.SHEETS.LOG, SCHEMA.LOG.map(function (c) { return c.label; }));
    sh.appendRow([new Date(), level, submissionId || '', message || '', detail || '']);
  } catch (ignore) {
    Logger.log('writeLog_ 失敗：' + level + ' ' + message);
  }
}


// ═══════════════════════════════════════════════════════════
//  通知信
// ═══════════════════════════════════════════════════════════

/**
 * 寄確認信與通知信。
 *
 * 加了每日寄信配額保護：MailApp.getRemainingDailyQuota() 是 Google 自己
 * 追蹤的真實剩餘額度（比自己另外用計數器猜準），配額快用完時優先犧牲
 * 「教師通知信」這種非必要的，保留「學生確認信」——萬一真的被灌水，
 * 受害的應該是你的收件匣，而不是某個認真填表的學生收不到憑證信。
 */
function sendMails_(main, shortId, admCount, itvCount, prcCount) {
  const summary =
    '畢業學年度：' + gradYearLabel_(main.grad_year) + '\n' +
    '姓名：' + main.name + '\n' +
    '目前就讀／服務：' + main.current_place + '\n' +
    '主要出路：' + main.main_path + '\n' +
    '推甄校系：' + admCount + ' 筆　口試題目：' + itvCount + ' 題　術科：' + prcCount + ' 項\n' +
    '提交編號：' + shortId;

  const remaining = MailApp.getRemainingDailyQuota();
  const canNotify = !!CONFIG.NOTIFY_EMAIL && remaining > CONFIG.MAIL_QUOTA_RESERVE;
  const canConfirm = !!CONFIG.SEND_CONFIRM_MAIL && !!main.email && remaining > 0;

  // 通知承辦教師
  if (canNotify) {
    MailApp.sendEmail({
      to: CONFIG.NOTIFY_EMAIL,
      subject: '[畢業生資料] 新提交 — ' + main.name + '（' + gradYearLabel_(main.grad_year, true) + '）',
      body: summary + '\n\n公開層級：' + main.publish_level +
            '\n聯絡 Email：' + main.email +
            '\n\n試算表：https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID + '/edit'
    });
  } else if (CONFIG.NOTIFY_EMAIL) {
    writeLog_('WARN', '', '寄信配額不足，跳過教師通知信', '剩餘配額 ' + remaining);
  }

  // 確認信給學生
  if (canConfirm) {
    MailApp.sendEmail({
      to: main.email,
      subject: '【' + CONFIG.CONTACT_NAME + '】畢業生升學資料已收到（編號 ' + shortId + '）',
      htmlBody:
        '<div style="font-family:sans-serif;line-height:1.7;color:#222">' +
        '<p>' + escapeHtml_(main.name) + ' 同學你好，</p>' +
        '<p>你填寫的畢業生升學資料已經收到，非常感謝你願意把經驗留給學弟妹。</p>' +
        '<pre style="background:#f4f6f8;padding:12px;border-radius:8px;white-space:pre-wrap">' +
        escapeHtml_(summary) + '</pre>' +
        '<p><strong>要修改資料的話</strong>，請到表單網站點「登入修改」，' +
        '用<strong>提交編號 ' + escapeHtml_(shortId) + '</strong> 加上<strong>這個 Email</strong> 登入即可。</p>' +
        '<p style="color:#b45309">請保留這封信，並不要把提交編號轉傳給別人 —— ' +
        '編號加上你的 Email 就是修改資料的憑證。老師審核通過後就會鎖定，屆時無法再自行修改。</p>' +
        '<p style="color:#777;font-size:13px">' + escapeHtml_(CONFIG.SCHOOL) + ' ' +
        escapeHtml_(CONFIG.DEPT) + '</p></div>'
    });
  } else if (CONFIG.SEND_CONFIRM_MAIL && main.email) {
    writeLog_('WARN', '', '寄信配額不足，學生確認信未寄出',
      '剩餘配額 ' + remaining + '，收件人 ' + main.email);
  }
}

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
