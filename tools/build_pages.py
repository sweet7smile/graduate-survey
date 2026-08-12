# -*- coding: utf-8 -*-
"""
build_pages.py — 由 GAS 原始碼產生 GitHub Pages 靜態版

執行：  python tools/build_pages.py

產物（全部放在 repo 根目錄，對應 GitHub Pages 的預設設定 /(root)，
不必去 Settings 改資料夾，避免選錯造成直接送出 GAS 樣板原始碼）：
  index.html             封面頁（先選填表單／查詢／後台，再進對應頁面）
  form.html              填寫表單（原本的 index.html，網址固定改用這個）
  browse.html / login.html / admin.html
  config.js              API 網址設定檔（已存在則不覆蓋，保留你填的網址）
  .nojekyll              關掉 Jekyll，避免 GitHub 亂處理檔案
  gas/config.example.gs  ID 與 Email 已抹除的設定檔範本，供公開 repo 使用

設計重點：選項清單只有 config.gs 一份來源。這支腳本直接把 config.gs
的原始碼（抹掉機密後）內嵌進靜態頁再呼叫 getClientConfig()，
所以新增證照或題目分類時只要改 config.gs，重跑一次就同步。
"""

import re
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
GAS = ROOT / "gas"      # GAS 原始碼
SITE = ROOT             # GitHub Pages 服務的目錄（根目錄＝預設設定）

# ── 需要從公開版本抹掉的機密設定 ──────────────────────────
SECRETS = [
    (r"(SHEET_ID:\s*)'[^']*'",        r"\1'YOUR_SHEET_ID'"),
    (r"(DRIVE_FOLDER_ID:\s*)'[^']*'", r"\1'YOUR_DRIVE_FOLDER_ID'"),
    (r"(NOTIFY_EMAIL:\s*)'[^']*'",    r"\1'your-address@example.com'"),
]


def check_commas(config_src: str) -> None:
    """
    抓「物件屬性少了結尾逗號」這種錯。

    config.gs 會被內嵌進四個靜態頁，一個少掉的逗號會讓整包 script 解析失敗，
    四頁一起壞掉。括號配對檢查抓不到這種錯，所以在這裡另外擋。

    規則：在物件內（大括號深度 >= 1）的一行，如果結尾不是逗號也不是開括號，
    而下一個有效行又不是收尾括號，那就是漏了逗號。
    """
    lines = []
    for i, raw in enumerate(config_src.split("\n"), 1):
        code = re.sub(r"//.*$", "", raw).rstrip()
        if code.strip():
            lines.append((i, code))

    depth = 0
    for idx, (lineno, code) in enumerate(lines):
        stripped = code.strip()
        opens = code.count("{") + code.count("[")
        closes = code.count("}") + code.count("]")

        if depth >= 1 and idx + 1 < len(lines):
            nxt = lines[idx + 1][1].strip()
            ends_ok = stripped.endswith((",", "{", "[", "(", ";"))
            next_is_close = nxt.startswith(("}", "]", ")"))
            if not ends_ok and not next_is_close and opens == closes:
                raise SystemExit(
                    f"config.gs 第 {lineno} 行結尾少了逗號：\n"
                    f"    {stripped}\n"
                    f"  下一行：{nxt}\n"
                    f"  （少一個逗號會讓內嵌進網頁的整段 script 解析失敗，四頁一起壞掉）"
                )
        depth += opens - closes


def scrub(config_src: str) -> str:
    """把真實 ID 與 Email 換成佔位字串"""
    out = config_src
    for pattern, repl in SECRETS:
        out, n = re.subn(pattern, repl, out)
        if n == 0:
            raise SystemExit(f"抹除失敗：config.gs 找不到符合 {pattern} 的設定，"
                             f"請確認格式沒被改動（必須是單引號）。")
    return out


PAGES = ["index", "form", "browse", "login", "admin"]


def build_page(name: str, styles: str, script: str, common: str, clean_config: str) -> str:
    """把一個 GAS 樣板展開成自包含的靜態頁"""
    page = (GAS / f"{name}.html").read_text(encoding="utf-8")

    page = page.replace("<?!= include('styles'); ?>", styles)
    page = page.replace("<?!= include('common'); ?>", common)
    page = page.replace("<?!= include('script'); ?>", script)

    # CFG 改成在瀏覽器端呼叫，資料來源就是內嵌的 config.gs
    inline_cfg = (
        '<script src="config.js"></script>\n'
        "<script>\n"
        "/* ── 以下由 config.gs 自動內嵌（ID 與 Email 已移除）"
        "，請勿手動修改，改 config.gs 後重跑 tools/build_pages.py ── */\n"
        + clean_config
        + "\n</script>\n"
    )
    page = page.replace("<script>\n  const CFG =", inline_cfg + "<script>\n  const CFG =")
    page = page.replace("<?!= JSON.stringify(getClientConfig()) ?>", "getClientConfig()")

    # 靜態版沒有 Apps Script 服務網址，頁面連結改用相對路徑
    page = page.replace("'<?!= getWebAppUrl() ?>'", "''")

    if "<?!=" in page or "<?=" in page:
        raise SystemExit(f"{name}.html 還有沒展開的 GAS 樣板語法。")
    return page


def main() -> None:
    styles_src = (GAS / "styles.html").read_text(encoding="utf-8")
    script_src = (GAS / "script.html").read_text(encoding="utf-8")
    common_src = (GAS / "common.html").read_text(encoding="utf-8")
    config_src = (GAS / "config.gs").read_text(encoding="utf-8")

    check_commas(config_src)
    clean_config = scrub(config_src)

    # 1) 產生公開用的設定檔範本
    (GAS / "config.example.gs").write_text(
        "/* 這是公開範本：複製成 config.gs 後填入自己的 ID 與 Email。\n"
        "   config.gs 已列入 .gitignore，不會被推上 GitHub。            */\n\n"
        + clean_config,
        encoding="utf-8",
    )

    # 2) 逐頁展開並寫出
    sizes = {}
    for name in PAGES:
        page = build_page(name, styles_src, script_src, common_src, clean_config)
        (SITE / f"{name}.html").write_text(page, encoding="utf-8")
        sizes[name] = len(page)

    (SITE / ".nojekyll").write_text("", encoding="utf-8")

    cfg_js = SITE / "config.js"
    if not cfg_js.exists():
        cfg_js.write_text(
            "/* ═══════════════════════════════════════════════════════\n"
            "   GitHub Pages 執行模式設定\n"
            "\n"
            "   留空字串     → 示範模式，可完整操作但不會寫入任何資料\n"
            "   填 /exec 網址 → 正式模式，資料會送進你的 Google Sheet\n"
            "\n"
            "   網址取得方式：Apps Script →「部署」→「管理部署作業」\n"
            "   →複製「網頁應用程式」網址（結尾是 /exec，不是 /dev）\n"
            "   ═══════════════════════════════════════════════════════ */\n"
            "window.GRAD_API_URL = '';\n",
            encoding="utf-8",
        )

    for name in PAGES:
        print(f"{name + '.html':<22}{sizes[name]:,} chars")
    print(f"{'gas/config.example.gs':<22}ID 與 Email 已抹除")
    print(f"{'config.js':<22}{'保留原有設定' if cfg_js.exists() else '新建'}")


if __name__ == "__main__":
    main()
