# -*- coding: utf-8 -*-
"""
build_pages.py — 由 GAS 原始碼產生 GitHub Pages 靜態版

執行：  python tools/build_pages.py

產物：
  docs/index.html      單一自包含頁面（styles / script / config 全部內嵌）
  docs/config.js       API 網址設定檔（已存在則不覆蓋，保留你填的網址）
  docs/.nojekyll       關掉 Jekyll，避免 GitHub 亂處理檔案
  config.example.gs    ID 與 Email 已抹除的設定檔範本，供公開 repo 使用

設計重點：選項清單只有 config.gs 一份來源。這支腳本直接把 config.gs
的原始碼（抹掉機密後）內嵌進靜態頁再呼叫 getClientConfig()，
所以新增證照或題目分類時只要改 config.gs，重跑一次就同步。
"""

import re
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

# ── 需要從公開版本抹掉的機密設定 ──────────────────────────
SECRETS = [
    (r"(SHEET_ID:\s*)'[^']*'",        r"\1'YOUR_SHEET_ID'"),
    (r"(DRIVE_FOLDER_ID:\s*)'[^']*'", r"\1'YOUR_DRIVE_FOLDER_ID'"),
    (r"(NOTIFY_EMAIL:\s*)'[^']*'",    r"\1'your-address@example.com'"),
]


def scrub(config_src: str) -> str:
    """把真實 ID 與 Email 換成佔位字串"""
    out = config_src
    for pattern, repl in SECRETS:
        out, n = re.subn(pattern, repl, out)
        if n == 0:
            raise SystemExit(f"抹除失敗：config.gs 找不到符合 {pattern} 的設定，"
                             f"請確認格式沒被改動（必須是單引號）。")
    return out


def main() -> None:
    index_src = (ROOT / "index.html").read_text(encoding="utf-8")
    styles_src = (ROOT / "styles.html").read_text(encoding="utf-8")
    script_src = (ROOT / "script.html").read_text(encoding="utf-8")
    config_src = (ROOT / "config.gs").read_text(encoding="utf-8")

    clean_config = scrub(config_src)

    # 1) 產生公開用的設定檔範本
    (ROOT / "config.example.gs").write_text(
        "/* 這是公開範本：複製成 config.gs 後填入自己的 ID 與 Email。\n"
        "   config.gs 已列入 .gitignore，不會被推上 GitHub。            */\n\n"
        + clean_config,
        encoding="utf-8",
    )

    # 2) 展開 GAS 樣板語法
    page = index_src.replace("<?!= include('styles'); ?>", styles_src)
    page = page.replace("<?!= include('script'); ?>", script_src)

    # CFG 改成在瀏覽器端呼叫，資料來源就是內嵌的 config.gs
    inline_cfg = (
        '<script src="config.js"></script>\n'
        "<script>\n"
        "/* ── 以下由 config.gs 自動內嵌（ID 與 Email 已移除）"
        "，請勿手動修改，改 config.gs 後重跑 tools/build_pages.py ── */\n"
        + clean_config
        + "\n</script>\n"
    )
    page = page.replace(
        "<script>\n  const CFG =",
        inline_cfg + "<script>\n  const CFG =",
    )
    page = page.replace("<?!= JSON.stringify(getClientConfig()) ?>", "getClientConfig()")

    if "<?!=" in page:
        raise SystemExit("還有沒展開的 GAS 樣板語法，請檢查 index.html。")

    # 3) 寫出
    DOCS.mkdir(exist_ok=True)
    (DOCS / "index.html").write_text(page, encoding="utf-8")
    (DOCS / ".nojekyll").write_text("", encoding="utf-8")

    cfg_js = DOCS / "config.js"
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

    print(f"docs/index.html  {len(page):,} chars")
    print(f"config.example.gs 已更新（ID 與 Email 已抹除）")
    print(f"docs/config.js   {'保留原有設定' if cfg_js.exists() else '新建'}")


if __name__ == "__main__":
    main()
