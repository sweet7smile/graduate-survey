/**
 * Auth.gs — 登入、session、權限
 *
 * ⚠️ 教師帳密絕對不寫在程式碼裡。
 *    本專案是公開 GitHub repo，且 build_pages.py 會把 config.gs 內嵌進
 *    公開網頁；任何寫在檔案裡的密碼等同直接公布。
 *    帳密以「隨機鹽值 + SHA-256」存進 Script Properties（伺服器端、不進版控）。
 *
 * 首次設定：把下面 setupTeacherAccount() 裡的兩個常數填好 → 執行一次 →
 *          立刻把明文清掉並存檔。
 */

const PROP_KEYS = {
  ACCOUNT: 'TEACHER_ACCOUNT',
  SALT: 'TEACHER_SALT',
  HASH: 'TEACHER_HASH',
  SET_AT: 'TEACHER_SET_AT'
};


// ═══════════════════════════════════════════════════════════
//  首次設定（手動執行一次）
// ═══════════════════════════════════════════════════════════

/**
 * 設定教師帳號密碼。執行完請務必把明文清空再存檔。
 * 想改密碼時重跑一次即可，舊的會被覆蓋。
 */
function setupTeacherAccount() {
  const ACCOUNT  = '在這裡填教師帳號';
  const PASSWORD = '在這裡填教師密碼';

  if (ACCOUNT.indexOf('在這裡填') === 0 || PASSWORD.indexOf('在這裡填') === 0) {
    throw new Error('請先把 setupTeacherAccount() 裡的 ACCOUNT 與 PASSWORD 換成實際值再執行。');
  }
  if (String(PASSWORD).length < 8) {
    throw new Error('密碼請至少 8 碼。');
  }

  const salt = Utilities.getUuid();
  const props = PropertiesService.getScriptProperties();
  props.setProperties({
    TEACHER_ACCOUNT: String(ACCOUNT).trim(),
    TEACHER_SALT: salt,
    TEACHER_HASH: hashPassword_(String(PASSWORD), salt),
    TEACHER_SET_AT: new Date().toISOString()
  });

  const msg = '教師帳號已設定完成（帳號：' + ACCOUNT + '）。\n' +
              '密碼以鹽值 + SHA-256 儲存，Script Properties 內沒有明文。\n' +
              '⚠️ 請立刻把這支函式裡的 ACCOUNT 與 PASSWORD 改回預設文字並存檔。';
  Logger.log(msg);
  return msg;
}

/** 檢查目前狀態，不會顯示密碼 */
function checkTeacherAccount() {
  const props = PropertiesService.getScriptProperties();
  const acc = props.getProperty(PROP_KEYS.ACCOUNT);
  if (!acc) return '尚未設定教師帳號，請先執行 setupTeacherAccount()。';
  return '已設定教師帳號：' + acc +
         '\n設定時間：' + (props.getProperty(PROP_KEYS.SET_AT) || '未知') +
         '\n（密碼僅存雜湊值，無法回讀）';
}


// ═══════════════════════════════════════════════════════════
//  密碼雜湊
// ═══════════════════════════════════════════════════════════

function hashPassword_(password, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + '::' + password,
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

/** 定時比較，避免以回應時間推測密碼 */
function safeEquals_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}


// ═══════════════════════════════════════════════════════════
//  Session
// ═══════════════════════════════════════════════════════════

/** 建立 session，回傳 token */
function createSession_(role, submissionId, label) {
  const token = Utilities.getUuid().replace(/-/g, '');
  const data = {
    role: role,                     // 'teacher' | 'student'
    submissionId: submissionId || '',
    label: label || '',
    at: Date.now()
  };
  CacheService.getScriptCache().put(
    'sess_' + token,
    JSON.stringify(data),
    CONFIG.SESSION_HOURS * 3600
  );
  return token;
}

/** 取回 session，無效回 null */
function getSession_(token) {
  if (!token) return null;
  const raw = CacheService.getScriptCache().get('sess_' + String(token));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function destroySession_(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + String(token));
}

/** 取得 session 並檢查角色，不符就丟出錯誤（由 doPost 統一轉成友善訊息） */
function requireRole_(token, role) {
  const s = getSession_(token);
  if (!s) throw new Error('登入已逾時或無效，請重新登入。');
  if (role && s.role !== role) throw new Error('權限不足。');
  return s;
}


// ═══════════════════════════════════════════════════════════
//  登入
// ═══════════════════════════════════════════════════════════

const TEACHER_LOCK_KEY = 'teacher_login_lockout';
const TEACHER_FAIL_KEY = 'teacher_login_fails';

/**
 * 教師登入：帳號 + 密碼。
 *
 * 連續失敗會觸發暫時鎖定 —— /exec 網址寫在公開的 config.js 裡，
 * 任何人都找得到這個登入端點，光靠 0.6 秒延遲不足以擋住腳本化的
 * 暴力嘗試。鎖定用全站共用的 CacheService 計數器，不分帳號來源，
 * 因為本系統就只有一個教師帳號，也拿不到可靠的來源 IP 可供區分。
 */
function loginTeacher_(req) {
  const cache = CacheService.getScriptCache();

  const lockedUntil = cache.get(TEACHER_LOCK_KEY);
  if (lockedUntil) {
    const remainMin = Math.max(1, Math.ceil((Number(lockedUntil) - Date.now()) / 60000));
    writeLog_('WARN', '', '教師登入：鎖定期間仍有嘗試', '帳號：' + String(req.account || ''));
    return fail_('登入嘗試次數過多，已暫時鎖定，請約 ' + remainMin + ' 分鐘後再試。');
  }

  const props = PropertiesService.getScriptProperties();
  const account = props.getProperty(PROP_KEYS.ACCOUNT);
  const salt = props.getProperty(PROP_KEYS.SALT);
  const hash = props.getProperty(PROP_KEYS.HASH);

  if (!account || !salt || !hash) {
    return fail_('系統尚未設定教師帳號。請在 Apps Script 執行一次 setupTeacherAccount()。');
  }

  const inAcc = String(req.account || '').trim();
  const inPw = String(req.password || '');

  // 帳號或密碼錯都回同一句，不透露是哪個錯
  const okAcc = safeEquals_(inAcc, account);
  const okPw = safeEquals_(hashPassword_(inPw, salt), hash);
  if (!okAcc || !okPw) {
    Utilities.sleep(600);   // 稍微拖慢，降低暴力嘗試效率

    const fails = Number(cache.get(TEACHER_FAIL_KEY) || 0) + 1;
    cache.put(TEACHER_FAIL_KEY, String(fails), CONFIG.TEACHER_LOGIN_WINDOW_MIN * 60);

    if (fails >= CONFIG.TEACHER_LOGIN_MAX_FAILS) {
      cache.put(TEACHER_LOCK_KEY, String(Date.now() + CONFIG.TEACHER_LOGIN_LOCKOUT_MIN * 60000),
                CONFIG.TEACHER_LOGIN_LOCKOUT_MIN * 60);
      cache.remove(TEACHER_FAIL_KEY);
      writeLog_('WARN', '', '教師登入：觸發鎖定', '連續失敗 ' + fails + ' 次，鎖定 ' +
                CONFIG.TEACHER_LOGIN_LOCKOUT_MIN + ' 分鐘');
      return fail_('登入嘗試次數過多，已暫時鎖定 ' + CONFIG.TEACHER_LOGIN_LOCKOUT_MIN + ' 分鐘。');
    }

    writeLog_('WARN', '', '教師登入失敗', '嘗試帳號：' + inAcc + '（第 ' + fails + ' 次）');
    return fail_('帳號或密碼不正確。');
  }

  cache.remove(TEACHER_FAIL_KEY);   // 登入成功，失敗計數歸零
  const token = createSession_('teacher', '', account);
  writeLog_('INFO', '', '教師登入成功', account);
  return { ok: true, token: token, role: 'teacher', label: account };
}


/**
 * 畢業生登入：提交編號 + Email。
 *
 * 只用編號的話，6 碼太短而且會出現在確認信裡，被轉寄就等於被冒用；
 * 加上 Email 比對相當於雙因素，成本很低但安全性差很多。
 */
function loginStudent_(req) {
  const code = String(req.code || '').trim().toUpperCase();
  const email = String(req.email || '').trim().toLowerCase();

  if (!code || !email) return fail_('請輸入提交編號與當初填寫的 Email。');

  const row = findMainRowByCode_(code);
  if (!row) {
    Utilities.sleep(400);
    return fail_('查無此提交編號，請確認確認信上的編號。');
  }
  const rowEmail = String(row.data.email || '').trim().toLowerCase();
  if (!safeEquals_(rowEmail, email)) {
    Utilities.sleep(400);
    writeLog_('WARN', row.data.submission_id, '畢業生登入 Email 不符', '輸入：' + email);
    return fail_('提交編號與 Email 不符。');
  }

  const status = String(row.data.review_status || '').trim();
  const locked = CONFIG.LOCK_AFTER_APPROVED && status === '通過';

  const token = createSession_('student', row.data.submission_id, row.data.name);
  writeLog_('INFO', row.data.submission_id, '畢業生登入成功', row.data.name);
  return {
    ok: true,
    token: token,
    role: 'student',
    label: row.data.name,
    reviewStatus: status,
    reviewNote: String(row.data.review_note || ''),
    locked: locked
  };
}


function logout_(req) {
  destroySession_(req.token);
  return { ok: true };
}
