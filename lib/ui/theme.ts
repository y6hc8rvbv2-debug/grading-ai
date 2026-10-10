// デザイントークン（朱筆＝赤ペン / 和紙 / 藍 をモチーフ）。docs/prototype-v3.jsx から移植。
export const THEME = {
  light: {
    name: "light",
    bg: "#F3F0E9",
    bgAlt: "#EAE5DA",
    panel: "#FBF9F4",
    panelAlt: "#F5F1E8",
    line: "#DCD5C6",
    lineStrong: "#C3B9A3",
    text: "#1D2733",
    textSub: "#5C6675",
    textFaint: "#8A93A0",
    accent: "#1E3A5F",      // 藍
    accentSoft: "#DCE5F0",
    shu: "#C8342B",         // 朱（赤ペン）
    shuSoft: "#F7DEDB",
    ok: "#1F7A54",
    okSoft: "#D9EFE4",
    warn: "#B4761A",
    warnSoft: "#F8EBD3",
    ng: "#B02A22",
    ngSoft: "#F8DEDB",
    info: "#2A6C8F",
    infoSoft: "#DBEDF5",
    shadow: "0 1px 2px rgba(29,39,51,.06), 0 8px 24px rgba(29,39,51,.06)",
    sheet: "#FFFDF7",
    sheetLine: "#D9D2C2",
  },
  dark: {
    name: "dark",
    bg: "#12161C",
    bgAlt: "#0D1116",
    panel: "#191F27",
    panelAlt: "#1F2731",
    line: "#2C3540",
    lineStrong: "#3E4A58",
    text: "#E9EDF2",
    textSub: "#A2AEBC",
    textFaint: "#727E8C",
    accent: "#7FB0E0",
    accentSoft: "#1B2A3A",
    shu: "#F26D62",
    shuSoft: "#3A1E1C",
    ok: "#59C795",
    okSoft: "#16302A",
    warn: "#E0A94A",
    warnSoft: "#31281A",
    ng: "#F0736A",
    ngSoft: "#331B1A",
    info: "#6FB6D8",
    infoSoft: "#152833",
    shadow: "0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35)",
    sheet: "#F7F4EC",
    sheetLine: "#D0C8B6",
  },
};

export const FONT_UI =
  '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic UI",system-ui,-apple-system,"Segoe UI",sans-serif';
export const FONT_MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Noto Sans Mono",monospace';
export const FONT_HAND =
  '"Yu Mincho","Hiragino Mincho ProN","Noto Serif JP",Georgia,serif';

export type Theme = (typeof THEME)["light"];
