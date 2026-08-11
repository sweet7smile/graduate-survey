/**
 * Api.gs — 讀取、更新、審核、匯出、公開瀏覽
 *
 * 所有函式都回傳 { ok:boolean, ... }，由 doPost 統一序列化成 JSON。
 */

// ═══════════════════════════════════════════════════════════
//  Sheet 讀取工具
// ═══════════════════════════════════════════════════════════

/** 把整張分頁讀成物件陣列，附帶列號方便之後刪改 */
function readSheetObjects_(sheetName, schema) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];

  const width = Math.min(schema.length, sh.getLastColumn());
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();

  return values.map(function (r, i) {
    const o = {};
    for (let c = 0; c < width; c++) o[schema[c].key] = r[c];
    return { row: i + 2, data: o };
  });
}

/** 依提交編號前 6 碼找 Main 的那一列 */
function findMainRowByCode_(code) {
  const all = readSheetObjects_(CONFIG.SHEETS.MAIN, SCHEMA.MAIN);
  const want = String(code).trim().toUpperCase();
  for (let i = 0; i < all.length; i++) {
    const id = String(all[i].data.submission_id || '');
    if (id.substring(0, 6).toUpperCase() === want) return all[i];
  }
  return null;
}

function findMainRowById_(submissionId) {
  const all = readSheetObjects_(CONFIG.SHEETS.MAIN, SCHEMA.MAIN);
  for (let i = 0; i < all.length; i++) {
    if (String(all[i].data.submission_id) === String(submissionId)) return all[i];
  }
  return null;
}

/** 刪除某分頁中所有屬於這筆提交的列（由下往上刪，避免列號位移） */
function deleteRowsOf_(sheetName, schema, submissionId) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  const sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return 0;

  const rows = readSheetObjects_(sheetName, schema)
    .filter(function (r) { return String(r.data.submission_id) === String(submissionId); })
    .map(function (r) { return r.row; })
    .sort(function (a, b) { return b - a; });

  rows.forEach(function (rowNum) { sh.deleteRow(rowNum); });
  return rows.length;
}

function toBool_(v) {
  return v === true || String(v).trim().toUpperCase() === 'V';
}

/** Sheet 存的是頓號串接的字串，還原成陣列給前端 */
function splitList_(v) {
  const s = String(v == null ? '' : v).trim();
  return s ? s.split(/[、,，]/).map(function (x) { return x.trim(); }).filter(Boolean) : [];
}


// ═══════════════════════════════════════════════════════════
//  畢業生：載入自己的資料
// ═══════════════════════════════════════════════════════════

function loadOwn_(req) {
  const sess = requireRole_(req.token, 'student');
  const payload = buildFullRecord_(sess.submissionId);
  if (!payload) return fail_('找不到你的資料，請重新登入。');

  const status = String(payload.main.review_status || '').trim();
  return {
    ok: true,
    record: payload,
    reviewStatus: status,
    reviewNote: String(payload.main.review_note || ''),
    locked: CONFIG.LOCK_AFTER_APPROVED && status === '通過'
  };
}

/** 從五張分頁重組出一筆完整資料（與前端送出的 payload 同結構） */
function buildFullRecord_(submissionId) {
  const mainRow = findMainRowById_(submissionId);
  if (!mainRow) return null;

  const main = mainRow.data;
  main.certificates = splitList_(main.certificates);
  main.willing_share = toBool_(main.willing_share);
  main.willing_qa = toBool_(main.willing_qa);
  main.consent_pdpa = toBool_(main.consent_pdpa);
  main.consent_photo = toBool_(main.consent_photo);
  if (main.submitted_at instanceof Date) main.submitted_at = main.submitted_at.toISOString();
  if (main.reviewed_at instanceof Date) main.reviewed_at = main.reviewed_at.toISOString();
  if (main.updated_at instanceof Date) main.updated_at = main.updated_at.toISOString();

  const mine = function (rows) {
    return rows.filter(function (r) {
      return String(r.data.submission_id) === String(submissionId);
    }).map(function (r) { return r.data; });
  };

  const adms = mine(readSheetObjects_(CONFIG.SHEETS.ADMISSIONS, SCHEMA.ADMISSIONS));
  const itvs = mine(readSheetObjects_(CONFIG.SHEETS.INTERVIEW, SCHEMA.INTERVIEW));
  const prcs = mine(readSheetObjects_(CONFIG.SHEETS.PRACTICAL, SCHEMA.PRACTICAL));
  const files = mine(readSheetObjects_(CONFIG.SHEETS.FILES, SCHEMA.FILES));

  const admissions = adms
    .sort(function (a, b) { return Number(a.idx) - Number(b.idx); })
    .map(function (a) {
      const idx = Number(a.idx);
      const sameAdm = function (r) { return Number(r.admission_idx) === idx; };

      const myItvs = itvs.filter(sameAdm)
        .sort(function (x, y) { return Number(x.q_no) - Number(y.q_no); });

      // 面試基本資訊在每一題都重複存，取第一題的即可
      const head = myItvs[0] || {};

      const myPrcs = prcs.filter(sameAdm).map(function (p, pi) {
        const existing = files.filter(function (f) {
          return Number(f.ref_idx) === idx && Number(f.prc_idx) === pi + 1;
        }).map(function (f) {
          return { fileId: String(f.file_id), name: String(f.file_name), url: String(f.file_url) };
        });
        return {
          subject: p.subject, duration_min: p.duration_min,
          content: p.content, equipment: p.equipment, prep_advice: p.prep_advice,
          existingFiles: existing
        };
      });

      return {
        univ: a.univ, major: a.major, channel: a.channel,
        stage1_result: a.stage1_result,
        stage2_items: splitList_(a.stage2_items),
        stage2_score: a.stage2_score,
        final_result: a.final_result, result_rank: a.result_rank,
        is_enrolled: toBool_(a.is_enrolled),
        itv_format: head.format || '',
        itv_prof_count: head.prof_count || '',
        itv_duration_min: head.duration_min || '',
        itv_flow: head.flow || '',
        interviews: myItvs.map(function (q) {
          return {
            question: q.question, categories: splitList_(q.categories),
            my_answer: q.my_answer, better_answer: q.better_answer,
            difficulty: q.difficulty ? String(q.difficulty) : '', tip: q.tip
          };
        }),
        practicals: myPrcs
      };
    });

  return { main: main, admissions: admissions };
}


// ═══════════════════════════════════════════════════════════
//  畢業生：更新自己的資料
// ═══════════════════════════════════════════════════════════

function updateOwn_(req) {
  const sess = requireRole_(req.token, 'student');
  const lock = LockService.getScriptLock();

  try {
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
      return fail_('系統忙碌中，請 10 秒後再試。');
    }

    const mainRow = findMainRowById_(sess.submissionId);
    if (!mainRow) return fail_('找不到你的資料，請重新登入。');

    const status = String(mainRow.data.review_status || '').trim();
    if (CONFIG.LOCK_AFTER_APPROVED && status === '通過') {
      return fail_('這筆資料已經通過老師審核，無法再修改。如需更正請聯絡科上老師。');
    }

    const err = validate_(req);
    if (err) return fail_(err);

    const submissionId = sess.submissionId;
    const shortId = submissionId.substring(0, 6).toUpperCase();
    const now = new Date();
    const original = mainRow.data;

    // 新上傳的相片先存起來，失敗就不動舊資料
    const uploaded = uploadAllFiles_(
      req.admissions,
      { grad_year: original.grad_year, name: req.main.name || original.name },
      submissionId, shortId
    );

    // 保留使用者沒刪掉的舊相片
    const keptIds = {};
    (req.admissions || []).forEach(function (a, ai) {
      (a.practicals || []).forEach(function (p, pi) {
        (p.keptFiles || []).forEach(function (fid) {
          keptIds[String(fid)] = { admIdx: ai + 1, prcIdx: pi + 1 };
        });
      });
    });

    const oldFiles = readSheetObjects_(CONFIG.SHEETS.FILES, SCHEMA.FILES)
      .filter(function (r) { return String(r.data.submission_id) === String(submissionId); })
      .map(function (r) { return r.data; });

    const retained = oldFiles.filter(function (f) { return keptIds[String(f.file_id)]; })
      .map(function (f) {
        const pos = keptIds[String(f.file_id)];
        return {
          id: String(f.file_id), name: String(f.file_name), url: String(f.file_url),
          category: String(f.category), admIdx: pos.admIdx - 1, prcIdx: pos.prcIdx - 1
        };
      });

    const removed = oldFiles.length - retained.length;

    // 舊列全部刪掉重寫，比逐欄比對可靠
    deleteRowsOf_(CONFIG.SHEETS.MAIN, SCHEMA.MAIN, submissionId);
    deleteRowsOf_(CONFIG.SHEETS.ADMISSIONS, SCHEMA.ADMISSIONS, submissionId);
    deleteRowsOf_(CONFIG.SHEETS.INTERVIEW, SCHEMA.INTERVIEW, submissionId);
    deleteRowsOf_(CONFIG.SHEETS.PRACTICAL, SCHEMA.PRACTICAL, submissionId);
    deleteRowsOf_(CONFIG.SHEETS.FILES, SCHEMA.FILES, submissionId);

    writeRecord_(submissionId, req.main, req.admissions, retained.concat(uploaded), {
      submitted_at: original.submitted_at,     // 保留原始提交時間
      updated_at: now,
      review_status: status === '退回修改' ? '待審' : (status || '待審'),
      review_note: original.review_note,
      reviewed_at: original.reviewed_at
    });

    SpreadsheetApp.flush();
    writeLog_('INFO', submissionId, '畢業生修改資料',
      '保留相片 ' + retained.length + ' 張、新增 ' + uploaded.length +
      ' 張、移除 ' + removed + ' 張');

    return { ok: true, submissionId: shortId, message: '修改已儲存。' };

  } catch (e) {
    writeLog_('ERROR', sess.submissionId, '更新失敗：' + (e && e.message ? e.message : e),
      String(e && e.stack ? e.stack : ''));
    return fail_('儲存時發生錯誤：' + (e && e.message ? e.message : e));
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}


/**
 * 把一筆完整資料寫進五張分頁。
 * meta 可覆寫時間與審核欄位，新提交與更新共用這段邏輯。
 */
function writeRecord_(submissionId, main, admissions, files, meta) {
  meta = meta || {};
  const now = new Date();

  const mainRow = buildRow_(SCHEMA.MAIN, Object.assign({}, main, {
    submission_id: submissionId,
    submitted_at: meta.submitted_at || now,
    school: CONFIG.SCHOOL,
    dept: CONFIG.DEPT,
    review_status: meta.review_status || '待審',
    review_note: meta.review_note || '',
    reviewed_at: meta.reviewed_at || '',
    updated_at: meta.updated_at || ''
  }));

  const admRows = [], itvRows = [], prcRows = [];

  (admissions || []).forEach(function (a, ai) {
    const idx = ai + 1;
    const univ = a.univ || '', major = a.major || '';

    admRows.push(buildRow_(SCHEMA.ADMISSIONS, Object.assign({}, a, {
      submission_id: submissionId, idx: idx,
      stage2_items: joinList_(a.stage2_items),
      is_enrolled: a.is_enrolled ? 'V' : ''
    })));

    (a.interviews || []).forEach(function (q, qi) {
      if (!String(q.question || '').trim()) return;
      itvRows.push(buildRow_(SCHEMA.INTERVIEW, Object.assign({}, q, {
        submission_id: submissionId, admission_idx: idx, univ: univ, major: major,
        format: a.itv_format || '', prof_count: a.itv_prof_count || '',
        duration_min: a.itv_duration_min || '', flow: a.itv_flow || '',
        q_no: qi + 1, categories: joinList_(q.categories)
      })));
    });

    (a.practicals || []).forEach(function (p, pi) {
      if (!String(p.content || '').trim() && !String(p.subject || '').trim()) return;
      const urls = (files || [])
        .filter(function (f) { return f.admIdx === ai && f.prcIdx === pi; })
        .map(function (f) { return f.url; });
      prcRows.push(buildRow_(SCHEMA.PRACTICAL, Object.assign({}, p, {
        submission_id: submissionId, admission_idx: idx, univ: univ, major: major,
        file_urls: urls.join('\n')
      })));
    });
  });

  const fileRows = (files || []).map(function (f) {
    return buildRow_(SCHEMA.FILES, {
      submission_id: submissionId, file_id: f.id, file_name: f.name,
      file_url: f.url, category: f.category,
      ref_idx: f.admIdx + 1, prc_idx: f.prcIdx + 1,
      uploaded_at: now
    });
  });

  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  appendRows_(ss, CONFIG.SHEETS.MAIN, SCHEMA.MAIN, [mainRow]);
  appendRows_(ss, CONFIG.SHEETS.ADMISSIONS, SCHEMA.ADMISSIONS, admRows);
  appendRows_(ss, CONFIG.SHEETS.INTERVIEW, SCHEMA.INTERVIEW, itvRows);
  appendRows_(ss, CONFIG.SHEETS.PRACTICAL, SCHEMA.PRACTICAL, prcRows);
  appendRows_(ss, CONFIG.SHEETS.FILES, SCHEMA.FILES, fileRows);

  return { adm: admRows.length, itv: itvRows.length, prc: prcRows.length, file: fileRows.length };
}


// ═══════════════════════════════════════════════════════════
//  教師後台
// ═══════════════════════════════════════════════════════════

/** 審核列表：一列一筆提交，附各項數量統計 */
function adminList_(req) {
  requireRole_(req.token, 'teacher');

  const mains = readSheetObjects_(CONFIG.SHEETS.MAIN, SCHEMA.MAIN);
  const adms = readSheetObjects_(CONFIG.SHEETS.ADMISSIONS, SCHEMA.ADMISSIONS);
  const itvs = readSheetObjects_(CONFIG.SHEETS.INTERVIEW, SCHEMA.INTERVIEW);
  const prcs = readSheetObjects_(CONFIG.SHEETS.PRACTICAL, SCHEMA.PRACTICAL);
  const files = readSheetObjects_(CONFIG.SHEETS.FILES, SCHEMA.FILES);

  const countBy = function (rows) {
    const m = {};
    rows.forEach(function (r) {
      const id = String(r.data.submission_id);
      m[id] = (m[id] || 0) + 1;
    });
    return m;
  };
  const cAdm = countBy(adms), cItv = countBy(itvs), cPrc = countBy(prcs), cFile = countBy(files);

  const list = mains.map(function (r) {
    const d = r.data;
    const id = String(d.submission_id);
    return {
      submissionId: id,
      code: id.substring(0, 6).toUpperCase(),
      submittedAt: d.submitted_at instanceof Date ? d.submitted_at.toISOString() : String(d.submitted_at || ''),
      updatedAt: d.updated_at instanceof Date ? d.updated_at.toISOString() : String(d.updated_at || ''),
      gradYear: String(d.grad_year || ''),
      name: String(d.name || ''),
      className: String(d.class_name || ''),
      email: String(d.email || ''),
      currentPlace: String(d.current_place || ''),
      mainPath: String(d.main_path || ''),
      publishLevel: String(d.publish_level || ''),
      reviewStatus: String(d.review_status || '待審'),
      reviewNote: String(d.review_note || ''),
      counts: {
        adm: cAdm[id] || 0, itv: cItv[id] || 0,
        prc: cPrc[id] || 0, file: cFile[id] || 0
      }
    };
  }).sort(function (a, b) {
    return String(b.submittedAt).localeCompare(String(a.submittedAt));
  });

  const stat = { total: list.length, pending: 0, approved: 0, returned: 0 };
  list.forEach(function (x) {
    if (x.reviewStatus === '通過') stat.approved++;
    else if (x.reviewStatus === '退回修改') stat.returned++;
    else stat.pending++;
  });

  return { ok: true, list: list, stat: stat };
}


/** 教師檢視單筆完整內容 */
function adminDetail_(req) {
  requireRole_(req.token, 'teacher');
  const rec = buildFullRecord_(req.submissionId);
  if (!rec) return fail_('找不到這筆資料。');
  return { ok: true, record: rec };
}


/** 審核：通過 / 退回修改 / 待審 */
function adminReview_(req) {
  const sess = requireRole_(req.token, 'teacher');
  const status = String(req.status || '').trim();
  if (OPTIONS.REVIEW_STATUSES.indexOf(status) < 0) {
    return fail_('審核狀態不正確。');
  }

  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) return fail_('系統忙碌中，請稍後再試。');

    const row = findMainRowById_(req.submissionId);
    if (!row) return fail_('找不到這筆資料。');

    const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    const sh = ss.getSheetByName(CONFIG.SHEETS.MAIN);
    const colStatus = indexOfKey_(SCHEMA.MAIN, 'review_status') + 1;
    const colNote = indexOfKey_(SCHEMA.MAIN, 'review_note') + 1;
    const colAt = indexOfKey_(SCHEMA.MAIN, 'reviewed_at') + 1;

    sh.getRange(row.row, colStatus).setValue(status);
    sh.getRange(row.row, colNote).setValue(String(req.note || ''));
    sh.getRange(row.row, colAt).setValue(new Date());
    SpreadsheetApp.flush();

    writeLog_('INFO', req.submissionId, '審核：' + status, sess.label + ' / ' + (req.note || ''));

    // 退回修改時通知學生，讓他知道要改什麼
    if (status === '退回修改' && row.data.email) {
      try {
        MailApp.sendEmail({
          to: String(row.data.email),
          subject: '【' + CONFIG.CONTACT_NAME + '】你的畢業生資料需要修改（編號 ' +
                   String(row.data.submission_id).substring(0, 6).toUpperCase() + '）',
          htmlBody: '<div style="font-family:sans-serif;line-height:1.7">' +
            '<p>' + escapeHtml_(row.data.name) + ' 同學你好，</p>' +
            '<p>老師看過你填寫的資料後，有以下建議需要你補充或修正：</p>' +
            '<blockquote style="background:#fff8e8;padding:12px;border-left:3px solid #f0a202">' +
            escapeHtml_(req.note || '（未填寫具體意見，請聯絡老師）') + '</blockquote>' +
            '<p>請用「提交編號 + 當初填寫的 Email」登入修改。</p></div>'
        });
      } catch (mailErr) {
        writeLog_('WARN', req.submissionId, '退件通知信寄送失敗', String(mailErr));
      }
    }

    return { ok: true, message: '已標記為「' + status + '」。' };
  } catch (e) {
    writeLog_('ERROR', req.submissionId, '審核失敗', String(e && e.stack ? e.stack : e));
    return fail_('審核時發生錯誤：' + (e && e.message ? e.message : e));
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}


/**
 * 刪除整筆資料（五張分頁的列 + Drive 相片）。
 *
 * 這是不可逆操作，所以要求前端把該筆的 6 碼編號原樣送回來比對，
 * 避免誤點或前端傳錯 id 就把別人的資料刪掉。
 *
 * Drive 相片預設搬到「_已刪除」資料夾而不是丟垃圾桶，
 * 誤刪還救得回來；要徹底清除請把 CONFIG.HARD_DELETE_FILES 設成 true。
 */
function adminDelete_(req) {
  const sess = requireRole_(req.token, 'teacher');
  const lock = LockService.getScriptLock();

  try {
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) return fail_('系統忙碌中，請稍後再試。');

    const row = findMainRowById_(req.submissionId);
    if (!row) return fail_('找不到這筆資料，可能已經被刪除了。');

    const shortId = String(row.data.submission_id).substring(0, 6).toUpperCase();
    const confirmCode = String(req.confirmCode || '').trim().toUpperCase();
    if (confirmCode !== shortId) {
      return fail_('確認碼不符。請輸入這筆資料的編號 ' + shortId + ' 以確認刪除。');
    }

    const name = String(row.data.name || '');
    const gradYear = String(row.data.grad_year || '');

    // ── 先處理 Drive，失敗就整個中止，不要留下「列刪了但檔案還在」的半套狀態 ──
    const fileRows = readSheetObjects_(CONFIG.SHEETS.FILES, SCHEMA.FILES)
      .filter(function (r) { return String(r.data.submission_id) === String(req.submissionId); })
      .map(function (r) { return r.data; });

    const fileResult = disposeFiles_(fileRows, gradYear, name, shortId);

    // ── 再刪 Sheet 的列 ──
    const deleted = {
      main: deleteRowsOf_(CONFIG.SHEETS.MAIN, SCHEMA.MAIN, req.submissionId),
      adm: deleteRowsOf_(CONFIG.SHEETS.ADMISSIONS, SCHEMA.ADMISSIONS, req.submissionId),
      itv: deleteRowsOf_(CONFIG.SHEETS.INTERVIEW, SCHEMA.INTERVIEW, req.submissionId),
      prc: deleteRowsOf_(CONFIG.SHEETS.PRACTICAL, SCHEMA.PRACTICAL, req.submissionId),
      file: deleteRowsOf_(CONFIG.SHEETS.FILES, SCHEMA.FILES, req.submissionId)
    };
    SpreadsheetApp.flush();

    // 刻意只記編號與數量，不記姓名與內容 ——
    // 學生要求刪除個資時，紀錄本身不該又把個資留下來
    writeLog_('INFO', req.submissionId, '教師刪除資料：' + shortId,
      '操作者 ' + sess.label + '｜列數 主' + deleted.main + '/校系' + deleted.adm +
      '/口試' + deleted.itv + '/術科' + deleted.prc + '/檔案' + deleted.file +
      '｜相片 ' + fileResult.message);

    return {
      ok: true,
      message: '已刪除編號 ' + shortId + '（口試 ' + deleted.itv + ' 題、術科 ' +
               deleted.prc + ' 項、相片 ' + deleted.file + ' 張）。' + fileResult.message,
      deleted: deleted
    };

  } catch (e) {
    writeLog_('ERROR', req.submissionId, '刪除失敗', String(e && e.stack ? e.stack : e));
    return fail_('刪除時發生錯誤：' + (e && e.message ? e.message : e));
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}


/** 處理該筆的 Drive 相片：搬到 _已刪除 或丟垃圾桶 */
function disposeFiles_(fileRows, gradYear, name, shortId) {
  if (!fileRows.length) return { message: '此筆沒有相片。' };

  const hard = !!CONFIG.HARD_DELETE_FILES;
  let movedFolders = 0, movedFiles = 0, missing = 0;
  const doneFolders = {};

  let trashRoot = null;
  if (!hard) {
    const root = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
    trashRoot = getOrCreateFolder_(root, CONFIG.TRASH_FOLDER_NAME);
  }

  fileRows.forEach(function (f) {
    let file;
    try {
      file = DriveApp.getFileById(String(f.file_id));
    } catch (e) {
      missing++;      // 檔案已被手動刪掉，略過即可
      return;
    }

    if (hard) {
      file.setTrashed(true);
      movedFiles++;
      return;
    }

    // 整個人的資料夾一起搬，保持原本的分組
    const parents = file.getParents();
    if (parents.hasNext()) {
      const folder = parents.next();
      const fid = folder.getId();
      if (!doneFolders[fid]) {
        doneFolders[fid] = true;
        try {
          folder.moveTo(trashRoot);
          movedFolders++;
        } catch (e) {
          file.moveTo(trashRoot);   // 搬資料夾失敗就退而求其次搬檔案
          movedFiles++;
        }
      }
    } else {
      file.moveTo(trashRoot);
      movedFiles++;
    }
  });

  const parts = [];
  if (hard) {
    parts.push('相片已丟入垃圾桶（' + movedFiles + ' 張，30 天後由 Google 永久清除）');
  } else {
    if (movedFolders) parts.push('相片資料夾已搬到「' + CONFIG.TRASH_FOLDER_NAME + '」（' + movedFolders + ' 個）');
    if (movedFiles) parts.push('另有 ' + movedFiles + ' 張相片單獨搬移');
    if (!movedFolders && !movedFiles) parts.push('沒有可搬移的相片');
  }
  if (missing) parts.push('有 ' + missing + ' 張在雲端硬碟已不存在');

  return { message: parts.join('，') + '。' };
}


/** 匯出指定分頁為 CSV 字串（含 BOM，Excel 開啟中文不會亂碼） */
function adminExport_(req) {
  requireRole_(req.token, 'teacher');

  const map = {
    Main: SCHEMA.MAIN, Admissions: SCHEMA.ADMISSIONS,
    Interview: SCHEMA.INTERVIEW, Practical: SCHEMA.PRACTICAL, Files: SCHEMA.FILES
  };
  const sheetName = String(req.sheet || 'Main');
  const schema = map[sheetName];
  if (!schema) return fail_('不支援匯出這個分頁。');

  const onlyApproved = !!req.onlyApproved;
  let approvedIds = null;
  if (onlyApproved) {
    approvedIds = {};
    readSheetObjects_(CONFIG.SHEETS.MAIN, SCHEMA.MAIN).forEach(function (r) {
      if (String(r.data.review_status).trim() === '通過') {
        approvedIds[String(r.data.submission_id)] = true;
      }
    });
  }

  const rows = readSheetObjects_(sheetName, schema)
    .filter(function (r) {
      return !approvedIds || approvedIds[String(r.data.submission_id)];
    });

  const esc = function (v) {
    if (v instanceof Date) v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const lines = [schema.map(function (c) { return esc(c.label); }).join(',')];
  rows.forEach(function (r) {
    lines.push(schema.map(function (c) { return esc(r.data[c.key]); }).join(','));
  });

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
  return {
    ok: true,
    filename: sheetName + '_' + stamp + (onlyApproved ? '_已審核' : '') + '.csv',
    csv: '﻿' + lines.join('\r\n'),
    rowCount: rows.length
  };
}


// ═══════════════════════════════════════════════════════════
//  公開瀏覽（不需登入）
// ═══════════════════════════════════════════════════════════

/**
 * 學弟妹查詢用。只回傳審核通過且同意公開的資料，
 * 且一律不含 Email、手機、社群帳號與完整提交編號。
 */
function browse_(req) {
  const mains = readSheetObjects_(CONFIG.SHEETS.MAIN, SCHEMA.MAIN);
  const itvs = readSheetObjects_(CONFIG.SHEETS.INTERVIEW, SCHEMA.INTERVIEW);
  const prcs = readSheetObjects_(CONFIG.SHEETS.PRACTICAL, SCHEMA.PRACTICAL);
  const adms = readSheetObjects_(CONFIG.SHEETS.ADMISSIONS, SCHEMA.ADMISSIONS);

  const visible = {};
  const people = [];

  mains.forEach(function (r) {
    const d = r.data;
    const status = String(d.review_status || '').trim();
    const level = String(d.publish_level || '');

    if (CONFIG.BROWSE_REQUIRE_APPROVED && status !== '通過') return;

    // 「僅供校內教師參考，不公開」這個選項已從表單移除，但這段過濾必須保留：
    // 下架選項不會改變已存檔的值，拿掉這行會讓當初選過的人資料突然被公開。
    if (level.indexOf('僅供校內教師') === 0) return;

    const anonymous = level.indexOf('匿名') === 0;
    const id = String(d.submission_id);
    visible[id] = true;

    people.push({
      key: id.substring(0, 6).toUpperCase(),
      gradYear: String(d.grad_year || ''),
      // 匿名者只顯示姓氏後加「同學」，不回傳完整姓名
      displayName: anonymous
        ? (String(d.name || '某').charAt(0) + ' 同學')
        : String(d.name || ''),
      anonymous: anonymous,
      currentPlace: String(d.current_place || ''),
      mainPath: String(d.main_path || ''),
      examGroup: String(d.exam_group || ''),
      certificates: splitList_(d.certificates),
      experiences: String(d.experiences || ''),
      reflection: String(d.reflection || ''),
      advices: [d.advice_1, d.advice_2, d.advice_3]
        .map(function (x) { return String(x || '').trim(); }).filter(Boolean),
      doEarlier: String(d.do_earlier || ''),
      regret: String(d.regret || ''),
      willingQa: toBool_(d.willing_qa)
      // 刻意不含：email / phone / social_id / 完整 submission_id
    });
  });

  const pick = function (rows) {
    return rows.filter(function (r) { return visible[String(r.data.submission_id)]; })
               .map(function (r) { return r.data; });
  };

  const questions = pick(itvs).map(function (q) {
    return {
      key: String(q.submission_id).substring(0, 6).toUpperCase(),
      univ: String(q.univ || ''), major: String(q.major || ''),
      format: String(q.format || ''),
      question: String(q.question || ''),
      categories: splitList_(q.categories),
      betterAnswer: String(q.better_answer || ''),
      difficulty: q.difficulty === '' || q.difficulty == null ? '' : String(q.difficulty),
      tip: String(q.tip || '')
      // 刻意不含 my_answer：那是個人化的回答內容，公開意義不大
    };
  });

  const practicals = pick(prcs).map(function (p) {
    return {
      key: String(p.submission_id).substring(0, 6).toUpperCase(),
      univ: String(p.univ || ''), major: String(p.major || ''),
      subject: String(p.subject || ''), durationMin: String(p.duration_min || ''),
      content: String(p.content || ''), equipment: String(p.equipment || ''),
      prepAdvice: String(p.prep_advice || '')
      // 刻意不含相片連結：Drive 檔案未對外開放，給了也打不開
    };
  });

  const admissions = pick(adms).map(function (a) {
    return {
      key: String(a.submission_id).substring(0, 6).toUpperCase(),
      univ: String(a.univ || ''), major: String(a.major || ''),
      channel: String(a.channel || ''),
      stage1: String(a.stage1_result || ''),
      stage2Items: splitList_(a.stage2_items),
      finalResult: String(a.final_result || ''),
      resultRank: String(a.result_rank || ''),
      isEnrolled: toBool_(a.is_enrolled)
    };
  });

  return {
    ok: true,
    people: people,
    admissions: admissions,
    questions: questions,
    practicals: practicals,
    stat: {
      people: people.length, admissions: admissions.length,
      questions: questions.length, practicals: practicals.length
    }
  };
}
