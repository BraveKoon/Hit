"""SUIT 가변 글꼴에서 소개 페이지에 쓰인 글자만 남겨 public/fonts/suit/ 에 woff2 로 저장한다.

SUIT 는 제목·숫자·라벨에만 쓰므로 페이지(index.html, 스크립트 속 문구 포함)에 실제로 나오는
글자와 ASCII 만 있으면 된다. 문구를 고친 뒤에는 다시 돌려야 새 글자가 SUIT 로 나온다
(빠진 글자는 Pretendard 로 대신 보인다).

    pip install fonttools brotli
    npm pack @sun-typeface/suit && tar -xzf sun-typeface-suit-*.tgz
    python3 scripts/subset_suit.py package/fonts/variable/ttf/SUIT-Variable.ttf
"""
import pathlib
import sys

from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "public" / "index.html"
OUT = ROOT / "public" / "fonts" / "suit" / "SUIT-Variable.subset.woff2"


def main(src: str) -> None:
    text = set(PAGE.read_text(encoding="utf-8"))
    text |= {chr(c) for c in range(0x20, 0x7F)}
    text |= set("·—→…%★‘’“”")
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    font = subset.load_font(src, opts)
    sub = subset.Subsetter(opts)
    sub.populate(text="".join(c for c in text if c.isprintable()))
    sub.subset(font)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(OUT), opts)
    print(f"{OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main(sys.argv[1])
