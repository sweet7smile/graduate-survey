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

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle(CONFIG.DEPT + ' 畢業生升學資料蒐集')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 供 index.html 以 <?!= include('styles') ?> 引入其他檔案 */
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
      res = submitForm(JSON.parse(e.postData.contents));
    }
  } catch (err) {
    writeLog_('ERROR', '', 'doPost 解析失敗', String(err && err.stack ? err.stack : err));
    res = fail_('資料格式錯誤：' + (err && err.message ? err.message : err));
  }
  return ContentService
    .createTextOutput(JSON.stringify(res))
    .setMimeType(ContentService.MimeType.JSON);
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

/**
 * 前端呼叫入口。
 * @param {Object} payload { main: {...}, admissions: [ {..., interviews:[], practicals:[]} ] }
 * @return {Object} { ok:boolean, submissionId?:string, message?:string }
 */
function submitForm(payload) {
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
        return fail_('這個 Email 在 ' + main.grad_year + ' 學年度已經填過了（提交編號 ' +
                     dup + '）。如需修改，請聯絡 ' + CONFIG.CONTACT_NAME + ' 承辦老師。');
      }
    }

    submissionId = Utilities.getUuid();
    const now = new Date();
    const shortId = submissionId.substring(0, 6).toUpperCase();

    // ── 上傳相片（先做，失敗才不會留下半筆資料）──
    const uploaded = uploadAllFiles_(admissions, main, submissionId, shortId);

    // ── 組列 ──
    const mainRow = buildRow_(SCHEMA.MAIN, Object.assign({}, main, {
      submission_id: submissionId,
      submitted_at: now,
      school: CONFIG.SCHOOL,
      dept: CONFIG.DEPT,
      review_status: '待審'
    }));

    const admRows = [];
    const itvRows = [];
    const prcRows = [];

    admissions.forEach(function (a, ai) {
      const idx = ai + 1;
      const univ = a.univ || '';
      const major = a.major || '';

      admRows.push(buildRow_(SCHEMA.ADMISSIONS, Object.assign({}, a, {
        submission_id: submissionId,
        idx: idx,
        stage2_items: joinList_(a.stage2_items),
        is_enrolled: a.is_enrolled ? 'V' : ''
      })));

      (a.interviews || []).forEach(function (q, qi) {
        if (!String(q.question || '').trim()) return;
        itvRows.push(buildRow_(SCHEMA.INTERVIEW, Object.assign({}, q, {
          submission_id: submissionId,
          admission_idx: idx,
          univ: univ,
          major: major,
          format: a.itv_format || '',
          prof_count: a.itv_prof_count || '',
          duration_min: a.itv_duration_min || '',
          flow: a.itv_flow || '',
          q_no: qi + 1,
          categories: joinList_(q.categories)
        })));
      });

      (a.practicals || []).forEach(function (p, pi) {
        if (!String(p.content || '').trim() && !String(p.subject || '').trim()) return;
        const urls = uploaded
          .filter(function (f) { return f.admIdx === ai && f.prcIdx === pi; })
          .map(function (f) { return f.url; });
        prcRows.push(buildRow_(SCHEMA.PRACTICAL, Object.assign({}, p, {
          submission_id: submissionId,
          admission_idx: idx,
          univ: univ,
          major: major,
          file_urls: urls.join('\n')
        })));
      });
    });

    const fileRows = uploaded.map(function (f) {
      return buildRow_(SCHEMA.FILES, {
        submission_id: submissionId,
        file_id: f.id,
        file_name: f.name,
        file_url: f.url,
        category: f.category,
        ref_idx: f.admIdx + 1,
        uploaded_at: now
      });
    });

    // ── 寫入 ──
    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    appendRows_(ss, CONFIG.SHEETS.MAIN, SCHEMA.MAIN, [mainRow]);
    appendRows_(ss, CONFIG.SHEETS.ADMISSIONS, SCHEMA.ADMISSIONS, admRows);
    appendRows_(ss, CONFIG.SHEETS.INTERVIEW, SCHEMA.INTERVIEW, itvRows);
    appendRows_(ss, CONFIG.SHEETS.PRACTICAL, SCHEMA.PRACTICAL, prcRows);
    appendRows_(ss, CONFIG.SHEETS.FILES, SCHEMA.FILES, fileRows);
    SpreadsheetApp.flush();

    writeLog_('INFO', submissionId,
      '提交成功：' + main.name + ' / ' + main.grad_year + ' 學年度',
      '校系 ' + admRows.length + ' 筆、口試題 ' + itvRows.length +
      ' 題、術科 ' + prcRows.length + ' 項、相片 ' + fileRows.length + ' 張');

    // ── 寄信（失敗不影響資料已寫入）──
    try {
      sendMails_(main, shortId, admRows.length, itvRows.length, prcRows.length);
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

function sendMails_(main, shortId, admCount, itvCount, prcCount) {
  const summary =
    '畢業學年度：' + main.grad_year + ' 學年度\n' +
    '姓名：' + main.name + '\n' +
    '目前就讀／服務：' + main.current_place + '\n' +
    '主要出路：' + main.main_path + '\n' +
    '推甄校系：' + admCount + ' 筆　口試題目：' + itvCount + ' 題　術科：' + prcCount + ' 項\n' +
    '提交編號：' + shortId;

  // 通知承辦教師
  if (CONFIG.NOTIFY_EMAIL) {
    MailApp.sendEmail({
      to: CONFIG.NOTIFY_EMAIL,
      subject: '[畢業生資料] 新提交 — ' + main.name + '（' + main.grad_year + ' 學年度）',
      body: summary + '\n\n公開層級：' + main.publish_level +
            '\n聯絡 Email：' + main.email +
            '\n\n試算表：https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID + '/edit'
    });
  }

  // 確認信給學生
  if (CONFIG.SEND_CONFIRM_MAIL && main.email) {
    MailApp.sendEmail({
      to: main.email,
      subject: '【' + CONFIG.CONTACT_NAME + '】畢業生升學資料已收到（編號 ' + shortId + '）',
      htmlBody:
        '<div style="font-family:sans-serif;line-height:1.7;color:#222">' +
        '<p>' + escapeHtml_(main.name) + ' 同學你好，</p>' +
        '<p>你填寫的畢業生升學資料已經收到，非常感謝你願意把經驗留給學弟妹。</p>' +
        '<pre style="background:#f4f6f8;padding:12px;border-radius:8px;white-space:pre-wrap">' +
        escapeHtml_(summary) + '</pre>' +
        '<p>請保留這封信作為憑證。若資料需要修改，請回信或聯絡科上老師。</p>' +
        '<p style="color:#777;font-size:13px">' + escapeHtml_(CONFIG.SCHOOL) + ' ' +
        escapeHtml_(CONFIG.DEPT) + '</p></div>'
    });
  }
}

function escapeHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
