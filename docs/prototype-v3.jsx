import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";

/* ============================================================================
 * テスト採点ver.3 — AI答案採点エージェント
 * 単一ファイル React アプリ / デモデータ完備
 * 本番接続ポイントは "// PROD-API:" コメントで明示
 * ==========================================================================*/

/* ---------------------------------------------------------------------------
 * 1. デザイントークン（朱筆＝赤ペン / 和紙 / 藍 をモチーフ）
 * -------------------------------------------------------------------------*/
const THEME = {
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

const FONT_UI =
  '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic UI",system-ui,-apple-system,"Segoe UI",sans-serif';
const FONT_MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Noto Sans Mono",monospace';
const FONT_HAND =
  '"Yu Mincho","Hiragino Mincho ProN","Noto Serif JP",Georgia,serif';

/* ---------------------------------------------------------------------------
 * 2. 多言語対応（112言語 / RTL対応）
 * -------------------------------------------------------------------------*/
const LANGS = [
  { c: "ja", n: "日本語", e: "Japanese", f: "🇯🇵" },
  { c: "en", n: "English", e: "English", f: "🇺🇸" },
  { c: "zh", n: "简体中文", e: "Chinese (Simplified)", f: "🇨🇳" },
  { c: "zh-TW", n: "繁體中文", e: "Chinese (Traditional)", f: "🇹🇼" },
  { c: "ko", n: "한국어", e: "Korean", f: "🇰🇷" },
  { c: "es", n: "Español", e: "Spanish", f: "🇪🇸" },
  { c: "fr", n: "Français", e: "French", f: "🇫🇷" },
  { c: "de", n: "Deutsch", e: "German", f: "🇩🇪" },
  { c: "pt", n: "Português", e: "Portuguese", f: "🇵🇹" },
  { c: "pt-BR", n: "Português (BR)", e: "Portuguese (Brazil)", f: "🇧🇷" },
  { c: "vi", n: "Tiếng Việt", e: "Vietnamese", f: "🇻🇳" },
  { c: "th", n: "ไทย", e: "Thai", f: "🇹🇭" },
  { c: "id", n: "Bahasa Indonesia", e: "Indonesian", f: "🇮🇩" },
  { c: "ar", n: "العربية", e: "Arabic", f: "🇸🇦", rtl: true },
  { c: "he", n: "עברית", e: "Hebrew", f: "🇮🇱", rtl: true },
  { c: "fa", n: "فارسی", e: "Persian", f: "🇮🇷", rtl: true },
  { c: "ur", n: "اردو", e: "Urdu", f: "🇵🇰", rtl: true },
  { c: "hi", n: "हिन्दी", e: "Hindi", f: "🇮🇳" },
  { c: "bn", n: "বাংলা", e: "Bengali", f: "🇧🇩" },
  { c: "ta", n: "தமிழ்", e: "Tamil", f: "🇮🇳" },
  { c: "te", n: "తెలుగు", e: "Telugu", f: "🇮🇳" },
  { c: "mr", n: "मराठी", e: "Marathi", f: "🇮🇳" },
  { c: "gu", n: "ગુજરાતી", e: "Gujarati", f: "🇮🇳" },
  { c: "kn", n: "ಕನ್ನಡ", e: "Kannada", f: "🇮🇳" },
  { c: "ml", n: "മലയാളം", e: "Malayalam", f: "🇮🇳" },
  { c: "pa", n: "ਪੰਜਾਬੀ", e: "Punjabi", f: "🇮🇳" },
  { c: "ne", n: "नेपाली", e: "Nepali", f: "🇳🇵" },
  { c: "si", n: "සිංහල", e: "Sinhala", f: "🇱🇰" },
  { c: "my", n: "မြန်မာ", e: "Burmese", f: "🇲🇲" },
  { c: "km", n: "ខ្មែរ", e: "Khmer", f: "🇰🇭" },
  { c: "lo", n: "ລາວ", e: "Lao", f: "🇱🇦" },
  { c: "ms", n: "Bahasa Melayu", e: "Malay", f: "🇲🇾" },
  { c: "tl", n: "Filipino", e: "Filipino", f: "🇵🇭" },
  { c: "ceb", n: "Cebuano", e: "Cebuano", f: "🇵🇭" },
  { c: "jv", n: "Basa Jawa", e: "Javanese", f: "🇮🇩" },
  { c: "su", n: "Basa Sunda", e: "Sundanese", f: "🇮🇩" },
  { c: "it", n: "Italiano", e: "Italian", f: "🇮🇹" },
  { c: "nl", n: "Nederlands", e: "Dutch", f: "🇳🇱" },
  { c: "sv", n: "Svenska", e: "Swedish", f: "🇸🇪" },
  { c: "no", n: "Norsk", e: "Norwegian", f: "🇳🇴" },
  { c: "da", n: "Dansk", e: "Danish", f: "🇩🇰" },
  { c: "fi", n: "Suomi", e: "Finnish", f: "🇫🇮" },
  { c: "is", n: "Íslenska", e: "Icelandic", f: "🇮🇸" },
  { c: "pl", n: "Polski", e: "Polish", f: "🇵🇱" },
  { c: "cs", n: "Čeština", e: "Czech", f: "🇨🇿" },
  { c: "sk", n: "Slovenčina", e: "Slovak", f: "🇸🇰" },
  { c: "hu", n: "Magyar", e: "Hungarian", f: "🇭🇺" },
  { c: "ro", n: "Română", e: "Romanian", f: "🇷🇴" },
  { c: "bg", n: "Български", e: "Bulgarian", f: "🇧🇬" },
  { c: "el", n: "Ελληνικά", e: "Greek", f: "🇬🇷" },
  { c: "tr", n: "Türkçe", e: "Turkish", f: "🇹🇷" },
  { c: "uk", n: "Українська", e: "Ukrainian", f: "🇺🇦" },
  { c: "ru", n: "Русский", e: "Russian", f: "🇷🇺" },
  { c: "sr", n: "Српски", e: "Serbian", f: "🇷🇸" },
  { c: "hr", n: "Hrvatski", e: "Croatian", f: "🇭🇷" },
  { c: "bs", n: "Bosanski", e: "Bosnian", f: "🇧🇦" },
  { c: "sl", n: "Slovenščina", e: "Slovenian", f: "🇸🇮" },
  { c: "mk", n: "Македонски", e: "Macedonian", f: "🇲🇰" },
  { c: "sq", n: "Shqip", e: "Albanian", f: "🇦🇱" },
  { c: "lt", n: "Lietuvių", e: "Lithuanian", f: "🇱🇹" },
  { c: "lv", n: "Latviešu", e: "Latvian", f: "🇱🇻" },
  { c: "et", n: "Eesti", e: "Estonian", f: "🇪🇪" },
  { c: "ka", n: "ქართული", e: "Georgian", f: "🇬🇪" },
  { c: "hy", n: "Հայերեն", e: "Armenian", f: "🇦🇲" },
  { c: "az", n: "Azərbaycan", e: "Azerbaijani", f: "🇦🇿" },
  { c: "kk", n: "Қазақша", e: "Kazakh", f: "🇰🇿" },
  { c: "ky", n: "Кыргызча", e: "Kyrgyz", f: "🇰🇬" },
  { c: "uz", n: "Oʻzbekcha", e: "Uzbek", f: "🇺🇿" },
  { c: "tg", n: "Тоҷикӣ", e: "Tajik", f: "🇹🇯" },
  { c: "tk", n: "Türkmençe", e: "Turkmen", f: "🇹🇲" },
  { c: "mn", n: "Монгол", e: "Mongolian", f: "🇲🇳" },
  { c: "bo", n: "བོད་སྐད་", e: "Tibetan", f: "🏔️" },
  { c: "sw", n: "Kiswahili", e: "Swahili", f: "🇰🇪" },
  { c: "am", n: "አማርኛ", e: "Amharic", f: "🇪🇹" },
  { c: "ti", n: "ትግርኛ", e: "Tigrinya", f: "🇪🇷" },
  { c: "so", n: "Soomaali", e: "Somali", f: "🇸🇴" },
  { c: "ha", n: "Hausa", e: "Hausa", f: "🇳🇬" },
  { c: "yo", n: "Yorùbá", e: "Yoruba", f: "🇳🇬" },
  { c: "ig", n: "Igbo", e: "Igbo", f: "🇳🇬" },
  { c: "zu", n: "isiZulu", e: "Zulu", f: "🇿🇦" },
  { c: "xh", n: "isiXhosa", e: "Xhosa", f: "🇿🇦" },
  { c: "af", n: "Afrikaans", e: "Afrikaans", f: "🇿🇦" },
  { c: "st", n: "Sesotho", e: "Sesotho", f: "🇱🇸" },
  { c: "sn", n: "chiShona", e: "Shona", f: "🇿🇼" },
  { c: "ny", n: "Chichewa", e: "Chichewa", f: "🇲🇼" },
  { c: "rw", n: "Kinyarwanda", e: "Kinyarwanda", f: "🇷🇼" },
  { c: "mg", n: "Malagasy", e: "Malagasy", f: "🇲🇬" },
  { c: "wo", n: "Wolof", e: "Wolof", f: "🇸🇳" },
  { c: "ff", n: "Fulfulde", e: "Fula", f: "🌍" },
  { c: "ca", n: "Català", e: "Catalan", f: "🏴" },
  { c: "eu", n: "Euskara", e: "Basque", f: "🏴" },
  { c: "gl", n: "Galego", e: "Galician", f: "🏴" },
  { c: "cy", n: "Cymraeg", e: "Welsh", f: "🏴󠁧󠁢󠁷󠁬󠁳󠁿" },
  { c: "ga", n: "Gaeilge", e: "Irish", f: "🇮🇪" },
  { c: "gd", n: "Gàidhlig", e: "Scottish Gaelic", f: "🏴󠁧󠁢󠁳󠁣󠁴󠁿" },
  { c: "mt", n: "Malti", e: "Maltese", f: "🇲🇹" },
  { c: "lb", n: "Lëtzebuergesch", e: "Luxembourgish", f: "🇱🇺" },
  { c: "fo", n: "Føroyskt", e: "Faroese", f: "🇫🇴" },
  { c: "be", n: "Беларуская", e: "Belarusian", f: "🇧🇾" },
  { c: "mo", n: "Moldovenească", e: "Moldovan", f: "🇲🇩" },
  { c: "ps", n: "پښتو", e: "Pashto", f: "🇦🇫", rtl: true },
  { c: "ku", n: "Kurdî", e: "Kurdish", f: "🏴" },
  { c: "sd", n: "سنڌي", e: "Sindhi", f: "🇵🇰", rtl: true },
  { c: "as", n: "অসমীয়া", e: "Assamese", f: "🇮🇳" },
  { c: "or", n: "ଓଡ଼ିଆ", e: "Odia", f: "🇮🇳" },
  { c: "sa", n: "संस्कृतम्", e: "Sanskrit", f: "🇮🇳" },
  { c: "dv", n: "ދިވެހި", e: "Dhivehi", f: "🇲🇻", rtl: true },
  { c: "ht", n: "Kreyòl Ayisyen", e: "Haitian Creole", f: "🇭🇹" },
  { c: "qu", n: "Runa Simi", e: "Quechua", f: "🇵🇪" },
  { c: "ay", n: "Aymar aru", e: "Aymara", f: "🇧🇴" },
  { c: "gn", n: "Avañe'ẽ", e: "Guarani", f: "🇵🇾" },
  { c: "mi", n: "Te Reo Māori", e: "Maori", f: "🇳🇿" },
  { c: "sm", n: "Gagana Samoa", e: "Samoan", f: "🇼🇸" },
  { c: "to", n: "Lea faka-Tonga", e: "Tongan", f: "🇹🇴" },
  { c: "fj", n: "Na Vosa Vakaviti", e: "Fijian", f: "🇫🇯" },
  { c: "haw", n: "ʻŌlelo Hawaiʻi", e: "Hawaiian", f: "🌺" },
  { c: "eo", n: "Esperanto", e: "Esperanto", f: "🏳️" },
];

const JA = {
  appName: "テスト採点ver.3",
  appSub: "答案画像をアップロードするだけで、採点・添削・分析まで自動化",
  nav_dashboard: "ダッシュボード",
  nav_new: "新規採点",
  nav_history: "採点履歴",
  nav_processing: "採点中",
  nav_tests: "テスト管理",
  nav_model: "模範解答管理",
  nav_rubric: "採点基準管理",
  nav_students: "生徒管理",
  nav_classes: "クラス管理",
  nav_scores: "成績一覧",
  nav_weakness: "弱点分析",
  nav_reports: "レポート",
  nav_review: "要確認一覧",
  nav_settings: "設定",
  fav: "お気に入り",
  favAdd: "お気に入りに追加",
  favRemove: "お気に入りから外す",
  search: "検索",
  close: "閉じる",
  save: "保存",
  cancel: "キャンセル",
  edit: "編集",
  delete: "削除",
  export: "書き出し",
  exportCsv: "CSVを書き出す",
  exportJson: "JSONを書き出す",
  back: "戻る",
  next: "次へ",
  open: "開く",
  detail: "詳細",
  total: "合計",
  score: "得点",
  points: "配点",
  question: "問題",
  unit: "単元",
  subject: "教科",
  grade: "学年",
  klass: "クラス",
  studentId: "生徒ID",
  status: "状態",
  date: "日付",
  none: "該当なし",
  demoData: "デモデータ",
  language: "表示言語",
  theme: "テーマ",
  light: "ライト",
  dark: "ダーク",
};

const EN = {
  appName: "Test Grader v3",
  appSub: "Upload answer sheets. Grading, red-pen marks and analysis happen automatically.",
  nav_dashboard: "Dashboard",
  nav_new: "New grading",
  nav_history: "History",
  nav_processing: "In progress",
  nav_tests: "Tests",
  nav_model: "Model answers",
  nav_rubric: "Rubrics",
  nav_students: "Students",
  nav_classes: "Classes",
  nav_scores: "Scores",
  nav_weakness: "Weakness analysis",
  nav_reports: "Reports",
  nav_review: "Needs review",
  nav_settings: "Settings",
  fav: "Favorites",
  favAdd: "Pin to favorites",
  favRemove: "Unpin",
  search: "Search",
  close: "Close",
  save: "Save",
  cancel: "Cancel",
  edit: "Edit",
  delete: "Delete",
  export: "Export",
  exportCsv: "Export CSV",
  exportJson: "Export JSON",
  back: "Back",
  next: "Next",
  open: "Open",
  detail: "Details",
  total: "Total",
  score: "Score",
  points: "Points",
  question: "Question",
  unit: "Unit",
  subject: "Subject",
  grade: "Grade",
  klass: "Class",
  studentId: "Student ID",
  status: "Status",
  date: "Date",
  none: "No results",
  demoData: "Demo data",
  language: "Display language",
  theme: "Theme",
  light: "Light",
  dark: "Dark",
};

// 主要言語のナビゲーション訳（未収録キーは英語にフォールバック）
const PARTIAL = {
  zh: { appName: "试卷批改 v3", nav_dashboard: "仪表板", nav_new: "新建批改", nav_history: "批改记录", nav_processing: "批改中", nav_tests: "试卷管理", nav_model: "标准答案", nav_rubric: "评分标准", nav_students: "学生管理", nav_classes: "班级管理", nav_scores: "成绩一览", nav_weakness: "弱点分析", nav_reports: "报告", nav_review: "待确认", nav_settings: "设置", fav: "收藏", language: "显示语言", theme: "主题", light: "浅色", dark: "深色" },
  ko: { appName: "시험 채점 v3", nav_dashboard: "대시보드", nav_new: "새 채점", nav_history: "채점 기록", nav_processing: "채점 중", nav_tests: "시험 관리", nav_model: "모범 답안", nav_rubric: "채점 기준", nav_students: "학생 관리", nav_classes: "학급 관리", nav_scores: "성적 목록", nav_weakness: "취약점 분석", nav_reports: "리포트", nav_review: "확인 필요", nav_settings: "설정", fav: "즐겨찾기", language: "표시 언어", theme: "테마", light: "라이트", dark: "다크" },
  es: { appName: "Corrector de Exámenes v3", nav_dashboard: "Panel", nav_new: "Nueva corrección", nav_history: "Historial", nav_processing: "En proceso", nav_tests: "Exámenes", nav_model: "Respuestas modelo", nav_rubric: "Rúbricas", nav_students: "Estudiantes", nav_classes: "Clases", nav_scores: "Calificaciones", nav_weakness: "Análisis de debilidades", nav_reports: "Informes", nav_review: "Requiere revisión", nav_settings: "Ajustes", fav: "Favoritos", language: "Idioma", theme: "Tema", light: "Claro", dark: "Oscuro" },
  fr: { appName: "Correcteur v3", nav_dashboard: "Tableau de bord", nav_new: "Nouvelle correction", nav_history: "Historique", nav_processing: "En cours", nav_tests: "Épreuves", nav_model: "Corrigés", nav_rubric: "Barèmes", nav_students: "Élèves", nav_classes: "Classes", nav_scores: "Notes", nav_weakness: "Analyse des lacunes", nav_reports: "Rapports", nav_review: "À vérifier", nav_settings: "Paramètres", fav: "Favoris", language: "Langue", theme: "Thème", light: "Clair", dark: "Sombre" },
  de: { appName: "Klausur-Korrektor v3", nav_dashboard: "Übersicht", nav_new: "Neue Korrektur", nav_history: "Verlauf", nav_processing: "In Arbeit", nav_tests: "Klausuren", nav_model: "Musterlösungen", nav_rubric: "Bewertung", nav_students: "Lernende", nav_classes: "Klassen", nav_scores: "Noten", nav_weakness: "Schwächenanalyse", nav_reports: "Berichte", nav_review: "Prüfen", nav_settings: "Einstellungen", fav: "Favoriten", language: "Sprache", theme: "Design", light: "Hell", dark: "Dunkel" },
  pt: { appName: "Corretor de Provas v3", nav_dashboard: "Painel", nav_new: "Nova correção", nav_history: "Histórico", nav_processing: "Em andamento", nav_tests: "Provas", nav_model: "Gabaritos", nav_rubric: "Critérios", nav_students: "Alunos", nav_classes: "Turmas", nav_scores: "Notas", nav_weakness: "Análise de lacunas", nav_reports: "Relatórios", nav_review: "Revisar", nav_settings: "Configurações", fav: "Favoritos", language: "Idioma", theme: "Tema", light: "Claro", dark: "Escuro" },
  vi: { appName: "Chấm bài v3", nav_dashboard: "Bảng điều khiển", nav_new: "Chấm mới", nav_history: "Lịch sử", nav_processing: "Đang chấm", nav_tests: "Đề thi", nav_model: "Đáp án mẫu", nav_rubric: "Thang điểm", nav_students: "Học sinh", nav_classes: "Lớp học", nav_scores: "Điểm số", nav_weakness: "Phân tích điểm yếu", nav_reports: "Báo cáo", nav_review: "Cần kiểm tra", nav_settings: "Cài đặt", fav: "Yêu thích", language: "Ngôn ngữ", theme: "Giao diện", light: "Sáng", dark: "Tối" },
  th: { appName: "ตรวจข้อสอบ v3", nav_dashboard: "แดชบอร์ด", nav_new: "ตรวจใหม่", nav_history: "ประวัติ", nav_processing: "กำลังตรวจ", nav_tests: "ข้อสอบ", nav_model: "เฉลย", nav_rubric: "เกณฑ์ให้คะแนน", nav_students: "นักเรียน", nav_classes: "ห้องเรียน", nav_scores: "คะแนน", nav_weakness: "วิเคราะห์จุดอ่อน", nav_reports: "รายงาน", nav_review: "ต้องตรวจสอบ", nav_settings: "ตั้งค่า", fav: "รายการโปรด", language: "ภาษา", theme: "ธีม", light: "สว่าง", dark: "มืด" },
  id: { appName: "Penilai Ujian v3", nav_dashboard: "Dasbor", nav_new: "Penilaian baru", nav_history: "Riwayat", nav_processing: "Sedang dinilai", nav_tests: "Ujian", nav_model: "Kunci jawaban", nav_rubric: "Rubrik", nav_students: "Siswa", nav_classes: "Kelas", nav_scores: "Nilai", nav_weakness: "Analisis kelemahan", nav_reports: "Laporan", nav_review: "Perlu ditinjau", nav_settings: "Pengaturan", fav: "Favorit", language: "Bahasa", theme: "Tema", light: "Terang", dark: "Gelap" },
  ar: { appName: "مصحح الاختبارات v3", nav_dashboard: "لوحة التحكم", nav_new: "تصحيح جديد", nav_history: "السجل", nav_processing: "قيد التصحيح", nav_tests: "الاختبارات", nav_model: "الإجابات النموذجية", nav_rubric: "معايير التصحيح", nav_students: "الطلاب", nav_classes: "الفصول", nav_scores: "الدرجات", nav_weakness: "تحليل نقاط الضعف", nav_reports: "التقارير", nav_review: "بحاجة لمراجعة", nav_settings: "الإعدادات", fav: "المفضلة", language: "اللغة", theme: "المظهر", light: "فاتح", dark: "داكن" },
};

const DICT = { ja: JA, en: EN };
Object.keys(PARTIAL).forEach((k) => {
  DICT[k] = { ...EN, ...PARTIAL[k] };
});

function makeT(lang) {
  const d = DICT[lang] || DICT.en;
  return (key) => d[key] ?? JA[key] ?? key;
}
const isRTL = (lang) => !!(LANGS.find((l) => l.c === lang) || {}).rtl;

/* ---------------------------------------------------------------------------
 * 3. 汎用ユーティリティ
 * -------------------------------------------------------------------------*/
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (a, b) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);
const fmtDate = (iso) => (iso || "").slice(0, 10).replace(/-/g, "/");
const fmtDateTime = (iso) =>
  !iso ? "" : `${iso.slice(0, 10).replace(/-/g, "/")} ${iso.slice(11, 16)}`;
const uid = (() => {
  let n = 1000;
  return (p = "id") => `${p}_${++n}`;
})();

function download(filename, text, mime = "text/plain;charset=utf-8") {
  try {
    const blob = new Blob(["\uFEFF" + text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch (e) {
    console.warn("download failed", e);
    return false;
  }
}
function toCSV(rows, headers) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = headers.map((h) => esc(h.label)).join(",");
  const body = rows
    .map((r) => headers.map((h) => esc(typeof h.get === "function" ? h.get(r) : r[h.key])).join(","))
    .join("\n");
  return head + "\n" + body;
}

/* ---------------------------------------------------------------------------
 * 4. デモデータ生成
 * -------------------------------------------------------------------------*/
const CLASSES = [
  { id: "c1", grade: 2, name: "A", label: "2年A組", teacher: "担任 T.K", size: 9 },
  { id: "c2", grade: 2, name: "B", label: "2年B組", teacher: "担任 M.S", size: 8 },
  { id: "c3", grade: 3, name: "A", label: "3年A組", teacher: "担任 H.N", size: 8 },
];

const INITIALS = [
  "A.S","T.K","M.Y","K.H","R.I","S.N","Y.M","N.O","H.T","D.F",
  "E.W","J.A","C.U","F.K","G.S","I.M","L.T","O.N","P.R","Q.S",
  "U.K","V.M","W.T","X.Y","Z.A",
];

function buildStudents() {
  const out = [];
  let seq = 0;
  CLASSES.forEach((c) => {
    for (let i = 1; i <= c.size; i++) {
      seq++;
      out.push({
        id: `s_${c.id}_${i}`,
        classId: c.id,
        number: i,                                   // 出席番号
        examNo: `${c.grade}${c.name}${String(i).padStart(2, "0")}`, // 受験番号
        anonId: `生徒${String(seq).padStart(3, "0")}`,
        initials: INITIALS[(seq - 1) % INITIALS.length],
        // 実名は取得しても保存しない設計（フィールド自体を持たない）
        support: seq % 11 === 0,   // 特別支援配慮対象
        note: seq % 7 === 0 ? "読字に配慮（拡大表示推奨）" : "",
      });
    }
  });
  return out;
}
const STUDENTS = buildStudents();
const studentById = (id) => STUDENTS.find((s) => s.id === id);
const classById = (id) => CLASSES.find((c) => c.id === id);

const QTYPES = [
  { k: "calc", label: "計算" },
  { k: "choice", label: "選択" },
  { k: "fill", label: "穴埋め" },
  { k: "short", label: "短文記述" },
  { k: "long", label: "長文記述" },
  { k: "graph", label: "作図・グラフ" },
];

const TEST_DEFS = [
  {
    id: "t1",
    name: "1学期期末テスト",
    subject: "数学",
    grade: 2,
    term: "1学期",
    date: "2026-07-08",
    testNo: "M-2026-05",
    examNo: "07",
    units: ["式の計算", "連立方程式", "一次関数", "図形の性質"],
    seed: 11,
    qCount: 14,
  },
  {
    id: "t2",
    name: "第2回定期考査",
    subject: "英語",
    grade: 2,
    term: "1学期",
    date: "2026-07-09",
    testNo: "E-2026-05",
    examNo: "08",
    units: ["現在完了", "不定詞", "比較", "長文読解"],
    seed: 23,
    qCount: 13,
  },
  {
    id: "t3",
    name: "単元テスト（化学変化）",
    subject: "理科",
    grade: 2,
    term: "1学期",
    date: "2026-07-02",
    testNo: "S-2026-03",
    examNo: "05",
    units: ["化学変化と原子", "化学反応式", "質量保存", "実験の考察"],
    seed: 37,
    qCount: 12,
  },
  {
    id: "t4",
    name: "実力テスト",
    subject: "国語",
    grade: 3,
    term: "1学期",
    date: "2026-07-10",
    testNo: "J-2026-06",
    examNo: "09",
    units: ["漢字・語句", "説明的文章", "文学的文章", "古典"],
    seed: 53,
    qCount: 12,
  },
];

const MODEL_TEXT = {
  数学: [
    "移項して整理し、両辺を係数で割る。",
    "加減法で y を消去してから x を求める。",
    "傾き a を 2 点から求め、切片 b を代入して決定する。",
    "対頂角と錯角が等しいことを用いて示す。",
  ],
  英語: [
    "現在完了（have + 過去分詞）で継続を表す。",
    "to 不定詞の名詞的用法で目的語にする。",
    "比較級 + than を用いて 2 つを比べる。",
    "本文3段落目の指示語が指す内容をまとめる。",
  ],
  理科: [
    "原子の種類と数が反応の前後で変わらないことを示す。",
    "化学反応式は左右で原子数をそろえて書く。",
    "密閉容器では質量は保存される。",
    "対照実験の条件を1つだけ変えて比較する。",
  ],
  国語: [
    "文脈から漢字の訓読みを判断して書く。",
    "筆者の主張は最終段落に集約されている。",
    "情景描写が心情の変化を暗示している。",
    "係り結びの法則により文末が連体形になる。",
  ],
};

function buildQuestions(def) {
  const rnd = mulberry32(def.seed);
  const qs = [];
  let big = 0;
  for (let i = 1; i <= def.qCount; i++) {
    if (i === 1 || i % 4 === 1) big++;
    const type = i <= 4 ? "calc" : i <= 7 ? "choice" : i <= 9 ? "fill" : i <= 12 ? "short" : "long";
    const t = def.subject === "国語" && type === "calc" ? "fill" : type;
    const points = t === "long" ? 8 : t === "short" ? 6 : t === "graph" ? 6 : 4;
    const unit = def.units[Math.min(def.units.length - 1, Math.floor((i - 1) / Math.ceil(def.qCount / def.units.length)))];
    qs.push({
      no: i,
      big,
      label: `大問${big}-(${((i - 1) % 4) + 1})`,
      type: t,
      typeLabel: (QTYPES.find((q) => q.k === t) || {}).label || t,
      unit,
      points,
      model: pick(rnd, MODEL_TEXT[def.subject] || MODEL_TEXT["数学"]),
      correct:
        t === "choice"
          ? pick(rnd, ["ア", "イ", "ウ", "エ"])
          : t === "calc"
          ? String(Math.floor(rnd() * 40) - 10)
          : t === "fill"
          ? pick(rnd, ["等しい", "increase", "保存", "連体形", "3x-2", "比較級"])
          : "（記述解答）",
      difficulty: rnd() < 0.25 ? "難" : rnd() < 0.6 ? "標準" : "基本",
    });
  }
  return qs;
}

const TESTS = TEST_DEFS.map((d) => {
  const questions = buildQuestions(d);
  return {
    ...d,
    questions,
    maxScore: questions.reduce((a, q) => a + q.points, 0),
    bigCount: questions[questions.length - 1].big,
  };
});
const testById = (id) => TESTS.find((t) => t.id === id);

/* ---------------------------------------------------------------------------
 * 5. ローカル採点エンジン（デモ用ルールベース）
 *    本番では下記 PROD-API 印の箇所を Claude API / Vision API に差し替える
 * -------------------------------------------------------------------------*/

const WRONG_POOL = {
  calc: ["符号ミス", "移項の誤り", "分母の処理", "途中式で計算違い", "単位の書き忘れ"],
  choice: ["ひっかけ選択肢を選択", "設問条件の読み落とし", "消去法の途中で誤り"],
  fill: ["語尾の活用ミス", "スペルミス", "漢字の誤り", "用語の混同"],
  short: ["理由の説明が不足", "設問の要求語数に未達", "根拠の引用がない"],
  long: ["論の展開が途中で終了", "結論が主張とずれる", "本文根拠の提示がない"],
  graph: ["目盛りの取り方が不正確", "軸ラベルの記入漏れ"],
};

const PRAISE = [
  "式の立て方が正確です。",
  "途中式がていねいで読みやすい。",
  "根拠の示し方がよい。",
  "設問の条件をよく読めています。",
  "前回より記述量が増えました。",
];

/**
 * 1枚の答案を採点する。
 * PROD-API: 実運用では画像を Claude API (vision) に送り、
 *   ①手書き文字認識 ②配点に沿った採点 ③部分点判定 を実行して results を受け取る。
 *   例) POST https://api.anthropic.com/v1/messages
 *       model: "claude-sonnet-4-6", content: [{type:"image", source:{...}}, {type:"text", text: rubricPrompt}]
 */
function gradeSubmission(test, student, seed, opts = {}) {
  const rnd = mulberry32(seed);
  const ability = 0.45 + rnd() * 0.5;                 // 生徒ごとの実力
  const weakUnit = test.units[Math.floor(rnd() * test.units.length)];
  const blank = !!opts.forceBlank;

  const items = test.questions.map((q) => {
    if (blank) {
      return {
        qno: q.no, label: q.label, unit: q.unit, type: q.type, typeLabel: q.typeLabel,
        points: q.points, detected: "", confidence: 0.99, blank: true,
        mark: "-", earned: 0, needReview: false, reason: "無記入", comment: "",
      };
    }
    const unitPenalty = q.unit === weakUnit ? 0.28 : 0;
    const diffPenalty = q.difficulty === "難" ? 0.18 : q.difficulty === "標準" ? 0.06 : 0;
    const p = clamp(ability - unitPenalty - diffPenalty + (rnd() - 0.5) * 0.18, 0.02, 0.98);
    const roll = rnd();
    let mark, earned, reason = "", comment = "";
    const partialCapable = q.type === "short" || q.type === "long" || q.type === "calc" || q.type === "graph";

    if (roll < p) {
      mark = "○"; earned = q.points; comment = rnd() < 0.35 ? pick(rnd, PRAISE) : "";
    } else if (partialCapable && roll < p + 0.22) {
      mark = "△";
      earned = Math.max(1, Math.round(q.points * (rnd() < 0.5 ? 0.5 : 0.75)));
      reason = pick(rnd, WRONG_POOL[q.type] || WRONG_POOL.short);
      comment = `${reason}。あと一歩で満点です。`;
    } else {
      mark = "×"; earned = 0;
      reason = pick(rnd, WRONG_POOL[q.type] || WRONG_POOL.short);
      comment = `${reason}。${q.model}`;
    }

    // 認識信頼度（低いものは要確認へ回す）
    let confidence = clamp(0.84 + rnd() * 0.15, 0, 0.99);
    if (q.type === "long" || q.type === "short") confidence -= rnd() * 0.09;
    if (rnd() < 0.022) confidence = 0.44 + rnd() * 0.22;  // 判読困難
    confidence = clamp(confidence, 0.35, 0.99);
    const needReview = confidence < 0.72;

    const detected =
      q.type === "choice" ? (mark === "○" ? q.correct : pick(rnd, ["ア", "イ", "ウ", "エ"]))
      : q.type === "calc" ? (mark === "○" ? q.correct : String(Number(q.correct) + (Math.floor(rnd() * 8) - 4)))
      : q.type === "fill" ? (mark === "○" ? q.correct : q.correct + (rnd() < 0.5 ? "い" : "s"))
      : mark === "○" ? "（記述：要点を満たす解答）"
      : mark === "△" ? "（記述：一部の要点が不足）"
      : "（記述：要点を満たさない解答）";

    return {
      qno: q.no, label: q.label, unit: q.unit, type: q.type, typeLabel: q.typeLabel,
      points: q.points, detected, confidence: Math.round(confidence * 100) / 100,
      blank: false, mark, earned, needReview,
      reason, comment,
    };
  });

  const total = items.reduce((a, i) => a + i.earned, 0);
  return { items, total, blank, weakUnit };
}

/** 画像品質チェック（PROD-API: 実運用では前処理サーバ or Vision でスコアリング） */
function checkQuality(seed, forceIssue = false) {
  const rnd = mulberry32(seed);
  const v = (base) => Math.round(clamp(base + rnd() * 0.25, 0, 1) * 100);
  const q = {
    tilt: v(0.78), brightness: v(0.8), blur: v(0.82),
    shadow: v(0.79), coverage: v(0.86), contrast: v(0.8),
  };
  if (forceIssue) { q.blur = 41; q.shadow = 48; }
  const issues = [];
  if (q.tilt < 60) issues.push({ k: "傾き", msg: "用紙が傾いています。枠に合わせて撮り直してください。" });
  if (q.brightness < 60) issues.push({ k: "明るさ", msg: "暗すぎます。明るい場所で撮影してください。" });
  if (q.blur < 60) issues.push({ k: "ぼやけ", msg: "ピントが合っていません。手ぶれに注意して再撮影してください。" });
  if (q.shadow < 60) issues.push({ k: "影・反射", msg: "影が写り込んでいます。光源の位置を変えてください。" });
  if (q.coverage < 60) issues.push({ k: "見切れ", msg: "答案の端が写っていません。全体が入るように撮影してください。" });
  const fixes = ["自動トリミング", "台形補正", "傾き補正", "コントラスト補正", "ノイズ除去"];
  return { scores: q, issues, fixes, ok: issues.length === 0, avg: Math.round(Object.values(q).reduce((a, b) => a + b, 0) / 6) };
}

/** 弱点分析（単元別・設問形式別・ミス傾向） */
function analyze(test, result) {
  const byUnit = {};
  const byType = {};
  const mistakes = {};
  result.items.forEach((it) => {
    const u = (byUnit[it.unit] = byUnit[it.unit] || { unit: it.unit, earned: 0, points: 0, wrong: 0, n: 0 });
    u.earned += it.earned; u.points += it.points; u.n++;
    if (it.mark !== "○") u.wrong++;
    const ty = (byType[it.typeLabel] = byType[it.typeLabel] || { type: it.typeLabel, earned: 0, points: 0, n: 0 });
    ty.earned += it.earned; ty.points += it.points; ty.n++;
    if (it.reason) mistakes[it.reason] = (mistakes[it.reason] || 0) + 1;
  });
  const units = Object.values(byUnit).map((u) => ({ ...u, rate: pct(u.earned, u.points) })).sort((a, b) => a.rate - b.rate);
  const types = Object.values(byType).map((t) => ({ ...t, rate: pct(t.earned, t.points) })).sort((a, b) => a.rate - b.rate);
  const topMistakes = Object.entries(mistakes).map(([k, v]) => ({ reason: k, count: v })).sort((a, b) => b.count - a.count);
  return { units, types, topMistakes };
}

/** 生徒向けフィードバック / 教師向け指導提案（PROD-API: 生成AIで文面生成） */
function buildFeedback(test, result, ana) {
  const rate = pct(result.total, test.maxScore);
  const weakest = ana.units[0];
  const strongest = ana.units[ana.units.length - 1];
  const student = [
    `今回の得点は ${result.total} / ${test.maxScore} 点（得点率 ${rate}%）でした。`,
    strongest ? `${strongest.unit} は ${strongest.rate}% と安定しています。この解き方は続けてください。` : "",
    weakest ? `いちばん伸びしろがあるのは ${weakest.unit}（${weakest.rate}%）です。まず教科書の例題を3問、途中式まで書き直してみましょう。` : "",
    ana.topMistakes[0] ? `ミスの傾向は「${ana.topMistakes[0].reason}」が ${ana.topMistakes[0].count} 回。見直しのときはここだけを重点的に確認します。` : "",
  ].filter(Boolean);
  const teacher = [
    weakest ? `${weakest.unit} の定着が不十分（クラス平均比で要確認）。導入の言い換えを1時間分追加することを推奨します。` : "",
    ana.types[0] ? `設問形式では「${ana.types[0].type}」の得点率が ${ana.types[0].rate}% と最も低く、解答手順の型を示す指導が有効です。` : "",
    ana.topMistakes.length ? `頻出ミス：${ana.topMistakes.slice(0, 3).map((m) => `${m.reason}(${m.count})`).join(" / ")}` : "",
    result.items.some((i) => i.needReview) ? `認識信頼度の低い設問があります。返却前に「要確認一覧」で目視確認してください。` : "",
  ].filter(Boolean);
  const nextStep = weakest
    ? [`${weakest.unit} の基礎問題 5 問`, `${weakest.unit} の応用問題 2 問`, "誤答ノートに「なぜ間違えたか」を1行で記録"]
    : ["現状維持で応用問題に挑戦"];
  return { student, teacher, nextStep, rate };
}

/** 全問白紙のときの模範解答生成（PROD-API: 生成AIで解説文を作成） */
function buildModelAnswers(test) {
  return test.questions.map((q) => ({
    qno: q.no, label: q.label, unit: q.unit, points: q.points,
    answer: q.correct === "（記述解答）" ? q.model : q.correct,
    solution: `${q.model} 配点 ${q.points} 点。${q.type === "long" ? "結論→根拠→まとめの順で書くと要点を落としません。" : q.type === "calc" ? "途中式を残すと部分点の対象になります。" : "設問の条件語（すべて／ひとつ）に線を引いて確認します。"}`,
    keywords:
      q.type === "long" || q.type === "short"
        ? ["結論", "根拠", "本文引用"]
        : q.type === "calc" ? ["立式", "計算", "単位"] : ["用語", "表記"],
  }));
}

/* ---------------------------------------------------------------------------
 * 6. 提出データ（デモ）
 * -------------------------------------------------------------------------*/
const SOURCES = {
  mobile: { label: "生徒モバイル提出", icon: "📱" },
  camera: { label: "教師カメラ撮影", icon: "📷" },
  mfp: { label: "印刷機・コピー機スキャン", icon: "🖨" },
  file: { label: "PCからファイル選択", icon: "💻" },
  pdf: { label: "PDF一括", icon: "📄" },
};

function buildSubmissions() {
  const plan = [
    { testId: "t1", classId: "c1", base: 100 },
    { testId: "t1", classId: "c2", base: 200 },
    { testId: "t2", classId: "c1", base: 300 },
    { testId: "t3", classId: "c2", base: 400 },
    { testId: "t4", classId: "c3", base: 500 },
  ];
  const out = [];
  let n = 0;
  plan.forEach((p) => {
    const test = testById(p.testId);
    const roster = STUDENTS.filter((s) => s.classId === p.classId);
    roster.forEach((st, i) => {
      n++;
      const seed = p.base + i * 7;
      const rnd = mulberry32(seed + 3);
      const forceBlank = p.testId === "t3" && i === 2;             // 白紙答案のデモ
      const forceIssue = (p.testId === "t3" && i === 5) || (p.testId === "t4" && i === 1);
      const processing = p.testId === "t4" && i >= 6;              // 採点中のデモ
      const quality = checkQuality(seed, forceIssue);
      const result = gradeSubmission(test, st, seed, { forceBlank });
      const src = pick(rnd, ["mobile", "camera", "mfp", "file", "pdf"]);
      const needReview = result.items.some((it) => it.needReview);
      const status = processing ? "processing" : forceBlank ? "blank" : forceIssue ? "quality" : needReview ? "review" : "done";
      const day = test.date;
      const hh = String(9 + (i % 8)).padStart(2, "0");
      const mm = String((i * 13) % 60).padStart(2, "0");
      out.push({
        id: `sub_${p.testId}_${st.id}`,
        seq: n,
        testId: p.testId,
        studentId: st.id,
        classId: p.classId,
        source: src,
        pages: 1 + (i % 3 === 0 ? 1 : 0),
        uploadedAt: `${day}T${hh}:${mm}:00`,
        quality,
        result,
        status,
        edited: false,
        progress: processing ? [35, 62, 78, 91][i % 4] : 100,
        reviewedBy: status === "done" && i % 5 === 0 ? "T.K" : "",
      });
    });
  });
  return out;
}
const INITIAL_SUBMISSIONS = buildSubmissions();

/* ---------------------------------------------------------------------------
 * 7. 共通UIコンポーネント
 * -------------------------------------------------------------------------*/
const Ctx = React.createContext(null);
const useUI = () => React.useContext(Ctx);

function Card({ children, style, pad = 16, title, sub, right, tone }) {
  const { T } = useUI();
  return (
    <section
      style={{
        background: tone === "alt" ? T.panelAlt : T.panel,
        border: `1px solid ${T.line}`,
        borderRadius: 14,
        boxShadow: T.shadow,
        overflow: "hidden",
        ...style,
      }}
    >
      {(title || right) && (
        <header
          style={{
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            padding: "12px 16px", borderBottom: `1px solid ${T.line}`,
            background: T.panelAlt,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text, letterSpacing: ".02em" }}>{title}</div>
            {sub && <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 2 }}>{sub}</div>}
          </div>
          {right}
        </header>
      )}
      <div style={{ padding: pad }}>{children}</div>
    </section>
  );
}

function Btn({ children, onClick, variant = "default", size = "md", disabled, style, title, full }) {
  const { T } = useUI();
  const [hover, setHover] = useState(false);
  const pads = { sm: "5px 10px", md: "8px 14px", lg: "11px 20px" };
  const fonts = { sm: 12, md: 13, lg: 14.5 };
  const map = {
    default: { bg: T.panel, fg: T.text, bd: T.lineStrong },
    primary: { bg: T.accent, fg: "#fff", bd: T.accent },
    shu: { bg: T.shu, fg: "#fff", bd: T.shu },
    ghost: { bg: "transparent", fg: T.textSub, bd: "transparent" },
    soft: { bg: T.accentSoft, fg: T.accent, bd: "transparent" },
    danger: { bg: T.ngSoft, fg: T.ng, bd: T.ng },
  };
  const c = map[variant] || map.default;
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        font: `600 ${fonts[size]}px/1.2 ${FONT_UI}`,
        padding: pads[size],
        borderRadius: 9,
        border: `1px solid ${c.bd}`,
        background: c.bg,
        color: c.fg,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : hover ? 0.88 : 1,
        transition: "opacity .15s, transform .1s",
        transform: hover && !disabled ? "translateY(-1px)" : "none",
        width: full ? "100%" : undefined,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function Badge({ children, tone = "info", style }) {
  const { T } = useUI();
  const map = {
    ok: [T.okSoft, T.ok], warn: [T.warnSoft, T.warn], ng: [T.ngSoft, T.ng],
    info: [T.infoSoft, T.info], accent: [T.accentSoft, T.accent], shu: [T.shuSoft, T.shu],
    mute: [T.bgAlt, T.textSub],
  };
  const [bg, fg] = map[tone] || map.info;
  return (
    <span style={{ background: bg, color: fg, borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", ...style }}>
      {children}
    </span>
  );
}

function Field({ label, children, hint }) {
  const { T } = useUI();
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: T.textSub, marginBottom: 5 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: T.textFaint, marginTop: 4 }}>{hint}</div>}
    </label>
  );
}

function inputStyle(T) {
  return {
    width: "100%", boxSizing: "border-box", padding: "9px 11px",
    borderRadius: 9, border: `1px solid ${T.lineStrong}`,
    background: T.panel, color: T.text, font: `500 13px ${FONT_UI}`, outline: "none",
  };
}

function Select({ value, onChange, options, style }) {
  const { T } = useUI();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle(T), ...style }}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function Input({ value, onChange, placeholder, type = "text", style }) {
  const { T } = useUI();
  return (
    <input type={type} value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle(T), ...style }} />
  );
}

function Bar({ value, max = 100, tone = "accent", height = 8, label }) {
  const { T } = useUI();
  const map = { accent: T.accent, ok: T.ok, warn: T.warn, ng: T.ng, shu: T.shu, info: T.info };
  const w = clamp((value / (max || 1)) * 100, 0, 100);
  return (
    <div>
      <div style={{ background: T.bgAlt, borderRadius: 999, height, overflow: "hidden" }}>
        <div style={{ width: `${w}%`, height: "100%", background: map[tone] || T.accent, borderRadius: 999, transition: "width .5s ease" }} />
      </div>
      {label && <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 3 }}>{label}</div>}
    </div>
  );
}

function Stat({ label, value, unit, tone = "accent", sub }) {
  const { T } = useUI();
  const map = { accent: T.accent, ok: T.ok, warn: T.warn, ng: T.ng, shu: T.shu, info: T.info, text: T.text };
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.line}`, borderRadius: 12, padding: 14, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: T.textSub, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span style={{ font: `700 26px/1 ${FONT_MONO}`, color: map[tone] }}>{value}</span>
        {unit && <span style={{ fontSize: 12, color: T.textSub, fontWeight: 600 }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11, color: T.textFaint, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function Table({ columns, rows, onRow, empty = "データがありません", maxHeight }) {
  const { T } = useUI();
  return (
    <div style={{ overflowX: "auto", maxHeight, overflowY: maxHeight ? "auto" : undefined }}>
      <table style={{ width: "100%", borderCollapse: "collapse", font: `13px ${FONT_UI}`, minWidth: columns.length * 92 }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{
                textAlign: c.align || "left", padding: "9px 10px", fontSize: 11, fontWeight: 700,
                color: T.textSub, borderBottom: `1px solid ${T.lineStrong}`, whiteSpace: "nowrap",
                position: maxHeight ? "sticky" : undefined, top: 0, background: T.panel, zIndex: 1,
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={columns.length} style={{ padding: 26, textAlign: "center", color: T.textFaint, fontSize: 12.5 }}>{empty}</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={r.id || i}
              onClick={onRow ? () => onRow(r) : undefined}
              style={{ cursor: onRow ? "pointer" : "default", background: i % 2 ? T.panelAlt : "transparent" }}>
              {columns.map((c) => (
                <td key={c.key} style={{
                  padding: "9px 10px", borderBottom: `1px solid ${T.line}`, color: T.text,
                  textAlign: c.align || "left", whiteSpace: c.wrap ? "normal" : "nowrap",
                }}>{c.render ? c.render(r) : r[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Modal({ open, onClose, title, children, width = 720, footer }) {
  const { T } = useUI();
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(12,16,22,.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 14, backdropFilter: "blur(2px)" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: T.panel, borderRadius: 16, border: `1px solid ${T.lineStrong}`, width: "100%", maxWidth: width, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,.35)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: `1px solid ${T.line}` }}>
          <div style={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: T.text }}>{title}</div>
          <Btn variant="ghost" size="sm" onClick={onClose}>✕</Btn>
        </div>
        <div style={{ padding: 16, overflowY: "auto" }}>{children}</div>
        {footer && <div style={{ padding: "12px 16px", borderTop: `1px solid ${T.line}`, display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>{footer}</div>}
      </div>
    </div>
  );
}

function Toast({ toasts }) {
  const { T } = useUI();
  return (
    <div style={{ position: "fixed", right: 14, bottom: 14, zIndex: 300, display: "flex", flexDirection: "column", gap: 8, maxWidth: 320 }}>
      {toasts.map((t) => (
        <div key={t.id} style={{
          background: t.tone === "ng" ? T.ngSoft : t.tone === "warn" ? T.warnSoft : T.okSoft,
          color: t.tone === "ng" ? T.ng : t.tone === "warn" ? T.warn : T.ok,
          border: `1px solid ${t.tone === "ng" ? T.ng : t.tone === "warn" ? T.warn : T.ok}`,
          borderRadius: 11, padding: "10px 13px", font: `600 12.5px ${FONT_UI}`, boxShadow: T.shadow,
        }}>{t.msg}</div>
      ))}
    </div>
  );
}

function Empty({ icon = "🗂", title, hint, action }) {
  const { T } = useUI();
  return (
    <div style={{ textAlign: "center", padding: "34px 16px" }}>
      <div style={{ fontSize: 30, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 5 }}>{title}</div>
      {hint && <div style={{ fontSize: 12.5, color: T.textSub, marginBottom: 12, lineHeight: 1.6 }}>{hint}</div>}
      {action}
    </div>
  );
}

function Section({ title, children, right, id }) {
  const { T } = useUI();
  return (
    <div id={id} style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <h2 style={{ margin: 0, font: `700 15px ${FONT_UI}`, color: T.text, letterSpacing: ".02em" }}>{title}</h2>
        <div style={{ flex: 1, height: 1, background: T.line }} />
        {right}
      </div>
      {children}
    </div>
  );
}

const grid = (min, gap = 12) => ({
  display: "grid", gap, gridTemplateColumns: `repeat(auto-fill,minmax(${min}px,1fr))`,
});

/* ---------------------------------------------------------------------------
 * 8. 赤ペン採点画像（signature element）
 *    答案画像の上に丸・バツ・三角・得点・コメントを重ねて描画する。
 *    PROD-API: 実運用では原本画像を <image> として敷き、
 *              Vision が返した座標(bbox)にこのマークを重ねる。
 * -------------------------------------------------------------------------*/
function wobblePath(cx, cy, rx, ry, seed) {
  const rnd = mulberry32(seed);
  const pts = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 - 0.5;
    const jitter = 1 + (rnd() - 0.5) * 0.13;
    pts.push([cx + Math.cos(a) * rx * jitter, cy + Math.sin(a) * ry * jitter]);
  }
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i];
    const [px, py] = pts[i - 1];
    d += ` Q ${(px + (x - px) * 0.5 + (rnd() - 0.5) * 4).toFixed(1)} ${(py + (y - py) * 0.5 + (rnd() - 0.5) * 4).toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d + " Z";
}
function strokeLine(x1, y1, x2, y2, seed) {
  const rnd = mulberry32(seed);
  const mx = (x1 + x2) / 2 + (rnd() - 0.5) * 6;
  const my = (y1 + y2) / 2 + (rnd() - 0.5) * 6;
  return `M ${x1} ${y1} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x2} ${y2}`;
}

function MarkGlyph({ mark, cx, cy, seed, size = 17 }) {
  const SHU = "#D0342C";
  const common = { fill: "none", stroke: SHU, strokeWidth: 2.6, strokeLinecap: "round", opacity: 0.92 };
  if (mark === "○") return <path d={wobblePath(cx, cy, size, size * 0.92, seed)} {...common} />;
  if (mark === "×")
    return (
      <g {...common}>
        <path d={strokeLine(cx - size, cy - size, cx + size, cy + size, seed)} fill="none" stroke={SHU} strokeWidth={2.8} strokeLinecap="round" />
        <path d={strokeLine(cx + size, cy - size, cx - size, cy + size, seed + 9)} fill="none" stroke={SHU} strokeWidth={2.8} strokeLinecap="round" />
      </g>
    );
  if (mark === "△") {
    const rnd = mulberry32(seed);
    const j = () => (rnd() - 0.5) * 3;
    const p = `M ${cx + j()} ${cy - size + j()} L ${cx + size + j()} ${cy + size * 0.8 + j()} L ${cx - size + j()} ${cy + size * 0.8 + j()} Z`;
    return <path d={p} {...common} />;
  }
  return (
    <text x={cx} y={cy + 6} textAnchor="middle" fill={SHU} style={{ font: `700 17px ${FONT_HAND}` }} opacity={0.8}>—</text>
  );
}

function RedPenSheet({ test, sub, page = 0, showMarks = true, showComments = true, svgRef }) {
  const { T } = useUI();
  const st = studentById(sub.studentId);
  const kl = classById(sub.classId);
  const perPage = 7;
  const items = sub.result.items.slice(page * perPage, page * perPage + perPage);
  const W = 760, H = 1075;
  const SHU = "#D0342C";
  const rowH = 108;
  const top = 190;

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", background: T.sheet, borderRadius: 8, maxHeight: "72vh" }} role="img"
      aria-label="赤ペン採点画像">
      <defs>
        <pattern id="fiber" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill="#FFFDF7" />
          <circle cx="1.6" cy="2.4" r="0.35" fill="#EFE9DA" />
          <circle cx="4.4" cy="5.1" r="0.3" fill="#F1ECDE" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#fiber)" />
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} fill="none" stroke="#CFC7B4" />

      {/* ヘッダー */}
      <text x="34" y="52" style={{ font: `700 21px ${FONT_UI}` }} fill="#1D2733">
        {test.subject}　{test.name}
      </text>
      <text x="34" y="76" style={{ font: `13px ${FONT_UI}` }} fill="#5C6675">
        {test.grade}年 ／ {test.term} ／ 実施日 {fmtDate(test.date)} ／ 試験番号 {test.testNo}
      </text>
      <line x1="34" y1="92" x2={W - 34} y2="92" stroke="#C9C0AC" />

      {/* 受験者欄（匿名表示） */}
      <rect x="34" y="106" width={W - 260} height="56" fill="none" stroke="#C9C0AC" />
      <text x="46" y="126" style={{ font: `11px ${FONT_UI}` }} fill="#8A93A0">受験者（匿名表示）</text>
      <text x="46" y="150" style={{ font: `700 16px ${FONT_UI}` }} fill="#1D2733">
        {kl.label} {st.number}番 ／ 受験番号 {st.examNo} ／ {st.anonId}
      </text>

      {/* 得点欄（赤） */}
      <rect x={W - 214} y="106" width="180" height="56" fill="none" stroke="#C9C0AC" />
      <text x={W - 202} y="126" style={{ font: `11px ${FONT_UI}` }} fill="#8A93A0">得点</text>
      {showMarks && (
        <>
          <text x={W - 118} y="154" textAnchor="middle" style={{ font: `700 30px ${FONT_HAND}` }} fill={SHU}>
            {sub.result.total}
          </text>
          <text x={W - 62} y="154" style={{ font: `600 15px ${FONT_HAND}` }} fill={SHU}>/{test.maxScore}</text>
          <path d={wobblePath(W - 118, 144, 40, 22, 77)} fill="none" stroke={SHU} strokeWidth="2.2" opacity="0.85" />
        </>
      )}

      {/* 設問行 */}
      {items.map((it, i) => {
        const y = top + i * rowH;
        const q = test.questions.find((qq) => qq.no === it.qno);
        return (
          <g key={it.qno}>
            <line x1="34" y1={y - 14} x2={W - 34} y2={y - 14} stroke="#E2DACA" />
            <text x="40" y={y + 6} style={{ font: `700 13px ${FONT_UI}` }} fill="#1D2733">{it.label}</text>
            <text x="40" y={y + 26} style={{ font: `10.5px ${FONT_UI}` }} fill="#8A93A0">{it.unit}・{it.typeLabel}・{it.points}点</text>

            {/* 解答欄 */}
            <rect x="132" y={y - 8} width={W - 260} height="72" fill="#FFFFFF" stroke="#DDD5C4" />
            {it.blank ? (
              <text x="146" y={y + 34} style={{ font: `13px ${FONT_UI}` }} fill="#B7BDC6">（無記入）</text>
            ) : (
              <text x="146" y={y + 34} style={{ font: `17px ${FONT_HAND}` }} fill="#28323E">{it.detected}</text>
            )}
            {q && !it.blank && (
              <text x="146" y={y + 56} style={{ font: `10.5px ${FONT_UI}` }} fill="#A6AEB9">
                認識信頼度 {(it.confidence * 100).toFixed(0)}%
              </text>
            )}

            {/* 赤ペンマーク */}
            {showMarks && (
              <g>
                <MarkGlyph mark={it.blank ? "-" : it.mark} cx={W - 96} cy={y + 18} seed={it.qno * 31 + sub.seq} />
                <text x={W - 60} y={y + 24} style={{ font: `700 15px ${FONT_HAND}` }} fill={SHU}>
                  {it.earned}
                </text>
              </g>
            )}
            {/* 赤ペンコメント */}
            {showMarks && showComments && it.comment && (
              <text x="146" y={y + 74} style={{ font: `12px ${FONT_HAND}` }} fill={SHU}>
                {it.comment.length > 42 ? it.comment.slice(0, 42) + "…" : it.comment}
              </text>
            )}
            {it.needReview && (
              <g>
                <rect x="128" y={y - 12} width={W - 252} height="80" fill="none" stroke="#B4761A" strokeDasharray="5 4" />
                <text x={W - 246} y={y - 18} textAnchor="end" style={{ font: `700 10px ${FONT_UI}` }} fill="#B4761A">要確認</text>
              </g>
            )}
          </g>
        );
      })}

      <line x1="34" y1={H - 46} x2={W - 34} y2={H - 46} stroke="#C9C0AC" />
      <text x="34" y={H - 26} style={{ font: `10.5px ${FONT_UI}` }} fill="#9AA2AD">
        テスト採点ver.3 ／ 生徒実名は保存されません ／ ページ {page + 1} / {Math.ceil(sub.result.items.length / perPage)}
      </text>
      {showMarks && (
        <text x={W - 34} y={H - 26} textAnchor="end" style={{ font: `600 10.5px ${FONT_UI}` }} fill={SHU}>
          AI採点 ＋ 教師確認欄 {sub.reviewedBy ? `確認済 ${sub.reviewedBy}` : "未確認"}
        </text>
      )}
    </svg>
  );
}

/* ---------------------------------------------------------------------------
 * 9. ダッシュボード
 * -------------------------------------------------------------------------*/
const FX_BASE = [
  { pair: "USD/JPY", v: 152.4 }, { pair: "EUR/JPY", v: 166.8 }, { pair: "GBP/JPY", v: 195.2 },
  { pair: "CNY/JPY", v: 21.05 }, { pair: "KRW/JPY", v: 0.111 }, { pair: "AUD/JPY", v: 99.7 },
  { pair: "INR/JPY", v: 1.82 }, { pair: "BRL/JPY", v: 27.4 },
];

const PLANS = [
  { id: "free", name: "Free", price: "¥0", per: "/月", quota: "月 30 枚まで", feats: ["自動採点", "赤ペン画像", "CSV出力"], cta: "利用中" },
  { id: "school", name: "School", price: "¥9,800", per: "/月・1校", quota: "月 5,000 枚", feats: ["クラス・生徒管理", "弱点分析レポート", "印刷機スキャン連携", "SSO"], cta: "アップグレード" },
  { id: "board", name: "Board", price: "個別見積", per: "", quota: "無制限", feats: ["教育委員会向け統合管理", "監査ログ", "オンプレ／専用リージョン", "SLA 99.9%"], cta: "問い合わせる" },
];

const QA = [
  { q: "生徒の実名は保存されますか？", a: "保存しません。答案から氏名を読み取れた場合でも、表示・保存は出席番号／受験番号／イニシャル／匿名IDのいずれかに置き換えます。実名フィールドはデータベースに存在しません。" },
  { q: "採点結果は修正できますか？", a: "できます。採点結果画面で丸・三角・バツと得点を1問ずつ編集でき、修正した内容は赤ペン画像と合計点に即時反映されます。修正履歴は監査ログに残ります。" },
  { q: "答案が全問白紙のときはどうなりますか？", a: "採点をスキップし、そのテストの模範解答と解説を自動生成します。生徒への配布用と教師の解説準備用の両方に使えます。" },
  { q: "印刷機やコピー機からアップロードできますか？", a: "できます。複合機のスキャン先に本アプリの取り込みアドレスを登録すると、スキャンした答案がそのまま採点キューに入ります。設定画面から連携コードを発行してください。" },
  { q: "生徒のスマートフォンから提出できますか？", a: "できます。テストごとに提出用リンクとQRコードを発行できます。生徒はアプリのインストール不要で、撮影ガイド枠に合わせて撮るだけで提出が完了します。" },
  { q: "AIの採点はどのくらい信頼できますか？", a: "選択式・穴埋め式はほぼ確実に一致判定できますが、記述式は認識信頼度を1問ごとに表示し、しきい値を下回るものは「要確認一覧」に自動で送ります。返却前の目視確認を前提とした設計です。" },
  { q: "対応言語は？", a: "UI は112言語に切り替えられます。答案の言語とUIの言語は別々に設定でき、教師と生徒で異なる言語を使えます。アラビア語などのRTL言語にも対応します。" },
];

function Dashboard() {
  const { T, t, go, subs, toast, lang } = useUI();
  const [fx, setFx] = useState(() => FX_BASE.map((f) => ({ ...f, d: 0 })));
  const [openQA, setOpenQA] = useState(0);
  const [votes, setVotes] = useState({ good: 1284, bad: 37 });
  const [voted, setVoted] = useState(null);
  const [contact, setContact] = useState({ name: "", email: "", body: "" });
  const [terms, setTerms] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setFx((prev) =>
        prev.map((f) => {
          const d = (Math.random() - 0.5) * (f.v * 0.0016);
          return { ...f, v: Math.round((f.v + d) * 10000) / 10000, d };
        })
      );
    }, 3000);
    return () => clearInterval(id);
  }, []);

  const done = subs.filter((s) => s.status !== "processing");
  const graded = done.filter((s) => s.status !== "blank");
  const reviewCount = subs.filter((s) => s.result.items.some((i) => i.needReview) && s.status !== "processing").length;
  const avgRate = graded.length
    ? Math.round(graded.reduce((a, s) => a + pct(s.result.total, testById(s.testId).maxScore), 0) / graded.length * 10) / 10
    : 0;
  const savedMin = Math.round(done.length * 4.5);

  return (
    <div>
      <div style={{
        background: `linear-gradient(135deg, ${T.accent} 0%, ${T.accent}dd 55%, ${T.shu} 240%)`,
        borderRadius: 16, padding: "22px 20px", color: "#fff", marginBottom: 18, position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", right: -30, top: -20, opacity: 0.14, font: `700 130px ${FONT_HAND}` }}>朱</div>
        <div style={{ fontSize: 12, opacity: 0.85, fontWeight: 700, letterSpacing: ".08em" }}>AI GRADING AGENT</div>
        <h1 style={{ margin: "6px 0 6px", font: `700 24px ${FONT_UI}` }}>{t("appName")}</h1>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.9, maxWidth: 520, lineHeight: 1.7 }}>{t("appSub")}</p>
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <Btn variant="shu" onClick={() => go("new")}>答案をアップロードする</Btn>
          <Btn onClick={() => go("review")} style={{ background: "rgba(255,255,255,.16)", color: "#fff", borderColor: "rgba(255,255,255,.35)" }}>
            要確認 {reviewCount} 件を見る
          </Btn>
        </div>
      </div>

      <div style={{ ...grid(160), marginBottom: 18 }}>
        <Stat label="採点済み答案" value={done.length} unit="枚" tone="accent" sub={`未処理 ${subs.length - done.length} 枚`} />
        <Stat label="平均得点率" value={avgRate} unit="%" tone="ok" sub={`対象 ${graded.length} 枚`} />
        <Stat label="要確認の設問" value={reviewCount} unit="枚" tone="warn" sub="返却前に目視確認" />
        <Stat label="削減した採点時間" value={savedMin} unit="分" tone="shu" sub="1枚あたり4.5分換算" />
      </div>

      <Section title="はじめる">
        <div style={grid(200)}>
          {[
            { k: "new", icon: "📤", t: "答案をアップロード", d: "カメラ・PC・PDF・複合機スキャンから取り込み" },
            { k: "processing", icon: "⏳", t: "採点中を確認", d: "処理の進み具合をリアルタイム表示" },
            { k: "review", icon: "🔍", t: "要確認を片づける", d: "認識信頼度が低い設問だけを集約" },
            { k: "weakness", icon: "📊", t: "弱点分析を見る", d: "単元別・設問形式別の定着度" },
          ].map((a) => (
            <button key={a.k} onClick={() => go(a.k)} style={{
              textAlign: "left", background: T.panel, border: `1px solid ${T.line}`, borderRadius: 13,
              padding: 14, cursor: "pointer", font: FONT_UI, boxShadow: T.shadow,
            }}>
              <div style={{ fontSize: 22, marginBottom: 7 }}>{a.icon}</div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text, marginBottom: 4 }}>{a.t}</div>
              <div style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.6 }}>{a.d}</div>
            </button>
          ))}
        </div>
      </Section>

      <div style={{ ...grid(320, 14), marginBottom: 18 }}>
        {/* 利用規定 */}
        <Card title="アプリ使用規定" sub="ご利用の前にご確認ください">
          <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, color: T.textSub, lineHeight: 1.85 }}>
            <li>答案画像のアップロードは、学校または保護者の同意の範囲内で行ってください。</li>
            <li>AIの採点結果は下書きです。返却前に教師が確認・修正することを前提としています。</li>
            <li>生徒の実名・住所・連絡先を本文欄に入力しないでください。</li>
            <li>出力データの二次利用（模試作成・研究）は学校の規程に従ってください。</li>
          </ul>
          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Btn size="sm" onClick={() => setTerms(true)}>利用規約の全文</Btn>
            <span style={{ fontSize: 11, color: T.textFaint }}>最終更新 2026/06/01・v3.0</span>
          </div>
          <Modal open={terms} onClose={() => setTerms(false)} title="利用規約（要約版）"
            footer={<Btn variant="primary" onClick={() => setTerms(false)}>同意して閉じる</Btn>}>
            <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.9 }}>
              {[
                ["第1条（目的）", "本規約は、教育機関が本サービスを用いて答案の採点・分析を行う際の条件を定めます。"],
                ["第2条（アカウント）", "学校管理者は教職員アカウントを発行し、退職・異動時に速やかに無効化するものとします。"],
                ["第3条（データの取扱い）", "答案画像と採点結果は契約校のテナント内にのみ保存し、他校と混在しません。モデルの再学習には使用しません。"],
                ["第4条（AI採点の位置づけ）", "AIの出力は補助であり、成績評価の最終決定は教員が行います。"],
                ["第5条（禁止事項）", "第三者の答案の無断アップロード、生徒を特定できる情報の外部送信を禁じます。"],
                ["第6条（保存期間）", "既定では学年度末＋1年で自動削除します。設定画面から短縮できます。"],
              ].map(([h, b]) => (
                <div key={h} style={{ marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, color: T.text, marginBottom: 3 }}>{h}</div>
                  <div>{b}</div>
                </div>
              ))}
            </div>
          </Modal>
        </Card>

        {/* 国際プライバシーポリシー */}
        <Card title="国際プライバシーポリシー" sub="GDPR / FERPA / COPPA / 個人情報保護法">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 11 }}>
            {["GDPR (EU)", "UK GDPR", "FERPA (US)", "COPPA (US)", "PIPL (中国)", "APPI (日本)", "PIPEDA (加)"].map((x) => (
              <Badge key={x} tone="accent">{x}</Badge>
            ))}
          </div>
          <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12.5, color: T.textSub, lineHeight: 1.85 }}>
            <li><b style={{ color: T.text }}>データ最小化</b>：生徒の実名は保存せず、匿名IDと出席番号のみを扱います。</li>
            <li><b style={{ color: T.text }}>保存場所</b>：既定は東京リージョン。EU圏の学校はフランクフルトを選択できます。</li>
            <li><b style={{ color: T.text }}>権利行使</b>：開示・訂正・削除・可搬性の請求に30日以内で対応します。</li>
            <li><b style={{ color: T.text }}>学習利用なし</b>：答案画像を生成AIの学習データに使用しません。</li>
            <li><b style={{ color: T.text }}>16歳未満</b>：保護者同意の記録を学校単位で管理します。</li>
          </ul>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn size="sm" onClick={() => { download("privacy-policy-v3.txt", "テスト採点ver.3 プライバシーポリシー（デモ）\n\n1. 収集する情報\n2. 利用目的\n3. 保存期間\n4. 第三者提供\n5. データ主体の権利\n"); toast("ポリシーを書き出しました"); }}>
              ポリシーを保存
            </Btn>
            <Btn size="sm" variant="soft" onClick={() => { download("dpa-request.txt", "データ処理契約(DPA)の請求フォーム（デモ）"); toast("DPA請求書を書き出しました"); }}>
              DPAを請求
            </Btn>
          </div>
        </Card>
      </div>

      <div style={{ ...grid(320, 14), marginBottom: 18 }}>
        {/* サブスクリプション */}
        <Card title="サブスクリプション" sub="現在のプラン：School（年間契約・2027/03/31まで）">
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.textSub, marginBottom: 5 }}>
              <span>今月の採点枚数</span><span style={{ fontWeight: 700, color: T.text }}>1,842 / 5,000 枚</span>
            </div>
            <Bar value={1842} max={5000} tone="accent" />
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {PLANS.map((p) => (
              <div key={p.id} style={{
                border: `1px solid ${p.id === "school" ? T.accent : T.line}`, borderRadius: 11, padding: 11,
                background: p.id === "school" ? T.accentSoft : T.panelAlt,
              }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>{p.name}</span>
                  <span style={{ font: `700 16px ${FONT_MONO}`, color: T.accent }}>{p.price}</span>
                  <span style={{ fontSize: 11, color: T.textSub }}>{p.per}</span>
                  <span style={{ flex: 1 }} />
                  <Btn size="sm" variant={p.id === "school" ? "soft" : "default"}
                    onClick={() => toast(p.id === "school" ? "現在ご利用中のプランです" : `${p.name} の申込画面を開きます（デモ）`)}>
                    {p.cta}
                  </Btn>
                </div>
                <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 5 }}>{p.quota}・{p.feats.join(" / ")}</div>
              </div>
            ))}
          </div>
          {/* PROD-API: Stripe Billing Portal へのリダイレクト */}
          <div style={{ fontSize: 11, color: T.textFaint, marginTop: 10 }}>請求書・支払い方法の変更はカスタマーポータルから行えます。</div>
        </Card>

        {/* 為替レート */}
        <Card title="リアルタイム為替レート" sub="海外校向け請求額の目安（3秒ごとに更新・参考値）">
          <div style={grid(140, 8)}>
            {fx.map((f) => (
              <div key={f.pair} style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 11px", background: T.panelAlt }}>
                <div style={{ fontSize: 11, color: T.textSub, fontWeight: 700 }}>{f.pair}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ font: `700 16px ${FONT_MONO}`, color: T.text }}>
                    {f.v < 1 ? f.v.toFixed(4) : f.v.toFixed(2)}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: f.d >= 0 ? T.ok : T.ng }}>
                    {f.d >= 0 ? "▲" : "▼"}{Math.abs(f.d).toFixed(3)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: T.textFaint, marginTop: 10 }}>
            {/* PROD-API: 為替APIに接続（例 exchangerate.host / OpenExchangeRates） */}
            デモでは擬似変動値を表示しています。本番では為替APIに接続します。
          </div>
        </Card>
      </div>

      <div style={{ ...grid(320, 14), marginBottom: 18 }}>
        {/* Q&A */}
        <Card title="よくある質問" sub="はじめての方はこちらから">
          <div style={{ display: "grid", gap: 6 }}>
            {QA.map((item, i) => (
              <div key={i} style={{ border: `1px solid ${T.line}`, borderRadius: 10, overflow: "hidden" }}>
                <button onClick={() => setOpenQA(openQA === i ? -1 : i)} style={{
                  width: "100%", textAlign: "start", padding: "10px 12px", background: openQA === i ? T.accentSoft : T.panelAlt,
                  border: "none", cursor: "pointer", font: `700 12.5px ${FONT_UI}`, color: T.text,
                  display: "flex", gap: 8, alignItems: "center",
                }}>
                  <span style={{ color: T.accent }}>Q</span>
                  <span style={{ flex: 1 }}>{item.q}</span>
                  <span style={{ color: T.textFaint }}>{openQA === i ? "－" : "＋"}</span>
                </button>
                {openQA === i && (
                  <div style={{ padding: "11px 12px", fontSize: 12.5, color: T.textSub, lineHeight: 1.85, background: T.panel }}>
                    {item.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* ユーザーの声 */}
        <Card title="ユーザーの声" sub="評価とシェア">
          <div style={{ display: "grid", gap: 9, marginBottom: 13 }}>
            {[
              { who: "中学校 数学科・2年担当", body: "40枚の答案が10分で下書き採点まで終わりました。記述は要確認だけ見ればよく、放課後の残業が実際に減りました。" },
              { who: "学習塾 教室長", body: "生徒がスマホで提出できるので、欠席者の答案回収がなくなりました。弱点分析をそのまま面談資料に使っています。" },
              { who: "特別支援教育担当", body: "実名が出ない設計なので、支援会議の資料に安心して出せます。" },
            ].map((v, i) => (
              <div key={i} style={{ border: `1px solid ${T.line}`, borderRadius: 11, padding: 11, background: T.panelAlt }}>
                <div style={{ fontSize: 12.5, color: T.text, lineHeight: 1.75 }}>{v.body}</div>
                <div style={{ fontSize: 11, color: T.textFaint, marginTop: 6 }}>— {v.who}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Btn size="sm" variant={voted === "good" ? "primary" : "default"}
              onClick={() => { if (voted !== "good") { setVotes((v) => ({ ...v, good: v.good + 1, bad: voted === "bad" ? v.bad - 1 : v.bad })); setVoted("good"); toast("評価ありがとうございます"); } }}>
              👍 グッド {votes.good.toLocaleString()}
            </Btn>
            <Btn size="sm" variant={voted === "bad" ? "danger" : "default"}
              onClick={() => { if (voted !== "bad") { setVotes((v) => ({ ...v, bad: v.bad + 1, good: voted === "good" ? v.good - 1 : v.good })); setVoted("bad"); toast("ご意見として記録しました", "warn"); } }}>
              👎 バッド {votes.bad.toLocaleString()}
            </Btn>
            <Btn size="sm" variant="soft" onClick={() => {
              const text = `テスト採点ver.3 — 答案画像をアップロードするだけで採点・添削・分析まで自動化`;
              if (navigator.share) navigator.share({ title: "テスト採点ver.3", text }).catch(() => {});
              else if (navigator.clipboard) { navigator.clipboard.writeText(text); toast("紹介文をコピーしました"); }
              else toast("共有に対応していない環境です", "warn");
            }}>
              ↗ 拡散する
            </Btn>
          </div>
        </Card>
      </div>

      {/* お問い合わせ */}
      <Card title="お問い合わせ" sub="カスタマーセンター">
        <div style={{ ...grid(260, 14) }}>
          <div>
            <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 2 }}>
              <div><b style={{ color: T.text }}>受付時間</b>　平日 9:00–18:00（日本時間）</div>
              <div><b style={{ color: T.text }}>電話</b>　0120-000-000（学校向け窓口）</div>
              <div><b style={{ color: T.text }}>メール</b>　support@example-grading.jp</div>
              <div><b style={{ color: T.text }}>緊急時</b>　管理画面の「障害情報」から状況を確認できます</div>
              <div><b style={{ color: T.text }}>導入相談</b>　教育委員会単位の説明会も承ります</div>
            </div>
          </div>
          <div>
            <Field label="お名前（担当者）"><Input value={contact.name} onChange={(v) => setContact({ ...contact, name: v })} placeholder="例：教務 担当" /></Field>
            <Field label="返信先メールアドレス"><Input value={contact.email} onChange={(v) => setContact({ ...contact, email: v })} placeholder="school@example.ed.jp" /></Field>
            <Field label="お問い合わせ内容" hint="生徒の実名は記入しないでください。">
              <textarea value={contact.body} onChange={(e) => setContact({ ...contact, body: e.target.value })}
                rows={4} style={{ ...inputStyle(T), resize: "vertical" }} placeholder="ご質問・ご要望をご記入ください" />
            </Field>
            <Btn variant="primary" full onClick={() => {
              if (!contact.email || !contact.body) { toast("メールアドレスと内容を入力してください", "warn"); return; }
              toast("お問い合わせを送信しました。2営業日以内に返信します");
              setContact({ name: "", email: "", body: "" });
            }}>送信する</Btn>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * 10. 新規採点（アップロード → 5ステップ自動処理）
 * -------------------------------------------------------------------------*/
const PIPELINE = [
  { k: "quality", n: 1, title: "画像品質確認", detail: "傾き・向き・明るさ・影・ぼやけ・見切れを検査し、自動トリミング／台形補正／傾き補正／コントラスト補正／ノイズ除去を適用します。" },
  { k: "test", n: 2, title: "テスト情報の抽出", detail: "教科・テスト名・学年・学期・実施日・試験番号・問題数・各設問の配点・満点・単元・記述欄の位置を読み取ります。" },
  { k: "student", n: 3, title: "生徒情報の認識", detail: "出席番号・学籍番号・クラス・受験番号を読み取り、匿名IDに置き換えます。実名は保存しません。同一生徒の複数ページを自動で束ねます。" },
  { k: "answer", n: 4, title: "解答内容の認識", detail: "数字・計算式・日本語・英語・選択肢・記号・図形・化学式・手書き文字・複数行回答を認識します。消しゴム跡や書き直しも可能な範囲で判定します。" },
  { k: "grade", n: 5, title: "全問の自動採点", detail: "採点基準に沿って正誤と部分点を判定し、赤ペン採点画像・弱点分析・フィードバックを生成します。" },
];

function PseudoQR({ seed = 7, size = 112 }) {
  const { T } = useUI();
  const cells = 21;
  const rnd = mulberry32(seed);
  const grid2 = [];
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    const finder =
      (x < 7 && y < 7) || (x > cells - 8 && y < 7) || (x < 7 && y > cells - 8);
    const on = finder
      ? (x % 6 === 0 || y % 6 === 0 || (x > 1 && x < 5 && y > 1 && y < 5) ||
         (x > cells - 6 && x < cells - 2 && y > 1 && y < 5) ||
         (x > 1 && x < 5 && y > cells - 6 && y < cells - 2))
      : rnd() > 0.55;
    if (on) grid2.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={T.text} />);
  }
  return (
    <svg viewBox={`0 0 ${cells} ${cells}`} width={size} height={size} style={{ background: "#fff", borderRadius: 6, padding: 4, border: `1px solid ${T.line}` }}>
      {grid2}
    </svg>
  );
}

function NewGrading() {
  const { T, go, addSubs, toast, anonMode } = useUI();
  const [stage, setStage] = useState("select");   // select | run | done
  const [files, setFiles] = useState([]);
  const [source, setSource] = useState("camera");
  const [testId, setTestId] = useState("t1");
  const [classId, setClassId] = useState("c1");
  const [drag, setDrag] = useState(false);
  const [demoBlank, setDemoBlank] = useState(false);
  const [demoIssue, setDemoIssue] = useState(false);
  const [step, setStep] = useState(-1);
  const [log, setLog] = useState([]);
  const [created, setCreated] = useState([]);
  const [showQR, setShowQR] = useState(false);
  const inputRef = useRef(null);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const test = testById(testId);
  const roster = STUDENTS.filter((s) => s.classId === classId);

  const addDemoFiles = (n, src) => {
    setSource(src);
    setFiles((prev) => {
      const start = prev.length;
      const add = Array.from({ length: n }, (_, i) => ({
        id: uid("f"),
        name: `answer_${String(start + i + 1).padStart(3, "0")}.${src === "pdf" ? "pdf" : src === "mobile" ? "heic" : "jpg"}`,
        kb: 800 + Math.floor(Math.random() * 2600),
        src,
      }));
      const next = [...prev, ...add].slice(0, 40);
      if (prev.length + add.length > 40) toast("一度にアップロードできるのは40枚までです", "warn");
      return next;
    });
  };

  const onPickFiles = (fileList) => {
    const arr = Array.from(fileList || []);
    if (!arr.length) return;
    setFiles((prev) => {
      const next = [
        ...prev,
        ...arr.map((f) => ({ id: uid("f"), name: f.name, kb: Math.max(1, Math.round(f.size / 1024)), src: "file" })),
      ].slice(0, 40);
      return next;
    });
    toast(`${arr.length} 件のファイルを追加しました`);
  };

  const run = () => {
    if (!files.length) { toast("答案画像を追加してください", "warn"); return; }
    setStage("run"); setStep(0); setLog([]);
    timers.current.forEach(clearTimeout); timers.current = [];
    const lines = [
      ["quality", `${files.length} 枚を検査 → 自動トリミング / 傾き補正 / コントラスト補正を適用`],
      ["quality", demoIssue ? "1 枚でぼやけと影を検出。再撮影の候補として記録しました" : "全ページが採点可能な品質です"],
      ["test", `${test.subject}「${test.name}」${test.grade}年 ${test.term} / 試験番号 ${test.testNo} を抽出`],
      ["test", `問題数 ${test.questions.length} 問・満点 ${test.maxScore} 点・単元 ${test.units.length} 種を確定`],
      ["student", `${classById(classId).label} の出席番号を読み取り、${anonMode ? "匿名ID" : "出席番号表示"}に変換`],
      ["student", "同一生徒の複数ページを自動で結合しました"],
      ["answer", "手書き文字・計算式・選択肢・記述を認識。消しゴム跡と書き直しを除外"],
      ["answer", demoBlank ? "1 枚が全問白紙と判定 → 採点をスキップし模範解答生成へ" : "全ページで解答を検出"],
      ["grade", `${files.length} 枚 × ${test.questions.length} 問の採点と部分点判定が完了`],
      ["grade", "赤ペン採点画像・弱点分析・フィードバックを生成しました"],
    ];
    PIPELINE.forEach((p, i) => {
      timers.current.push(setTimeout(() => {
        setStep(i);
        lines.filter((l) => l[0] === p.k).forEach((l, j) => {
          timers.current.push(setTimeout(() => setLog((prev) => [...prev, { t: p.title, m: l[1] }]), 340 + j * 320));
        });
      }, i * 1050));
    });
    timers.current.push(setTimeout(() => {
      const n = Math.min(files.length, roster.length);
      const made = [];
      for (let i = 0; i < n; i++) {
        const st = roster[i];
        const seed = 9000 + Math.floor(Math.random() * 9000) + i * 13;
        const forceBlank = demoBlank && i === 0;
        const quality = checkQuality(seed, demoIssue && i === 1);
        const result = gradeSubmission(test, st, seed, { forceBlank });
        const needReview = result.items.some((it) => it.needReview);
        made.push({
          id: uid("sub"), seq: 900 + i, testId, studentId: st.id, classId,
          source, pages: 1, uploadedAt: new Date().toISOString().slice(0, 19),
          quality, result,
          status: forceBlank ? "blank" : !quality.ok ? "quality" : needReview ? "review" : "done",
          edited: false, progress: 100, reviewedBy: "", isNew: true,
        });
      }
      setCreated(made);
      addSubs(made);
      setStep(PIPELINE.length);
      setStage("done");
      toast(`${made.length} 枚の採点が完了しました`);
    }, PIPELINE.length * 1050 + 900));
  };

  const reset = () => {
    timers.current.forEach(clearTimeout);
    setStage("select"); setFiles([]); setStep(-1); setLog([]); setCreated([]);
  };

  if (stage === "run" || stage === "done") {
    return (
      <div>
        <Section title={stage === "done" ? "採点が完了しました" : "AIエージェントが処理中です"}
          right={stage === "done" ? <Btn size="sm" onClick={reset}>続けて採点する</Btn> : null}>
          <div style={{ display: "grid", gap: 9 }}>
            {PIPELINE.map((p, i) => {
              const state = i < step ? "done" : i === step ? "run" : "wait";
              return (
                <div key={p.k} style={{
                  display: "flex", gap: 12, alignItems: "flex-start", padding: 13,
                  border: `1px solid ${state === "run" ? T.accent : T.line}`, borderRadius: 12,
                  background: state === "run" ? T.accentSoft : T.panel,
                  opacity: state === "wait" ? 0.5 : 1, transition: "all .3s",
                }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                    background: state === "done" ? T.ok : state === "run" ? T.accent : T.bgAlt,
                    color: state === "wait" ? T.textFaint : "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    font: `700 13px ${FONT_MONO}`,
                  }}>{state === "done" ? "✓" : p.n}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>
                      ステップ{p.n}：{p.title}
                      {state === "run" && <span style={{ marginInlineStart: 8, fontSize: 11, color: T.accent }}>処理中…</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 4, lineHeight: 1.7 }}>{p.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <Card title="処理ログ" style={{ marginBottom: 16 }}>
          <div style={{ font: `12px ${FONT_MONO}`, color: T.textSub, lineHeight: 1.9, maxHeight: 200, overflowY: "auto" }}>
            {log.length === 0 && <div style={{ color: T.textFaint }}>ログを待機しています…</div>}
            {log.map((l, i) => (
              <div key={i}><span style={{ color: T.accent }}>[{l.t}]</span> {l.m}</div>
            ))}
          </div>
        </Card>

        {stage === "done" && (
          <Card title={`採点結果 ${created.length} 件`} sub="行をタップすると赤ペン採点画像と分析を確認できます">
            <Table
              columns={[
                { key: "st", label: "受験者", render: (r) => {
                  const s = studentById(r.studentId);
                  return anonMode ? s.anonId : `${classById(r.classId).label} ${s.number}番`;
                } },
                { key: "score", label: "得点", align: "right", render: (r) => r.status === "blank" ? <Badge tone="warn">白紙</Badge> :
                  <span style={{ font: `700 13px ${FONT_MONO}` }}>{r.result.total}/{test.maxScore}</span> },
                { key: "rate", label: "得点率", align: "right", render: (r) => r.status === "blank" ? "—" : `${pct(r.result.total, test.maxScore)}%` },
                { key: "rv", label: "要確認", align: "center", render: (r) => {
                  const n = r.result.items.filter((i) => i.needReview).length;
                  return n ? <Badge tone="warn">{n} 問</Badge> : <Badge tone="ok">なし</Badge>;
                } },
                { key: "act", label: "", align: "right", render: (r) => <Btn size="sm" variant="soft" onClick={() => go("detail", r.id)}>開く</Btn> },
              ]}
              rows={created}
              onRow={(r) => go("detail", r.id)}
            />
          </Card>
        )}
      </div>
    );
  }

  return (
    <div>
      <Section title="1. 答案の取り込み方法を選ぶ">
        <div style={grid(180)}>
          {[
            { k: "camera", icon: "📷", t: "カメラで撮影", d: "撮影ガイド枠つき（教師用）", n: 5 },
            { k: "mobile", icon: "📱", t: "生徒モバイル提出", d: "リンク／QRを配って回収", n: 8 },
            { k: "mfp", icon: "🖨", t: "印刷機・コピー機", d: "複合機スキャンから自動取り込み", n: 12 },
            { k: "file", icon: "💻", t: "PCから選択", d: "JPEG / PNG / HEIC / PDF", n: 0 },
            { k: "pdf", icon: "📄", t: "PDF一括", d: "1ファイルに複数枚を格納", n: 10 },
          ].map((o) => (
            <button key={o.k}
              onClick={() => {
                if (o.k === "file") { inputRef.current && inputRef.current.click(); setSource("file"); }
                else if (o.k === "mobile") { setSource("mobile"); setShowQR(true); }
                else addDemoFiles(o.n, o.k);
              }}
              style={{
                textAlign: "start", background: source === o.k ? T.accentSoft : T.panel,
                border: `1px solid ${source === o.k ? T.accent : T.line}`, borderRadius: 13, padding: 14,
                cursor: "pointer", font: FONT_UI,
              }}>
              <div style={{ fontSize: 21, marginBottom: 6 }}>{o.icon}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{o.t}</div>
              <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 4, lineHeight: 1.6 }}>{o.d}</div>
            </button>
          ))}
        </div>
        <input ref={inputRef} type="file" multiple accept="image/*,.pdf,.heic"
          style={{ display: "none" }} onChange={(e) => { onPickFiles(e.target.files); e.target.value = ""; }} />
      </Section>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onPickFiles(e.dataTransfer.files); }}
        style={{
          border: `2px dashed ${drag ? T.accent : T.lineStrong}`, borderRadius: 14, padding: "26px 16px",
          textAlign: "center", background: drag ? T.accentSoft : T.panelAlt, marginBottom: 18, transition: "all .2s",
        }}>
        <div style={{ fontSize: 26, marginBottom: 7 }}>{drag ? "📥" : "🗂"}</div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>ここに答案画像をドラッグ＆ドロップ</div>
        <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 5, lineHeight: 1.7 }}>
          JPEG / PNG / HEIC / PDF に対応。一度に最大40枚まで。ページ抜けと重複は自動で検出します。
        </div>
        <div style={{ marginTop: 11, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <Btn size="sm" onClick={() => inputRef.current && inputRef.current.click()}>ファイルを選ぶ</Btn>
          <Btn size="sm" variant="soft" onClick={() => addDemoFiles(9, "camera")}>デモ答案を9枚入れる</Btn>
        </div>
      </div>

      <Modal open={showQR} onClose={() => setShowQR(false)} title="生徒モバイル提出リンク" width={520}
        footer={<><Btn onClick={() => { navigator.clipboard && navigator.clipboard.writeText("https://grade.example.jp/s/8F3K-92"); toast("リンクをコピーしました"); }}>リンクをコピー</Btn><Btn variant="primary" onClick={() => { addDemoFiles(8, "mobile"); setShowQR(false); toast("生徒から8枚の提出がありました"); }}>提出を受け取る（デモ）</Btn></>}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <PseudoQR seed={testId.length * 31 + 5} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ font: `700 13px ${FONT_MONO}`, color: T.text, marginBottom: 6 }}>https://grade.example.jp/s/8F3K-92</div>
            <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 12, color: T.textSub, lineHeight: 1.85 }}>
              <li>アプリのインストールは不要です。</li>
              <li>撮影ガイド枠に用紙を合わせると自動でシャッターが切れます。</li>
              <li>提出時に名前は入力させず、出席番号だけで受け付けます。</li>
              <li>リンクは実施日から72時間で失効します。</li>
            </ul>
          </div>
        </div>
      </Modal>

      <Section title={`2. 取り込んだ答案（${files.length} / 40 枚）`}
        right={files.length ? <Btn size="sm" variant="ghost" onClick={() => setFiles([])}>すべて外す</Btn> : null}>
        {files.length === 0 ? (
          <Card><Empty icon="📄" title="まだ答案がありません" hint="上の取り込み方法を選ぶか、デモ答案を入れて動作を試してください。" /></Card>
        ) : (
          <Card pad={12}>
            <div style={grid(150, 9)}>
              {files.map((f) => (
                <div key={f.id} style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: 9, background: T.panelAlt, position: "relative" }}>
                  <div style={{ height: 52, borderRadius: 7, background: T.bgAlt, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, marginBottom: 7 }}>
                    {SOURCES[f.src] ? SOURCES[f.src].icon : "🖼"}
                  </div>
                  <div style={{ fontSize: 11, color: T.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                  <div style={{ fontSize: 10.5, color: T.textFaint, marginTop: 2 }}>{f.kb.toLocaleString()} KB</div>
                  <button onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))}
                    style={{ position: "absolute", top: 5, insetInlineEnd: 5, border: "none", background: "transparent", color: T.textFaint, cursor: "pointer", fontSize: 13 }}>✕</button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </Section>

      <Section title="3. 採点の対象と条件">
        <Card>
          <div style={grid(220, 14)}>
            <Field label="対象のテスト">
              <Select value={testId} onChange={setTestId}
                options={TESTS.map((t) => ({ value: t.id, label: `${t.subject}／${t.name}（${t.grade}年）` }))} />
            </Field>
            <Field label="対象クラス" hint="出席番号は答案から自動で読み取ります。">
              <Select value={classId} onChange={setClassId}
                options={CLASSES.map((c) => ({ value: c.id, label: `${c.label}（${c.size}名）` }))} />
            </Field>
            <Field label="採点基準">
              <Select value="std" onChange={() => {}} options={[{ value: "std", label: "標準（部分点あり・記述は要点一致）" }]} />
            </Field>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 4 }}>
            <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12.5, color: T.textSub, cursor: "pointer" }}>
              <input type="checkbox" checked={demoBlank} onChange={(e) => setDemoBlank(e.target.checked)} />
              白紙答案を1枚混ぜる（模範解答の自動生成を試す）
            </label>
            <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12.5, color: T.textSub, cursor: "pointer" }}>
              <input type="checkbox" checked={demoIssue} onChange={(e) => setDemoIssue(e.target.checked)} />
              画質不良を1枚混ぜる（再撮影案内を試す）
            </label>
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
            <Btn variant="shu" size="lg" onClick={run} disabled={!files.length}>AI採点をはじめる</Btn>
            <span style={{ fontSize: 11.5, color: T.textFaint }}>
              {files.length ? `${Math.min(files.length, roster.length)} 名分・${test.questions.length} 問 × 満点 ${test.maxScore} 点` : "答案を追加すると開始できます"}
            </span>
          </div>
        </Card>
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * 11. 採点結果の詳細（赤ペン画像・修正・分析・フィードバック）
 * -------------------------------------------------------------------------*/
function Tabs({ tabs, value, onChange }) {
  const { T } = useUI();
  return (
    <div style={{ display: "flex", gap: 4, overflowX: "auto", borderBottom: `1px solid ${T.line}`, marginBottom: 16, paddingBottom: 1 }}>
      {tabs.map((tb) => (
        <button key={tb.k} onClick={() => onChange(tb.k)} style={{
          border: "none", background: "transparent", cursor: "pointer",
          padding: "9px 13px", font: `700 12.5px ${FONT_UI}`, whiteSpace: "nowrap",
          color: value === tb.k ? T.accent : T.textSub,
          borderBottom: `2px solid ${value === tb.k ? T.accent : "transparent"}`, marginBottom: -1,
        }}>
          {tb.label}{tb.badge != null && <span style={{ marginInlineStart: 6, fontSize: 10.5, color: T.shu, fontWeight: 700 }}>{tb.badge}</span>}
        </button>
      ))}
    </div>
  );
}

function GradingDetail({ subId }) {
  const { T, go, subs, updateSub, toast, anonMode } = useUI();
  const sub = subs.find((s) => s.id === subId);
  const [tab, setTab] = useState("sheet");
  const [page, setPage] = useState(0);
  const [showMarks, setShowMarks] = useState(true);
  const [showComments, setShowComments] = useState(true);
  const [editing, setEditing] = useState(null);
  const svgRef = useRef(null);

  const test = sub ? testById(sub.testId) : null;
  const st = sub ? studentById(sub.studentId) : null;
  const kl = sub ? classById(sub.classId) : null;
  const ana = useMemo(() => (sub ? analyze(test, sub.result) : null), [test, sub]);
  const fb = useMemo(() => (sub ? buildFeedback(test, sub.result, ana) : null), [test, sub, ana]);
  const modelAns = useMemo(() => (test ? buildModelAnswers(test) : []), [test]);

  if (!sub) return <Card><Empty icon="🔎" title="答案が見つかりません" hint="削除された可能性があります。" action={<Btn onClick={() => go("history")}>採点履歴に戻る</Btn>} /></Card>;

  const reviewCount = sub.result.items.filter((i) => i.needReview).length;
  const pages = Math.ceil(sub.result.items.length / 7);
  const who = anonMode ? st.anonId : `${kl.label} ${st.number}番`;

  const applyEdit = (qno, patch) => {
    const items = sub.result.items.map((it) => {
      if (it.qno !== qno) return it;
      const next = { ...it, ...patch };
      if (patch.mark) {
        next.earned = patch.mark === "○" ? it.points : patch.mark === "△" ? Math.max(1, Math.round(it.points / 2)) : 0;
        next.needReview = false;
      }
      if (patch.earned != null) next.earned = clamp(Number(patch.earned) || 0, 0, it.points);
      return next;
    });
    const total = items.reduce((a, i) => a + i.earned, 0);
    const needReview = items.some((i) => i.needReview);
    updateSub(sub.id, {
      result: { ...sub.result, items, total },
      edited: true,
      reviewedBy: "T.K",
      status: sub.status === "blank" ? "blank" : needReview ? "review" : "done",
    });
  };

  const exportSVG = () => {
    const node = svgRef.current;
    if (!node) { toast("赤ペン画像タブを開いてから書き出してください", "warn"); return; }
    const xml = new XMLSerializer().serializeToString(node);
    download(`redpen_${test.subject}_${st.anonId}_p${page + 1}.svg`, xml, "image/svg+xml;charset=utf-8");
    toast("赤ペン採点画像を書き出しました");
  };

  const exportRow = () => {
    const csv = toCSV(sub.result.items, [
      { label: "設問", get: (r) => r.label }, { label: "単元", key: "unit" }, { label: "形式", key: "typeLabel" },
      { label: "配点", key: "points" }, { label: "得点", key: "earned" }, { label: "判定", key: "mark" },
      { label: "認識信頼度", get: (r) => `${Math.round(r.confidence * 100)}%` },
      { label: "誤答傾向", key: "reason" }, { label: "コメント", key: "comment" },
    ]);
    download(`saiten_${test.subject}_${st.anonId}.csv`, csv, "text/csv;charset=utf-8");
    toast("設問別の採点結果をCSVで書き出しました");
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <Btn size="sm" variant="ghost" onClick={() => go("history")}>← 採点履歴</Btn>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ font: `700 17px ${FONT_UI}`, color: T.text }}>{test.subject}／{test.name}</div>
          <div style={{ fontSize: 12, color: T.textSub, marginTop: 3 }}>
            {who}・受験番号 {st.examNo}・{fmtDateTime(sub.uploadedAt)} 取り込み（{SOURCES[sub.source].label}）
          </div>
        </div>
        <div style={{ textAlign: "end" }}>
          <div style={{ font: `700 26px ${FONT_MONO}`, color: sub.status === "blank" ? T.warn : T.shu }}>
            {sub.status === "blank" ? "白紙" : `${sub.result.total}`}
            {sub.status !== "blank" && <span style={{ fontSize: 14, color: T.textSub }}>/{test.maxScore}</span>}
          </div>
          {sub.status !== "blank" && <div style={{ fontSize: 11.5, color: T.textSub }}>得点率 {fb.rate}%</div>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
        {sub.edited && <Badge tone="accent">教師修正あり</Badge>}
        {sub.reviewedBy && <Badge tone="ok">確認済 {sub.reviewedBy}</Badge>}
        {reviewCount > 0 && <Badge tone="warn">要確認 {reviewCount} 問</Badge>}
        {!sub.quality.ok && <Badge tone="ng">画質に注意</Badge>}
        {sub.status === "blank" && <Badge tone="warn">全問白紙 → 模範解答を生成</Badge>}
        <span style={{ flex: 1 }} />
        <Btn size="sm" onClick={exportRow}>CSV</Btn>
        <Btn size="sm" variant="soft" onClick={exportSVG}>赤ペン画像を保存</Btn>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { k: "sheet", label: "赤ペン採点画像" },
        { k: "items", label: "設問別採点", badge: reviewCount || null },
        { k: "quality", label: "画像品質" },
        { k: "analysis", label: "弱点分析" },
        { k: "feedback", label: "フィードバック" },
        ...(sub.status === "blank" ? [{ k: "model", label: "模範解答" }] : []),
      ]} />

      {tab === "sheet" && (
        <Card pad={0}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${T.line}`, flexWrap: "wrap", background: T.panelAlt }}>
            <Btn size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>◀</Btn>
            <span style={{ fontSize: 12, color: T.textSub, fontWeight: 700 }}>ページ {page + 1} / {pages}</span>
            <Btn size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>▶</Btn>
            <span style={{ flex: 1 }} />
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: T.textSub, cursor: "pointer" }}>
              <input type="checkbox" checked={showMarks} onChange={(e) => setShowMarks(e.target.checked)} />赤ペンを重ねる
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: T.textSub, cursor: "pointer" }}>
              <input type="checkbox" checked={showComments} onChange={(e) => setShowComments(e.target.checked)} />コメントを表示
            </label>
          </div>
          <div style={{ padding: 14, background: T.bgAlt }}>
            <RedPenSheet test={test} sub={sub} page={page} showMarks={showMarks} showComments={showComments} svgRef={svgRef} />
          </div>
          <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.line}`, fontSize: 11.5, color: T.textFaint, lineHeight: 1.7 }}>
            チェックを外すと元の答案（原本）だけを表示します。原本画像は採点後も削除されません。
          </div>
        </Card>
      )}

      {tab === "items" && (
        <Card title="設問別の採点結果" sub="判定・得点・コメントはその場で修正できます。修正は合計点と赤ペン画像に即時反映されます。">
          <div style={{ display: "grid", gap: 9 }}>
            {sub.result.items.map((it) => (
              <div key={it.qno} style={{
                border: `1px solid ${it.needReview ? T.warn : T.line}`, borderRadius: 12, padding: 12,
                background: it.needReview ? T.warnSoft : T.panelAlt,
              }}>
                <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ font: `700 13px ${FONT_UI}`, color: T.text }}>{it.label}</span>
                  <Badge tone="mute">{it.unit}</Badge>
                  <Badge tone="mute">{it.typeLabel}</Badge>
                  <Badge tone="mute">配点 {it.points}</Badge>
                  {it.needReview && <Badge tone="warn">要確認（信頼度 {Math.round(it.confidence * 100)}%）</Badge>}
                  <span style={{ flex: 1 }} />
                  <div style={{ display: "flex", gap: 4 }}>
                    {["○", "△", "×"].map((m) => (
                      <button key={m} onClick={() => applyEdit(it.qno, { mark: m })} style={{
                        width: 34, height: 30, borderRadius: 8, cursor: "pointer",
                        border: `1px solid ${it.mark === m ? T.shu : T.lineStrong}`,
                        background: it.mark === m ? T.shu : T.panel,
                        color: it.mark === m ? "#fff" : T.textSub, font: `700 14px ${FONT_UI}`,
                      }}>{m}</button>
                    ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <input type="number" min={0} max={it.points} value={it.earned}
                      onChange={(e) => applyEdit(it.qno, { earned: e.target.value })}
                      style={{ ...inputStyle(T), width: 62, padding: "6px 8px", textAlign: "center", font: `700 13px ${FONT_MONO}` }} />
                    <span style={{ fontSize: 12, color: T.textSub }}>点</span>
                  </div>
                </div>
                <div style={{ marginTop: 9, display: "grid", gap: 6, gridTemplateColumns: "minmax(0,1fr)" }}>
                  <div style={{ fontSize: 12.5, color: T.text, background: T.panel, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px" }}>
                    <span style={{ color: T.textFaint, fontSize: 11, marginInlineEnd: 6 }}>認識した解答</span>
                    <span style={{ font: `14px ${FONT_HAND}` }}>{it.blank ? "（無記入）" : it.detected}</span>
                  </div>
                  {editing === it.qno ? (
                    <div style={{ display: "flex", gap: 6 }}>
                      <input defaultValue={it.comment} id={`cm_${it.qno}`} style={{ ...inputStyle(T), flex: 1 }} placeholder="赤ペンコメント" />
                      <Btn size="sm" variant="primary" onClick={() => {
                        const el = document.getElementById(`cm_${it.qno}`);
                        applyEdit(it.qno, { comment: el ? el.value : it.comment });
                        setEditing(null); toast("コメントを更新しました");
                      }}>保存</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setEditing(null)}>取消</Btn>
                    </div>
                  ) : (
                    <div onClick={() => setEditing(it.qno)} style={{
                      fontSize: 12.5, color: it.comment ? T.shu : T.textFaint, cursor: "pointer",
                      border: `1px dashed ${T.lineStrong}`, borderRadius: 8, padding: "8px 10px", font: `12.5px ${FONT_HAND}`,
                    }}>
                      {it.comment || "コメントを追加する（クリック）"}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ font: `700 15px ${FONT_MONO}`, color: T.text }}>合計 {sub.result.total} / {test.maxScore} 点</div>
            <span style={{ flex: 1 }} />
            <Btn variant="primary" onClick={() => { updateSub(sub.id, { reviewedBy: "T.K", status: sub.status === "blank" ? "blank" : "done" }); toast("確認済みにしました。返却できます"); }}>
              確認済みにする
            </Btn>
          </div>
        </Card>
      )}

      {tab === "quality" && (
        <div style={grid(300, 14)}>
          <Card title="画像品質スコア" sub={`総合 ${sub.quality.avg} / 100`}>
            <div style={{ display: "grid", gap: 11 }}>
              {[
                ["tilt", "傾き・向き"], ["brightness", "明るさ"], ["blur", "ぼやけ"],
                ["shadow", "影・反射"], ["coverage", "見切れ（全体が写っているか）"], ["contrast", "コントラスト"],
              ].map(([k, label]) => {
                const v = sub.quality.scores[k];
                return (
                  <div key={k}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: T.textSub }}>{label}</span>
                      <span style={{ font: `700 12px ${FONT_MONO}`, color: v < 60 ? T.ng : v < 75 ? T.warn : T.ok }}>{v}</span>
                    </div>
                    <Bar value={v} tone={v < 60 ? "ng" : v < 75 ? "warn" : "ok"} height={7} />
                  </div>
                );
              })}
            </div>
          </Card>
          <Card title={sub.quality.ok ? "採点可能な品質です" : "再撮影・再スキャンの案内"} sub={sub.quality.ok ? "補正のみで処理しました" : "以下の点を直して取り込み直してください"}>
            {sub.quality.ok ? (
              <Empty icon="✅" title="問題は見つかりませんでした" hint="自動補正のみを適用して採点に進みました。" />
            ) : (
              <div style={{ display: "grid", gap: 9, marginBottom: 12 }}>
                {sub.quality.issues.map((is) => (
                  <div key={is.k} style={{ border: `1px solid ${T.ng}`, background: T.ngSoft, borderRadius: 10, padding: 11 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: T.ng, marginBottom: 3 }}>{is.k}</div>
                    <div style={{ fontSize: 12, color: T.text, lineHeight: 1.7 }}>{is.msg}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11.5, color: T.textSub, marginBottom: 8, fontWeight: 700 }}>適用した自動補正</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {sub.quality.fixes.map((f) => <Badge key={f} tone="info">{f}</Badge>)}
            </div>
            {!sub.quality.ok && (
              <Btn style={{ marginTop: 13 }} variant="shu" onClick={() => toast("再撮影の依頼を送りました（デモ）")}>再撮影を依頼する</Btn>
            )}
          </Card>
        </div>
      )}

      {tab === "analysis" && (
        <div>
          <div style={{ ...grid(300, 14), marginBottom: 14 }}>
            <Card title="単元別の定着度" sub="低い順に表示（優先して復習する単元）">
              <div style={{ display: "grid", gap: 11 }}>
                {ana.units.map((u) => (
                  <div key={u.unit}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: T.text, fontWeight: 600 }}>{u.unit}</span>
                      <span style={{ font: `700 12px ${FONT_MONO}`, color: u.rate < 50 ? T.ng : u.rate < 75 ? T.warn : T.ok }}>
                        {u.rate}% <span style={{ color: T.textFaint, fontWeight: 400 }}>({u.earned}/{u.points})</span>
                      </span>
                    </div>
                    <Bar value={u.rate} tone={u.rate < 50 ? "ng" : u.rate < 75 ? "warn" : "ok"} />
                  </div>
                ))}
              </div>
            </Card>
            <Card title="設問形式別の得点率" sub="解答の型が身についているかを見ます">
              <div style={{ display: "grid", gap: 11 }}>
                {ana.types.map((ty) => (
                  <div key={ty.type}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: T.text, fontWeight: 600 }}>{ty.type}（{ty.n}問）</span>
                      <span style={{ font: `700 12px ${FONT_MONO}`, color: ty.rate < 50 ? T.ng : ty.rate < 75 ? T.warn : T.ok }}>{ty.rate}%</span>
                    </div>
                    <Bar value={ty.rate} tone={ty.rate < 50 ? "ng" : ty.rate < 75 ? "warn" : "ok"} />
                  </div>
                ))}
              </div>
            </Card>
          </div>
          <Card title="ミスの傾向" sub="同じ種類のミスが繰り返されていないかを確認します">
            {ana.topMistakes.length === 0 ? (
              <Empty icon="🎯" title="目立つミスの傾向はありません" hint="全問正解、または誤答が散発的です。" />
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {ana.topMistakes.map((m) => (
                  <div key={m.reason} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ width: 34, textAlign: "center", font: `700 14px ${FONT_MONO}`, color: T.shu }}>{m.count}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, color: T.text, marginBottom: 3 }}>{m.reason}</div>
                      <Bar value={m.count} max={Math.max(...ana.topMistakes.map((x) => x.count))} tone="shu" height={6} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "feedback" && (
        <div style={grid(300, 14)}>
          <Card title="生徒向けフィードバック" sub="そのまま返却プリントに貼り付けられます"
            right={<Btn size="sm" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(fb.student.join("\n")); toast("フィードバックをコピーしました"); }}>コピー</Btn>}>
            <div style={{ fontSize: 13, color: T.text, lineHeight: 2 }}>
              {fb.student.map((s, i) => <p key={i} style={{ margin: "0 0 9px" }}>{s}</p>)}
            </div>
            <div style={{ marginTop: 10, borderTop: `1px solid ${T.line}`, paddingTop: 11 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: T.textSub, marginBottom: 7 }}>次にやること</div>
              <ol style={{ margin: 0, paddingInlineStart: 20, fontSize: 12.5, color: T.text, lineHeight: 1.9 }}>
                {fb.nextStep.map((n, i) => <li key={i}>{n}</li>)}
              </ol>
            </div>
          </Card>
          <Card title="教師向け指導提案" sub="次の授業設計に使える観点"
            right={<Btn size="sm" onClick={() => { download(`shido_${st.anonId}.txt`, fb.teacher.join("\n")); toast("指導提案を書き出しました"); }}>保存</Btn>}>
            <div style={{ fontSize: 13, color: T.text, lineHeight: 2 }}>
              {fb.teacher.map((s, i) => <p key={i} style={{ margin: "0 0 9px" }}>{s}</p>)}
            </div>
            <div style={{ marginTop: 10, borderTop: `1px solid ${T.line}`, paddingTop: 11, fontSize: 11.5, color: T.textFaint, lineHeight: 1.7 }}>
              {/* PROD-API: 文面は生成AIで学級・単元の文脈に合わせて再生成する */}
              文面はテンプレートとAI生成の組み合わせです。返却前に内容をご確認ください。
            </div>
          </Card>
        </div>
      )}

      {tab === "model" && (
        <Card title="模範解答（自動生成）" sub="全問白紙と判定されたため、採点をスキップして模範解答と解説を生成しました"
          right={<Btn size="sm" onClick={() => {
            const csv = toCSV(modelAns, [
              { label: "設問", key: "label" }, { label: "単元", key: "unit" }, { label: "配点", key: "points" },
              { label: "解答", key: "answer" }, { label: "解説", key: "solution" }, { label: "キーワード", get: (r) => r.keywords.join(" / ") },
            ]);
            download(`mohan_${test.subject}_${test.name}.csv`, csv, "text/csv;charset=utf-8");
            toast("模範解答を書き出しました");
          }}>CSVで保存</Btn>}>
          <div style={{ display: "grid", gap: 9 }}>
            {modelAns.map((m) => (
              <div key={m.qno} style={{ border: `1px solid ${T.line}`, borderRadius: 11, padding: 12, background: T.panelAlt }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 7 }}>
                  <span style={{ font: `700 13px ${FONT_UI}`, color: T.text }}>{m.label}</span>
                  <Badge tone="mute">{m.unit}</Badge>
                  <Badge tone="accent">{m.points}点</Badge>
                </div>
                <div style={{ fontSize: 13, color: T.shu, font: `14px ${FONT_HAND}`, marginBottom: 6 }}>解答：{m.answer}</div>
                <div style={{ fontSize: 12.5, color: T.textSub, lineHeight: 1.8 }}>{m.solution}</div>
                <div style={{ display: "flex", gap: 5, marginTop: 7, flexWrap: "wrap" }}>
                  {m.keywords.map((k) => <Badge key={k} tone="info">{k}</Badge>)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * 12. 採点履歴 / 採点中
 * -------------------------------------------------------------------------*/
const STATUS_META = {
  done: { label: "採点済", tone: "ok" },
  review: { label: "要確認", tone: "warn" },
  quality: { label: "画質注意", tone: "ng" },
  blank: { label: "白紙", tone: "mute" },
  processing: { label: "採点中", tone: "info" },
};

function History() {
  const { T, go, subs, toast, anonMode } = useUI();
  const [fTest, setFTest] = useState("all");
  const [fClass, setFClass] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [q, setQ] = useState("");

  const rows = subs.filter((s) => {
    if (s.status === "processing") return false;
    if (fTest !== "all" && s.testId !== fTest) return false;
    if (fClass !== "all" && s.classId !== fClass) return false;
    if (fStatus !== "all" && s.status !== fStatus) return false;
    if (q) {
      const st = studentById(s.studentId);
      const hay = `${st.anonId} ${st.examNo} ${st.number} ${st.initials} ${classById(s.classId).label} ${testById(s.testId).name}`;
      if (!hay.toLowerCase().includes(q.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));

  const exportAll = (kind) => {
    if (kind === "json") {
      download("saiten_history.json", JSON.stringify(rows.map((r) => ({
        test: testById(r.testId).name, subject: testById(r.testId).subject,
        class: classById(r.classId).label, student: studentById(r.studentId).anonId,
        examNo: studentById(r.studentId).examNo,
        total: r.result.total, max: testById(r.testId).maxScore,
        status: r.status, uploadedAt: r.uploadedAt,
        items: r.result.items.map((i) => ({ q: i.label, mark: i.mark, earned: i.earned, points: i.points, unit: i.unit })),
      })), null, 2), "application/json");
    } else {
      download("saiten_history.csv", toCSV(rows, [
        { label: "取込日時", get: (r) => fmtDateTime(r.uploadedAt) },
        { label: "教科", get: (r) => testById(r.testId).subject },
        { label: "テスト", get: (r) => testById(r.testId).name },
        { label: "クラス", get: (r) => classById(r.classId).label },
        { label: "出席番号", get: (r) => studentById(r.studentId).number },
        { label: "受験番号", get: (r) => studentById(r.studentId).examNo },
        { label: "匿名ID", get: (r) => studentById(r.studentId).anonId },
        { label: "得点", get: (r) => r.result.total },
        { label: "満点", get: (r) => testById(r.testId).maxScore },
        { label: "得点率", get: (r) => pct(r.result.total, testById(r.testId).maxScore) },
        { label: "状態", get: (r) => STATUS_META[r.status].label },
        { label: "取込方法", get: (r) => SOURCES[r.source].label },
      ]), "text/csv;charset=utf-8");
    }
    toast(`${rows.length} 件を書き出しました`);
  };

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={grid(150, 10)}>
          <Field label="テスト"><Select value={fTest} onChange={setFTest}
            options={[{ value: "all", label: "すべて" }, ...TESTS.map((t) => ({ value: t.id, label: `${t.subject}／${t.name}` }))]} /></Field>
          <Field label="クラス"><Select value={fClass} onChange={setFClass}
            options={[{ value: "all", label: "すべて" }, ...CLASSES.map((c) => ({ value: c.id, label: c.label }))]} /></Field>
          <Field label="状態"><Select value={fStatus} onChange={setFStatus}
            options={[{ value: "all", label: "すべて" }, ...Object.entries(STATUS_META).filter(([k]) => k !== "processing").map(([k, v]) => ({ value: k, label: v.label }))]} /></Field>
          <Field label="検索"><Input value={q} onChange={setQ} placeholder="匿名ID・受験番号など" /></Field>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn size="sm" onClick={() => exportAll("csv")}>CSVを書き出す</Btn>
          <Btn size="sm" onClick={() => exportAll("json")}>JSONを書き出す</Btn>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: T.textSub, alignSelf: "center" }}>{rows.length} 件</span>
        </div>
      </Card>

      <Card pad={0}>
        <Table
          onRow={(r) => go("detail", r.id)}
          empty="条件に合う答案がありません"
          columns={[
            { key: "d", label: "取込", render: (r) => <span style={{ fontSize: 12, color: T.textSub }}>{fmtDateTime(r.uploadedAt)}</span> },
            { key: "t", label: "テスト", render: (r) => <span>{testById(r.testId).subject}／{testById(r.testId).name}</span> },
            { key: "s", label: "受験者", render: (r) => {
              const st = studentById(r.studentId);
              return anonMode ? st.anonId : `${classById(r.classId).label} ${st.number}番`;
            } },
            { key: "sc", label: "得点", align: "right", render: (r) => r.status === "blank" ? "—" :
              <span style={{ font: `700 13px ${FONT_MONO}` }}>{r.result.total}<span style={{ color: T.textFaint, fontWeight: 400 }}>/{testById(r.testId).maxScore}</span></span> },
            { key: "rt", label: "得点率", align: "right", render: (r) => r.status === "blank" ? "—" : `${pct(r.result.total, testById(r.testId).maxScore)}%` },
            { key: "st", label: "状態", align: "center", render: (r) => <Badge tone={STATUS_META[r.status].tone}>{STATUS_META[r.status].label}</Badge> },
            { key: "src", label: "取込方法", render: (r) => <span style={{ fontSize: 12, color: T.textSub }}>{SOURCES[r.source].icon} {SOURCES[r.source].label}</span> },
            { key: "act", label: "", align: "right", render: (r) => <Btn size="sm" variant="soft" onClick={() => go("detail", r.id)}>開く</Btn> },
          ]}
          rows={rows}
        />
      </Card>
    </div>
  );
}

function Processing() {
  const { T, go, subs, setSubs, updateSub, toast } = useUI();
  const list = subs.filter((s) => s.status === "processing");
  const active = list.length > 0;

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setSubs((prev) =>
        prev.map((s) => {
          if (s.status !== "processing") return s;
          const next = Math.min(100, s.progress + 3 + Math.random() * 6);
          if (next >= 100) {
            const needReview = s.result.items.some((i) => i.needReview);
            return { ...s, progress: 100, status: needReview ? "review" : "done" };
          }
          return { ...s, progress: next };
        })
      );
    }, 1400);
    return () => clearInterval(id);
  }, [active, setSubs]);

  if (!list.length) {
    return <Card><Empty icon="✅" title="処理中の答案はありません" hint="取り込んだ答案はすべて採点が終わっています。"
      action={<Btn variant="primary" onClick={() => go("new")}>新しく採点する</Btn>} /></Card>;
  }
  return (
    <div style={{ display: "grid", gap: 11 }}>
      {list.map((s) => {
        const test = testById(s.testId);
        const st = studentById(s.studentId);
        const stageIdx = Math.min(PIPELINE.length - 1, Math.floor((s.progress / 100) * PIPELINE.length));
        return (
          <Card key={s.id}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 9 }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text }}>{test.subject}／{test.name}</div>
                <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 3 }}>{st.anonId}・{SOURCES[s.source].label}</div>
              </div>
              <Badge tone="info">ステップ{PIPELINE[stageIdx].n}：{PIPELINE[stageIdx].title}</Badge>
              <span style={{ font: `700 14px ${FONT_MONO}`, color: T.accent }}>{Math.round(s.progress)}%</span>
            </div>
            <Bar value={s.progress} tone="accent" />
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <Btn size="sm" onClick={() => { updateSub(s.id, { progress: 100, status: s.result.items.some((i) => i.needReview) ? "review" : "done" }); toast("採点を完了しました"); }}>すぐに完了する</Btn>
              <Btn size="sm" variant="ghost" onClick={() => go("detail", s.id)}>途中経過を見る</Btn>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * 13. テスト管理 / 模範解答管理 / 採点基準管理
 * -------------------------------------------------------------------------*/
function TestsView() {
  const { T, subs, toast } = useUI();
  const [open, setOpen] = useState(null);
  const test = open ? testById(open) : null;

  return (
    <div>
      <div style={grid(280, 13)}>
        {TESTS.map((t) => {
          const mine = subs.filter((s) => s.testId === t.id && s.status !== "processing" && s.status !== "blank");
          const avg = mine.length ? Math.round(mine.reduce((a, s) => a + s.result.total, 0) / mine.length) : 0;
          return (
            <Card key={t.id} title={`${t.subject}／${t.name}`} sub={`${t.grade}年 ${t.term}・実施 ${fmtDate(t.date)}`}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 11 }}>
                <Badge tone="accent">試験番号 {t.testNo}</Badge>
                <Badge tone="mute">{t.questions.length}問</Badge>
                <Badge tone="mute">満点 {t.maxScore}</Badge>
                <Badge tone="mute">大問 {t.bigCount}</Badge>
              </div>
              <div style={{ fontSize: 11.5, color: T.textSub, marginBottom: 5, fontWeight: 700 }}>単元</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 12 }}>
                {t.units.map((u) => <Badge key={u} tone="info">{u}</Badge>)}
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                <Stat label="採点済" value={mine.length} unit="枚" tone="accent" />
                <Stat label="平均点" value={avg} unit={`/${t.maxScore}`} tone="ok" />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn size="sm" variant="soft" onClick={() => setOpen(t.id)}>設問と配点を見る</Btn>
                <Btn size="sm" onClick={() => {
                  download(`test_${t.subject}_${t.name}.csv`, toCSV(t.questions, [
                    { label: "設問", key: "label" }, { label: "番号", key: "no" }, { label: "単元", key: "unit" },
                    { label: "形式", key: "typeLabel" }, { label: "難易度", key: "difficulty" },
                    { label: "配点", key: "points" }, { label: "正答", key: "correct" },
                  ]), "text/csv;charset=utf-8");
                  toast("設問一覧を書き出しました");
                }}>CSV</Btn>
              </div>
            </Card>
          );
        })}
      </div>

      <Modal open={!!test} onClose={() => setOpen(null)} width={860}
        title={test ? `${test.subject}／${test.name} の設問構成` : ""}>
        {test && (
          <>
            <div style={{ ...grid(120, 9), marginBottom: 14 }}>
              <Stat label="問題数" value={test.questions.length} unit="問" />
              <Stat label="満点" value={test.maxScore} unit="点" tone="shu" />
              <Stat label="大問数" value={test.bigCount} unit="問" tone="info" />
              <Stat label="単元数" value={test.units.length} unit="種" tone="ok" />
            </div>
            <Table
              columns={[
                { key: "label", label: "設問" },
                { key: "unit", label: "単元" },
                { key: "typeLabel", label: "形式" },
                { key: "difficulty", label: "難易度", render: (r) => <Badge tone={r.difficulty === "難" ? "ng" : r.difficulty === "標準" ? "warn" : "ok"}>{r.difficulty}</Badge> },
                { key: "points", label: "配点", align: "right" },
                { key: "correct", label: "正答", wrap: true },
              ]}
              rows={test.questions.map((q) => ({ ...q, id: `q${q.no}` }))}
              maxHeight={340}
            />
          </>
        )}
      </Modal>
    </div>
  );
}

function ModelAnswersView() {
  const { T, toast } = useUI();
  const [testId, setTestId] = useState("t1");
  const [gen, setGen] = useState(false);
  const test = testById(testId);
  const list = useMemo(() => buildModelAnswers(test), [test, gen]);

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <Field label="テストを選ぶ">
              <Select value={testId} onChange={setTestId}
                options={TESTS.map((t) => ({ value: t.id, label: `${t.subject}／${t.name}（${t.grade}年 ${t.term}）` }))} />
            </Field>
          </div>
          <Btn variant="primary" onClick={() => { setGen((g) => !g); toast("模範解答を再生成しました"); }}>再生成する</Btn>
          <Btn onClick={() => {
            download(`mohan_${test.subject}.csv`, toCSV(list, [
              { label: "設問", key: "label" }, { label: "単元", key: "unit" }, { label: "配点", key: "points" },
              { label: "解答", key: "answer" }, { label: "解説", key: "solution" },
            ]), "text/csv;charset=utf-8");
            toast("模範解答を書き出しました");
          }}>CSVで保存</Btn>
        </div>
        <div style={{ fontSize: 11.5, color: T.textFaint, lineHeight: 1.7 }}>
          {/* PROD-API: 模範解答と解説の生成をClaude APIに委譲 */}
          白紙答案を検出したときは、この模範解答が自動で生成され、生徒への配布資料として使えます。
        </div>
      </Card>
      <div style={grid(300, 12)}>
        {list.map((m) => (
          <Card key={m.qno} pad={13}>
            <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{ font: `700 13px ${FONT_UI}`, color: T.text }}>{m.label}</span>
              <Badge tone="mute">{m.unit}</Badge>
              <Badge tone="accent">{m.points}点</Badge>
            </div>
            <div style={{ font: `15px ${FONT_HAND}`, color: T.shu, marginBottom: 7 }}>{m.answer}</div>
            <div style={{ fontSize: 12, color: T.textSub, lineHeight: 1.8 }}>{m.solution}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function RSlider({ label, k, min, max, step = 1, unit, hint, R, set }) {
  const { T } = useUI();
  return (
    <div style={{ marginBottom: 15 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{label}</span>
        <span style={{ font: `700 13px ${FONT_MONO}`, color: T.accent }}>{R[k]}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={R[k]}
        onChange={(e) => set(k, Number(e.target.value))}
        style={{ width: "100%", accentColor: T.accent }} />
      {hint && <div style={{ fontSize: 11, color: T.textFaint, marginTop: 4, lineHeight: 1.6 }}>{hint}</div>}
    </div>
  );
}

function RToggle({ label, k, hint, R, set }) {
  const { T } = useUI();
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderBottom: `1px solid ${T.line}`, cursor: "pointer" }}>
      <input type="checkbox" checked={!!R[k]} onChange={(e) => set(k, e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: T.text, display: "block" }}>{label}</span>
        {hint && <span style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.7 }}>{hint}</span>}
      </span>
    </label>
  );
}

function RubricView() {
  const { rubric, setRubric, toast } = useUI();
  const R = rubric;
  const set = (k, v) => setRubric({ ...R, [k]: v });

  return (
    <div style={grid(320, 14)}>
      <Card title="採点のきびしさ" sub="記述問題の判定に使うしきい値">
        <RSlider R={R} set={set} label="要点一致率のしきい値" k="matchRate" min={40} max={100} unit="%"
          hint="模範解答の要点をこの割合以上満たしたら正解にします。下げると部分点が出やすくなります。" />
        <RSlider R={R} set={set} label="部分点の刻み" k="partialStep" min={1} max={4} unit=" 段階"
          hint="1段階＝○×のみ。3段階＝○／△（半分）／×。" />
        <RSlider R={R} set={set} label="要確認に回す信頼度" k="reviewThreshold" min={50} max={95} unit="%"
          hint="認識信頼度がこの値を下回る設問は、自動で「要確認一覧」に送られます。" />
      </Card>

      <Card title="表記の扱い" sub="どこまでを正解として認めるか">
        <RToggle R={R} set={set} label="漢字・かなの表記ゆれを許容する" k="allowKana" hint="例：「保存される」と「ほぞんされる」を同じ扱いにします。" />
        <RToggle R={R} set={set} label="英語のスペルミスを部分点にする" k="allowSpell" hint="1文字違いまでは△として扱います。" />
        <RToggle R={R} set={set} label="単位の書き忘れを減点にとどめる" k="unitPartial" hint="数値が合っていれば配点の半分を与えます。" />
        <RToggle R={R} set={set} label="途中式が正しければ部分点を与える" k="workPartial" hint="最終解が誤りでも立式が正しい場合に加点します。" />
        <RToggle R={R} set={set} label="大文字・小文字を区別する" k="caseSensitive" />
        <RToggle R={R} set={set} label="解答欄外の記入も採点対象にする" k="outsideBox" hint="欄からはみ出した記述も認識して採点します。" />
      </Card>

      <Card title="運用ルール" sub="返却前のチェック体制">
        <RToggle R={R} set={set} label="記述問題は必ず教師確認を必須にする" k="requireTeacher" hint="確認するまで返却済みにできません。" />
        <RToggle R={R} set={set} label="全問白紙のとき模範解答を自動生成する" k="autoModel" />
        <RToggle R={R} set={set} label="画質不良の答案は採点せず再撮影を依頼する" k="strictQuality" />
        <RToggle R={R} set={set} label="満点の答案にも一言コメントを付ける" k="praiseFull" />
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <Btn variant="primary" onClick={() => toast("採点基準を保存しました")}>基準を保存</Btn>
          <Btn onClick={() => { setRubric(DEFAULT_RUBRIC); toast("初期設定に戻しました", "warn"); }}>初期設定に戻す</Btn>
        </div>
      </Card>
    </div>
  );
}

const DEFAULT_RUBRIC = {
  matchRate: 70, partialStep: 3, reviewThreshold: 72,
  allowKana: true, allowSpell: true, unitPartial: true, workPartial: true,
  caseSensitive: false, outsideBox: true,
  requireTeacher: true, autoModel: true, strictQuality: false, praiseFull: true,
};

/* ---------------------------------------------------------------------------
 * 14. 生徒管理 / クラス管理 / 成績一覧
 * -------------------------------------------------------------------------*/
function studentStats(subs, studentId) {
  const mine = subs.filter((s) => s.studentId === studentId && s.status !== "processing" && s.status !== "blank");
  if (!mine.length) return { n: 0, avg: 0, last: null };
  const rates = mine.map((s) => pct(s.result.total, testById(s.testId).maxScore));
  return {
    n: mine.length,
    avg: Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10,
    last: mine.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1))[0],
  };
}

function StudentsView() {
  const { T, go, subs, toast, anonMode } = useUI();
  const [fClass, setFClass] = useState("all");
  const [q, setQ] = useState("");

  const rows = STUDENTS
    .filter((s) => (fClass === "all" || s.classId === fClass))
    .filter((s) => !q || `${s.anonId}${s.examNo}${s.initials}${s.number}`.toLowerCase().includes(q.toLowerCase()))
    .map((s) => ({ ...s, stats: studentStats(subs, s.id) }));

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ background: T.infoSoft, border: `1px solid ${T.info}`, borderRadius: 10, padding: 11, marginBottom: 13 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: T.info, marginBottom: 4 }}>個人情報保護の設計</div>
          <div style={{ fontSize: 12, color: T.text, lineHeight: 1.8 }}>
            生徒の実名は読み取れても保存しません。表示は「学年＋クラス＋出席番号」「受験番号」「イニシャル」「匿名ID」の4通りから選べます。
            匿名モードでは匿名IDだけを表示します。
          </div>
        </div>
        <div style={grid(170, 10)}>
          <Field label="クラス"><Select value={fClass} onChange={setFClass}
            options={[{ value: "all", label: "すべて" }, ...CLASSES.map((c) => ({ value: c.id, label: c.label }))]} /></Field>
          <Field label="検索"><Input value={q} onChange={setQ} placeholder="匿名ID・受験番号・イニシャル" /></Field>
        </div>
        <Btn size="sm" onClick={() => {
          download("students.csv", toCSV(rows, [
            { label: "クラス", get: (r) => classById(r.classId).label },
            { label: "出席番号", key: "number" }, { label: "受験番号", key: "examNo" },
            { label: "匿名ID", key: "anonId" }, { label: "イニシャル", key: "initials" },
            { label: "採点枚数", get: (r) => r.stats.n }, { label: "平均得点率", get: (r) => r.stats.avg },
            { label: "配慮事項", key: "note" },
          ]), "text/csv;charset=utf-8");
          toast("生徒一覧を書き出しました（実名は含まれません）");
        }}>CSVを書き出す</Btn>
      </Card>

      <Card pad={0}>
        <Table
          empty="該当する生徒がいません"
          columns={[
            { key: "cl", label: "クラス", render: (r) => classById(r.classId).label },
            { key: "no", label: "表示名", render: (r) => (
              <span style={{ fontWeight: 700 }}>{anonMode ? r.anonId : `${r.number}番`}</span>
            ) },
            { key: "ex", label: "受験番号", render: (r) => <span style={{ font: `12px ${FONT_MONO}`, color: T.textSub }}>{r.examNo}</span> },
            { key: "ini", label: "イニシャル", render: (r) => <span style={{ color: T.textSub }}>{r.initials}</span> },
            { key: "n", label: "採点枚数", align: "right", render: (r) => r.stats.n },
            { key: "avg", label: "平均得点率", align: "right", render: (r) => r.stats.n ? (
              <span style={{ font: `700 12.5px ${FONT_MONO}`, color: r.stats.avg < 50 ? T.ng : r.stats.avg < 75 ? T.warn : T.ok }}>{r.stats.avg}%</span>
            ) : "—" },
            { key: "sp", label: "配慮", render: (r) => r.support ? <Badge tone="info">特別支援</Badge> : r.note ? <Badge tone="mute">{r.note}</Badge> : "" },
            { key: "act", label: "", align: "right", render: (r) => r.stats.last ?
              <Btn size="sm" variant="soft" onClick={() => go("detail", r.stats.last.id)}>最新の答案</Btn> : "" },
          ]}
          rows={rows}
        />
      </Card>
    </div>
  );
}

function ClassesView() {
  const { T, go, subs } = useUI();
  return (
    <div style={grid(300, 13)}>
      {CLASSES.map((c) => {
        const mine = subs.filter((s) => s.classId === c.id && s.status !== "processing" && s.status !== "blank");
        const rates = mine.map((s) => pct(s.result.total, testById(s.testId).maxScore));
        const avg = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10 : 0;
        const top = rates.length ? Math.max(...rates) : 0;
        const low = rates.length ? Math.min(...rates) : 0;
        const dist = [0, 0, 0, 0, 0];
        rates.forEach((r) => dist[clamp(Math.floor(r / 20), 0, 4)]++);
        const maxD = Math.max(1, ...dist);
        return (
          <Card key={c.id} title={c.label} sub={`${c.size}名・${c.teacher}`}>
            <div style={{ ...grid(90, 8), marginBottom: 13 }}>
              <Stat label="平均" value={avg} unit="%" tone="accent" />
              <Stat label="最高" value={top} unit="%" tone="ok" />
              <Stat label="最低" value={low} unit="%" tone="ng" />
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: T.textSub, marginBottom: 7 }}>得点率の分布</div>
            <div style={{ display: "flex", gap: 5, alignItems: "flex-end", height: 74, marginBottom: 7 }}>
              {dist.map((d, i) => (
                <div key={i} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{
                    height: `${(d / maxD) * 58}px`, background: i < 2 ? T.ng : i < 3 ? T.warn : T.ok,
                    borderRadius: "5px 5px 0 0", minHeight: d ? 4 : 0, transition: "height .4s",
                  }} />
                  <div style={{ fontSize: 9.5, color: T.textFaint, marginTop: 4 }}>{i * 20}–{i * 20 + 19}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11.5, color: T.textSub, marginBottom: 11 }}>採点済み {mine.length} 枚</div>
            <Btn size="sm" variant="soft" onClick={() => go("scores")}>成績一覧で見る</Btn>
          </Card>
        );
      })}
    </div>
  );
}

function ScoresView() {
  const { T, go, subs, toast, anonMode } = useUI();
  const [classId, setClassId] = useState("c1");
  const roster = STUDENTS.filter((s) => s.classId === classId);
  const tests = TESTS.filter((t) => subs.some((s) => s.classId === classId && s.testId === t.id));

  const cell = (studentId, testId) =>
    subs.find((s) => s.studentId === studentId && s.testId === testId);

  const rows = roster.map((st) => {
    const row = { id: st.id, st };
    tests.forEach((t) => { row[t.id] = cell(st.id, t.id); });
    const vals = tests.map((t) => row[t.id]).filter((s) => s && s.status !== "processing" && s.status !== "blank");
    row.avg = vals.length ? Math.round(vals.reduce((a, s) => a + pct(s.result.total, testById(s.testId).maxScore), 0) / vals.length * 10) / 10 : null;
    return row;
  });

  const classAvg = (t) => {
    const vals = roster.map((st) => cell(st.id, t.id)).filter((s) => s && s.status !== "processing" && s.status !== "blank");
    return vals.length ? Math.round(vals.reduce((a, s) => a + s.result.total, 0) / vals.length * 10) / 10 : null;
  };

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 190, flex: 1 }}>
            <Field label="クラス"><Select value={classId} onChange={setClassId}
              options={CLASSES.map((c) => ({ value: c.id, label: `${c.label}（${c.size}名）` }))} /></Field>
          </div>
          <Btn onClick={() => {
            const headers = [
              { label: "表示名", get: (r) => anonMode ? r.st.anonId : `${r.st.number}番` },
              { label: "受験番号", get: (r) => r.st.examNo },
              ...tests.map((t) => ({ label: `${t.subject}${t.name}`, get: (r) => (r[t.id] && r[t.id].status !== "blank" ? r[t.id].result.total : "") })),
              { label: "平均得点率", get: (r) => (r.avg == null ? "" : r.avg) },
            ];
            download(`seiseki_${classById(classId).label}.csv`, toCSV(rows, headers), "text/csv;charset=utf-8");
            toast("成績一覧を書き出しました");
          }}>CSVを書き出す</Btn>
        </div>
      </Card>

      <Card pad={0} title={`${classById(classId).label} の成績一覧`} sub="セルをタップすると答案を開きます">
        {tests.length === 0 ? (
          <Empty icon="📋" title="このクラスの採点結果がありません" hint="新規採点から答案を取り込んでください。"
            action={<Btn variant="primary" onClick={() => go("new")}>新規採点へ</Btn>} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", font: `13px ${FONT_UI}`, minWidth: 420 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "start", padding: "9px 10px", fontSize: 11, color: T.textSub, borderBottom: `1px solid ${T.lineStrong}`, position: "sticky", insetInlineStart: 0, background: T.panel }}>受験者</th>
                  {tests.map((t) => (
                    <th key={t.id} style={{ padding: "9px 10px", fontSize: 11, color: T.textSub, borderBottom: `1px solid ${T.lineStrong}`, whiteSpace: "nowrap" }}>
                      {t.subject}<br /><span style={{ fontWeight: 400, fontSize: 10 }}>満点{t.maxScore}</span>
                    </th>
                  ))}
                  <th style={{ padding: "9px 10px", fontSize: 11, color: T.textSub, borderBottom: `1px solid ${T.lineStrong}` }}>平均</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} style={{ background: i % 2 ? T.panelAlt : "transparent" }}>
                    <td style={{ padding: "9px 10px", borderBottom: `1px solid ${T.line}`, fontWeight: 700, color: T.text, whiteSpace: "nowrap", position: "sticky", insetInlineStart: 0, background: i % 2 ? T.panelAlt : T.panel }}>
                      {anonMode ? r.st.anonId : `${r.st.number}番`}
                    </td>
                    {tests.map((t) => {
                      const s = r[t.id];
                      const rate = s && s.status !== "blank" ? pct(s.result.total, t.maxScore) : null;
                      return (
                        <td key={t.id} onClick={() => s && go("detail", s.id)}
                          style={{
                            padding: "9px 10px", borderBottom: `1px solid ${T.line}`, textAlign: "center",
                            cursor: s ? "pointer" : "default",
                            color: rate == null ? T.textFaint : rate < 50 ? T.ng : rate < 75 ? T.warn : T.ok,
                            font: `700 13px ${FONT_MONO}`,
                          }}>
                          {!s ? "—" : s.status === "blank" ? "白紙" : s.status === "processing" ? "採点中" : s.result.total}
                        </td>
                      );
                    })}
                    <td style={{ padding: "9px 10px", borderBottom: `1px solid ${T.line}`, textAlign: "center", font: `700 13px ${FONT_MONO}`, color: T.accent }}>
                      {r.avg == null ? "—" : `${r.avg}%`}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={{ padding: "10px", fontWeight: 700, color: T.textSub, background: T.panelAlt, position: "sticky", insetInlineStart: 0 }}>クラス平均</td>
                  {tests.map((t) => (
                    <td key={t.id} style={{ padding: "10px", textAlign: "center", font: `700 13px ${FONT_MONO}`, color: T.accent, background: T.panelAlt }}>
                      {classAvg(t) == null ? "—" : classAvg(t)}
                    </td>
                  ))}
                  <td style={{ background: T.panelAlt }} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * 15. 弱点分析 / レポート / 要確認一覧
 * -------------------------------------------------------------------------*/
function WeaknessView() {
  const { T, go, subs, toast } = useUI();
  const [testId, setTestId] = useState("t1");
  const [classId, setClassId] = useState("all");
  const test = testById(testId);

  const target = subs.filter((s) => s.testId === testId && s.status !== "processing" && s.status !== "blank" && (classId === "all" || s.classId === classId));

  const agg = useMemo(() => {
    const units = {}, types = {}, mistakes = {}, byQ = {};
    target.forEach((s) => {
      s.result.items.forEach((it) => {
        const u = (units[it.unit] = units[it.unit] || { unit: it.unit, earned: 0, points: 0 });
        u.earned += it.earned; u.points += it.points;
        const ty = (types[it.typeLabel] = types[it.typeLabel] || { type: it.typeLabel, earned: 0, points: 0 });
        ty.earned += it.earned; ty.points += it.points;
        const q = (byQ[it.qno] = byQ[it.qno] || { qno: it.qno, label: it.label, unit: it.unit, earned: 0, points: 0, correct: 0, n: 0 });
        q.earned += it.earned; q.points += it.points; q.n++; if (it.mark === "○") q.correct++;
        if (it.reason) mistakes[it.reason] = (mistakes[it.reason] || 0) + 1;
      });
    });
    return {
      units: Object.values(units).map((u) => ({ ...u, rate: pct(u.earned, u.points) })).sort((a, b) => a.rate - b.rate),
      types: Object.values(types).map((t) => ({ ...t, rate: pct(t.earned, t.points) })).sort((a, b) => a.rate - b.rate),
      questions: Object.values(byQ).map((q) => ({ ...q, id: `q${q.qno}`, rate: pct(q.earned, q.points), correctRate: pct(q.correct, q.n) })).sort((a, b) => a.rate - b.rate),
      mistakes: Object.entries(mistakes).map(([k, v]) => ({ reason: k, count: v })).sort((a, b) => b.count - a.count),
    };
  }, [target]);

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={grid(180, 10)}>
          <Field label="テスト"><Select value={testId} onChange={setTestId}
            options={TESTS.map((t) => ({ value: t.id, label: `${t.subject}／${t.name}` }))} /></Field>
          <Field label="クラス"><Select value={classId} onChange={setClassId}
            options={[{ value: "all", label: "全クラス" }, ...CLASSES.map((c) => ({ value: c.id, label: c.label }))]} /></Field>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Badge tone="accent">対象 {target.length} 枚</Badge>
          <Btn size="sm" onClick={() => {
            download(`jakuten_${test.subject}.csv`, toCSV(agg.questions, [
              { label: "設問", key: "label" }, { label: "単元", key: "unit" },
              { label: "得点率", key: "rate" }, { label: "正答率", key: "correctRate" }, { label: "人数", key: "n" },
            ]), "text/csv;charset=utf-8");
            toast("設問別の分析を書き出しました");
          }}>CSVを書き出す</Btn>
        </div>
      </Card>

      {target.length === 0 ? (
        <Card><Empty icon="📊" title="分析できる答案がありません" hint="条件を変えるか、新しく採点してください。"
          action={<Btn variant="primary" onClick={() => go("new")}>新規採点へ</Btn>} /></Card>
      ) : (
        <>
          <div style={{ ...grid(300, 14), marginBottom: 14 }}>
            <Card title="単元別の定着度" sub="クラス全体・低い順">
              <div style={{ display: "grid", gap: 12 }}>
                {agg.units.map((u, i) => (
                  <div key={u.unit}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                      <span style={{ color: T.text, fontWeight: 600 }}>
                        {i === 0 && <span style={{ color: T.shu, marginInlineEnd: 5 }}>最優先</span>}{u.unit}
                      </span>
                      <span style={{ font: `700 12.5px ${FONT_MONO}`, color: u.rate < 50 ? T.ng : u.rate < 75 ? T.warn : T.ok }}>{u.rate}%</span>
                    </div>
                    <Bar value={u.rate} tone={u.rate < 50 ? "ng" : u.rate < 75 ? "warn" : "ok"} height={9} />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 13, padding: 11, background: T.warnSoft, borderRadius: 10, fontSize: 12, color: T.text, lineHeight: 1.8 }}>
                <b>指導提案：</b>{agg.units[0].unit} は得点率 {agg.units[0].rate}%。
                導入部分の言い換えと、途中式を書かせる演習を次回1時間分追加することを推奨します。
              </div>
            </Card>

            <Card title="設問形式別の得点率" sub="解答の型が身についているか">
              <div style={{ display: "grid", gap: 12 }}>
                {agg.types.map((ty) => (
                  <div key={ty.type}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                      <span style={{ color: T.text, fontWeight: 600 }}>{ty.type}</span>
                      <span style={{ font: `700 12.5px ${FONT_MONO}`, color: ty.rate < 50 ? T.ng : ty.rate < 75 ? T.warn : T.ok }}>{ty.rate}%</span>
                    </div>
                    <Bar value={ty.rate} tone={ty.rate < 50 ? "ng" : ty.rate < 75 ? "warn" : "ok"} height={9} />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 13, fontSize: 11.5, color: T.textSub, lineHeight: 1.8 }}>
                記述式の得点率が選択式より20ポイント以上低い場合、知識ではなく「書き方」の指導が有効です。
              </div>
            </Card>
          </div>

          <Card title="設問別の正答率" sub="正答率が低い順。授業でどこを取り上げるか決める材料になります" style={{ marginBottom: 14 }}>
            <Table
              maxHeight={330}
              columns={[
                { key: "label", label: "設問" },
                { key: "unit", label: "単元" },
                { key: "correctRate", label: "正答率", align: "right", render: (r) => (
                  <span style={{ font: `700 12.5px ${FONT_MONO}`, color: r.correctRate < 40 ? T.ng : r.correctRate < 70 ? T.warn : T.ok }}>{r.correctRate}%</span>
                ) },
                { key: "rate", label: "得点率", align: "right", render: (r) => `${r.rate}%` },
                { key: "bar", label: "", render: (r) => <div style={{ width: 110 }}><Bar value={r.correctRate} tone={r.correctRate < 40 ? "ng" : r.correctRate < 70 ? "warn" : "ok"} height={6} /></div> },
                { key: "n", label: "人数", align: "right" },
              ]}
              rows={agg.questions}
            />
          </Card>

          <Card title="クラス全体のミス傾向" sub="同じつまずきが何人に出ているか">
            {agg.mistakes.length === 0 ? <Empty icon="🎯" title="目立つ傾向はありません" /> : (
              <div style={grid(230, 10)}>
                {agg.mistakes.slice(0, 9).map((m) => (
                  <div key={m.reason} style={{ border: `1px solid ${T.line}`, borderRadius: 11, padding: 12, background: T.panelAlt }}>
                    <div style={{ font: `700 20px ${FONT_MONO}`, color: T.shu }}>{m.count}<span style={{ fontSize: 11, color: T.textSub, fontWeight: 400 }}> 件</span></div>
                    <div style={{ fontSize: 12.5, color: T.text, marginTop: 5, lineHeight: 1.6 }}>{m.reason}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function ReportsView() {
  const { T, subs, toast, anonMode } = useUI();
  const [kind, setKind] = useState("class");
  const [testId, setTestId] = useState("t1");
  const [classId, setClassId] = useState("c1");
  const test = testById(testId);
  const kl = classById(classId);
  const target = subs.filter((s) => s.testId === testId && s.classId === classId && s.status !== "processing" && s.status !== "blank");
  const rates = target.map((s) => pct(s.result.total, test.maxScore));
  const avg = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length * 10) / 10 : 0;
  const median = rates.length ? [...rates].sort((a, b) => a - b)[Math.floor(rates.length / 2)] : 0;
  const sd = rates.length
    ? Math.round(Math.sqrt(rates.reduce((a, r) => a + (r - avg) ** 2, 0) / rates.length) * 10) / 10 : 0;

  const buildText = () => {
    const lines = [
      `${test.subject}／${test.name}　${kl.label}　成績レポート`,
      `実施日：${fmtDate(test.date)}／試験番号：${test.testNo}／満点：${test.maxScore}点`,
      `対象：${target.length}名`,
      ``,
      `平均得点率：${avg}%　中央値：${median}%　標準偏差：${sd}`,
      `最高：${rates.length ? Math.max(...rates) : 0}%　最低：${rates.length ? Math.min(...rates) : 0}%`,
      ``,
      `【個票】`,
      ...target.map((s) => {
        const st = studentById(s.studentId);
        const a = analyze(test, s.result);
        return `${anonMode ? st.anonId : `${kl.label} ${st.number}番`}　${s.result.total}/${test.maxScore}点（${pct(s.result.total, test.maxScore)}%）　弱点：${a.units[0] ? a.units[0].unit : "—"}`;
      }),
      ``,
      `※本レポートに生徒の実名は含まれません。`,
    ];
    return lines.join("\n");
  };

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={grid(170, 10)}>
          <Field label="レポートの種類"><Select value={kind} onChange={setKind}
            options={[
              { value: "class", label: "クラス成績レポート" },
              { value: "student", label: "個人成績票（一括）" },
              { value: "unit", label: "単元別到達度レポート" },
            ]} /></Field>
          <Field label="テスト"><Select value={testId} onChange={setTestId}
            options={TESTS.map((t) => ({ value: t.id, label: `${t.subject}／${t.name}` }))} /></Field>
          <Field label="クラス"><Select value={classId} onChange={setClassId}
            options={CLASSES.map((c) => ({ value: c.id, label: c.label }))} /></Field>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn variant="primary" onClick={() => { download(`report_${kl.label}_${test.subject}.txt`, buildText()); toast("レポートを書き出しました"); }}>テキストで保存</Btn>
          <Btn onClick={() => {
            download(`report_${kl.label}_${test.subject}.csv`, toCSV(target, [
              { label: "表示名", get: (r) => anonMode ? studentById(r.studentId).anonId : `${studentById(r.studentId).number}番` },
              { label: "得点", get: (r) => r.result.total }, { label: "満点", get: () => test.maxScore },
              { label: "得点率", get: (r) => pct(r.result.total, test.maxScore) },
              { label: "最弱単元", get: (r) => { const a = analyze(test, r.result); return a.units[0] ? a.units[0].unit : ""; } },
            ]), "text/csv;charset=utf-8");
            toast("CSVを書き出しました");
          }}>CSVで保存</Btn>
          <Btn variant="soft" onClick={() => { window.print(); }}>印刷する</Btn>
        </div>
      </Card>

      <Card title={`${kl.label}／${test.subject} ${test.name}`} sub={`実施 ${fmtDate(test.date)}・対象 ${target.length}名・満点 ${test.maxScore}点`}>
        <div style={{ ...grid(120, 9), marginBottom: 16 }}>
          <Stat label="平均得点率" value={avg} unit="%" tone="accent" />
          <Stat label="中央値" value={median} unit="%" tone="info" />
          <Stat label="標準偏差" value={sd} tone="warn" />
          <Stat label="最高" value={rates.length ? Math.max(...rates) : 0} unit="%" tone="ok" />
          <Stat label="最低" value={rates.length ? Math.min(...rates) : 0} unit="%" tone="ng" />
        </div>
        <div style={{
          background: T.panelAlt, border: `1px solid ${T.line}`, borderRadius: 11, padding: 14,
          font: `12.5px/1.9 ${FONT_MONO}`, color: T.text, whiteSpace: "pre-wrap", maxHeight: 400, overflowY: "auto",
        }}>{buildText()}</div>
      </Card>
    </div>
  );
}

function ReviewView() {
  const { T, go, subs, updateSub, toast, anonMode } = useUI();
  const flat = [];
  subs.forEach((s) => {
    if (s.status === "processing") return;
    s.result.items.forEach((it) => {
      if (it.needReview) flat.push({ id: `${s.id}_${it.qno}`, sub: s, it });
    });
  });
  flat.sort((a, b) => a.it.confidence - b.it.confidence);

  const fix = (sub, qno, mark) => {
    const items = sub.result.items.map((it) =>
      it.qno === qno
        ? { ...it, mark, earned: mark === "○" ? it.points : mark === "△" ? Math.max(1, Math.round(it.points / 2)) : 0, needReview: false }
        : it
    );
    const total = items.reduce((a, i) => a + i.earned, 0);
    const stillReview = items.some((i) => i.needReview);
    updateSub(sub.id, {
      result: { ...sub.result, items, total }, edited: true, reviewedBy: "T.K",
      status: sub.status === "blank" ? "blank" : stillReview ? "review" : "done",
    });
    toast("確認しました");
  };

  return (
    <div>
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text, marginBottom: 4 }}>認識信頼度が低い設問だけを集めています</div>
            <div style={{ fontSize: 12, color: T.textSub, lineHeight: 1.75 }}>
              手書きの判読が難しい、記述の要点判定が割れた、といった設問です。○△×を選ぶとその場で確定し、合計点と赤ペン画像に反映されます。
            </div>
          </div>
          <Stat label="残り" value={flat.length} unit="件" tone="warn" />
        </div>
      </Card>

      {flat.length === 0 ? (
        <Card><Empty icon="🎉" title="要確認はゼロです" hint="すべての設問が確定しています。答案を返却できます。"
          action={<Btn variant="primary" onClick={() => go("history")}>採点履歴を見る</Btn>} /></Card>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {flat.slice(0, 40).map(({ id, sub, it }) => {
            const test = testById(sub.testId);
            const st = studentById(sub.studentId);
            return (
              <Card key={id} pad={13}>
                <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap", marginBottom: 9 }}>
                  <Badge tone="warn">信頼度 {Math.round(it.confidence * 100)}%</Badge>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{test.subject}／{it.label}</span>
                  <Badge tone="mute">{it.unit}</Badge>
                  <Badge tone="mute">{it.typeLabel}・{it.points}点</Badge>
                  <span style={{ fontSize: 12, color: T.textSub }}>
                    {anonMode ? st.anonId : `${classById(sub.classId).label} ${st.number}番`}
                  </span>
                  <span style={{ flex: 1 }} />
                  <Btn size="sm" variant="ghost" onClick={() => go("detail", sub.id)}>答案を開く</Btn>
                </div>
                <div style={{
                  background: T.panelAlt, border: `1px solid ${T.line}`, borderRadius: 9, padding: "10px 12px",
                  font: `15px ${FONT_HAND}`, color: T.text, marginBottom: 10,
                }}>{it.blank ? "（無記入）" : it.detected}</div>
                <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11.5, color: T.textSub, fontWeight: 700 }}>AIの判定：</span>
                  <Badge tone={it.mark === "○" ? "ok" : it.mark === "△" ? "warn" : "ng"}>{it.mark} {it.earned}点</Badge>
                  <span style={{ flex: 1 }} />
                  {["○", "△", "×"].map((m) => (
                    <Btn key={m} size="sm" variant={m === it.mark ? "shu" : "default"} onClick={() => fix(sub, it.qno, m)}>
                      {m} で確定
                    </Btn>
                  ))}
                </div>
              </Card>
            );
          })}
          {flat.length > 40 && (
            <div style={{ textAlign: "center", fontSize: 12, color: T.textFaint, padding: 10 }}>
              ほか {flat.length - 40} 件（40件ずつ表示しています）
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * 16. 設定
 * -------------------------------------------------------------------------*/
function SettingsView() {
  const {
    T, t, lang, setLang, mode, setMode, anonMode, setAnonMode, display, setDisplay,
    answerLang, setAnswerLang, studentLang, setStudentLang, toast, resetDemo, retention, setRetention,
  } = useUI();
  const [q, setQ] = useState("");
  const [code] = useState("MFP-8F3K-2026");
  const list = LANGS.filter((l) => !q || `${l.n}${l.e}${l.c}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={grid(330, 14)}>
      <Card title="表示言語" sub={`${LANGS.length} 言語に対応・RTL言語も表示できます`}>
        <Field label="言語を検索"><Input value={q} onChange={setQ} placeholder="日本語 / English / العربية …" /></Field>
        <div style={{ maxHeight: 260, overflowY: "auto", display: "grid", gap: 4, border: `1px solid ${T.line}`, borderRadius: 10, padding: 6 }}>
          {list.map((l) => (
            <button key={l.c} onClick={() => { setLang(l.c); toast(`${l.n} に切り替えました`); }}
              style={{
                display: "flex", gap: 9, alignItems: "center", padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                border: `1px solid ${lang === l.c ? T.accent : "transparent"}`,
                background: lang === l.c ? T.accentSoft : "transparent", font: `13px ${FONT_UI}`, color: T.text, textAlign: "start",
              }}>
              <span style={{ fontSize: 15 }}>{l.f}</span>
              <span style={{ fontWeight: 700, flex: 1 }}>{l.n}</span>
              <span style={{ fontSize: 11, color: T.textFaint }}>{l.e}</span>
              {l.rtl && <Badge tone="info">RTL</Badge>}
            </button>
          ))}
          {list.length === 0 && <div style={{ padding: 16, textAlign: "center", color: T.textFaint, fontSize: 12 }}>該当する言語がありません</div>}
        </div>
        <div style={{ marginTop: 12 }}>
          <Field label="答案の言語（UIとは別に設定）">
            <Select value={answerLang} onChange={setAnswerLang}
              options={LANGS.slice(0, 20).map((l) => ({ value: l.c, label: `${l.f} ${l.n}` }))} />
          </Field>
          <Field label="生徒に表示する言語" hint="教師と生徒で別々の言語を使えます。">
            <Select value={studentLang} onChange={setStudentLang}
              options={LANGS.slice(0, 20).map((l) => ({ value: l.c, label: `${l.f} ${l.n}` }))} />
          </Field>
        </div>
      </Card>

      <Card title="表示と外観">
        <Field label={t("theme")}>
          <div style={{ display: "flex", gap: 7 }}>
            <Btn full variant={mode === "light" ? "primary" : "default"} onClick={() => setMode("light")}>☀ {t("light")}</Btn>
            <Btn full variant={mode === "dark" ? "primary" : "default"} onClick={() => setMode("dark")}>🌙 {t("dark")}</Btn>
          </div>
        </Field>
        <Field label="生徒の表示形式" hint="実名は保存されないため、いずれかの匿名表記を使います。">
          <Select value={display} onChange={setDisplay} options={[
            { value: "class", label: "学年＋クラス＋出席番号（例：2年A組12番）" },
            { value: "exam", label: "受験番号（例：2A12）" },
            { value: "initials", label: "イニシャル（例：T.K）" },
            { value: "anon", label: "匿名ID（例：生徒001）" },
          ]} />
        </Field>
        <label style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "11px 0", borderTop: `1px solid ${T.line}`, cursor: "pointer" }}>
          <input type="checkbox" checked={anonMode} onChange={(e) => setAnonMode(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: T.text, display: "block" }}>匿名モード</span>
            <span style={{ fontSize: 11.5, color: T.textSub, lineHeight: 1.7 }}>
              画面共有や職員会議のときに使います。出席番号も伏せ、匿名IDだけを表示します。
            </span>
          </span>
        </label>
      </Card>

      <Card title="データの取り扱い" sub="学校の規程に合わせて調整できます">
        <Field label="答案画像の保存期間">
          <Select value={retention} onChange={setRetention} options={[
            { value: "30", label: "30日で自動削除" },
            { value: "180", label: "180日で自動削除" },
            { value: "year", label: "学年度末＋1年（既定）" },
            { value: "manual", label: "手動削除のみ" },
          ]} />
        </Field>
        <div style={{ display: "grid", gap: 9, fontSize: 12, color: T.textSub, lineHeight: 1.8 }}>
          <div>・生徒の実名フィールドはデータベースに存在しません。</div>
          <div>・答案画像は生成AIの学習には使用しません。</div>
          <div>・採点の修正履歴は監査ログに残り、書き出せます。</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 13, flexWrap: "wrap" }}>
          <Btn size="sm" onClick={() => { download("audit-log.csv", "日時,操作,対象,実行者\n2026-07-08 10:12,採点修正,生徒003 大問2-(1),T.K\n2026-07-08 10:15,確認済,生徒003,T.K\n", "text/csv;charset=utf-8"); toast("監査ログを書き出しました"); }}>監査ログを書き出す</Btn>
          <Btn size="sm" variant="danger" onClick={() => { resetDemo(); toast("デモデータを初期状態に戻しました", "warn"); }}>デモデータを初期化</Btn>
        </div>
      </Card>

      <Card title="複合機・印刷機との連携" sub="スキャンした答案をそのまま採点キューへ">
        <div style={{ background: T.panelAlt, border: `1px dashed ${T.lineStrong}`, borderRadius: 11, padding: 13, marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, color: T.textSub, marginBottom: 5 }}>連携コード</div>
          <div style={{ font: `700 18px ${FONT_MONO}`, color: T.accent, letterSpacing: ".06em" }}>{code}</div>
        </div>
        <ol style={{ margin: 0, paddingInlineStart: 20, fontSize: 12.5, color: T.textSub, lineHeight: 2 }}>
          <li>複合機の管理画面で「スキャン送信先」を追加します。</li>
          <li>送信先アドレスに <span style={{ font: `12px ${FONT_MONO}`, color: T.text }}>scan@grade.example.jp</span> を入力します。</li>
          <li>件名に上の連携コードを入れると、対応するクラスの採点キューに入ります。</li>
          <li>両面スキャンとADFに対応しています。ページ抜けは自動で検出します。</li>
        </ol>
        <div style={{ display: "flex", gap: 8, marginTop: 13 }}>
          <Btn size="sm" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(code); toast("連携コードをコピーしました"); }}>コードをコピー</Btn>
          <Btn size="sm" variant="soft" onClick={() => toast("接続テストに成功しました（デモ）")}>接続テスト</Btn>
        </div>
      </Card>

      <Card title="通知">
        {[
          ["採点が完了したら通知する", true],
          ["要確認が10件を超えたら通知する", true],
          ["画質不良で採点できない答案があったら通知する", true],
          ["生徒の提出が締切を過ぎたら通知する", false],
          ["月次の利用レポートをメールで受け取る", false],
        ].map(([label, def], i) => (
          <label key={i} style={{ display: "flex", gap: 9, alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${T.line}`, cursor: "pointer" }}>
            <input type="checkbox" defaultChecked={def} />
            <span style={{ fontSize: 12.5, color: T.text }}>{label}</span>
          </label>
        ))}
      </Card>

      <Card title="AIエンジン" sub="本番接続の設定">
        <Field label="採点モデル">
          <Select value="claude" onChange={() => {}} options={[
            { value: "claude", label: "Claude（Vision + 記述採点）" },
            { value: "local", label: "ローカルルールベース（デモ）" },
          ]} />
        </Field>
        <Field label="APIキー" hint="デモではローカルのルールベース採点が動作します。">
          <Input value="" onChange={() => {}} placeholder="sk-ant-… （未設定）" type="password" />
        </Field>
        <div style={{ fontSize: 11.5, color: T.textFaint, lineHeight: 1.8 }}>
          {/* PROD-API: ここで /v1/messages に接続し、画像 + 採点基準プロンプトを送る */}
          本番環境では、答案画像とこのアプリの採点基準をAPIに渡し、設問ごとの正誤・部分点・信頼度を受け取ります。
          鍵はサーバ側に保管し、ブラウザには置かない構成を推奨します。
        </div>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * 17. サイドバー
 * -------------------------------------------------------------------------*/
const NAV = [
  { k: "dashboard", i: "🏠", tk: "nav_dashboard" },
  { k: "new", i: "📤", tk: "nav_new" },
  { k: "history", i: "🗃", tk: "nav_history" },
  { k: "processing", i: "⏳", tk: "nav_processing" },
  { k: "tests", i: "📝", tk: "nav_tests" },
  { k: "model", i: "📘", tk: "nav_model" },
  { k: "rubric", i: "⚖️", tk: "nav_rubric" },
  { k: "students", i: "🧑‍🎓", tk: "nav_students" },
  { k: "classes", i: "🏫", tk: "nav_classes" },
  { k: "scores", i: "📈", tk: "nav_scores" },
  { k: "weakness", i: "🔬", tk: "nav_weakness" },
  { k: "reports", i: "📄", tk: "nav_reports" },
  { k: "review", i: "🔍", tk: "nav_review" },
  { k: "settings", i: "⚙️", tk: "nav_settings" },
];

function Sidebar({ open, onClose }) {
  const { T, t, view, go, favs, toggleFav, subs, mobile } = useUI();
  const counts = {
    processing: subs.filter((s) => s.status === "processing").length,
    review: subs.filter((s) => s.status !== "processing" && s.result.items.some((i) => i.needReview)).length,
    history: subs.filter((s) => s.status !== "processing").length,
  };
  const favItems = NAV.filter((n) => favs.includes(n.k));

  const Item = ({ n, pinned }) => {
    const active = view === n.k;
    const c = counts[n.k];
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <button onClick={() => { go(n.k); if (mobile) onClose(); }}
          style={{
            flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 9,
            border: "none", cursor: "pointer", textAlign: "start", font: `${active ? 700 : 500} 13px ${FONT_UI}`,
            background: active ? T.accentSoft : "transparent", color: active ? T.accent : T.textSub,
            borderInlineStart: `3px solid ${active ? T.accent : "transparent"}`,
          }}>
          <span style={{ fontSize: 15, width: 20, textAlign: "center" }}>{n.i}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t(n.tk)}</span>
          {c > 0 && (
            <span style={{
              background: n.k === "review" ? T.shu : T.info, color: "#fff", borderRadius: 999,
              padding: "1px 7px", font: `700 10.5px ${FONT_MONO}`,
            }}>{c}</span>
          )}
        </button>
        <button onClick={() => toggleFav(n.k)} title={pinned ? t("favRemove") : t("favAdd")}
          style={{ border: "none", background: "transparent", cursor: "pointer", color: favs.includes(n.k) ? T.warn : T.textFaint, fontSize: 12, padding: "4px 6px" }}>
          {favs.includes(n.k) ? "★" : "☆"}
        </button>
      </div>
    );
  };

  const body = (
    <nav style={{
      width: 244, flexShrink: 0, background: T.panel, borderInlineEnd: `1px solid ${T.line}`,
      height: "100%", overflowY: "auto", padding: "12px 8px", boxSizing: "border-box",
    }}>
      <div style={{ padding: "6px 10px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8, background: T.shu, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center", font: `700 17px ${FONT_HAND}`,
          }}>朱</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ font: `700 13.5px ${FONT_UI}`, color: T.text, whiteSpace: "nowrap" }}>{t("appName")}</div>
            <div style={{ fontSize: 10, color: T.textFaint }}>AI GRADING AGENT</div>
          </div>
        </div>
      </div>

      {favItems.length > 0 && (
        <>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textFaint, padding: "6px 12px", letterSpacing: ".08em" }}>
            ★ {t("fav")}
          </div>
          <div style={{ display: "grid", gap: 2, marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${T.line}` }}>
            {favItems.map((n) => <Item key={`f_${n.k}`} n={n} pinned />)}
          </div>
        </>
      )}

      <div style={{ fontSize: 10.5, fontWeight: 700, color: T.textFaint, padding: "6px 12px", letterSpacing: ".08em" }}>MENU</div>
      <div style={{ display: "grid", gap: 2 }}>
        {NAV.map((n) => <Item key={n.k} n={n} />)}
      </div>

      <div style={{ marginTop: 16, padding: "11px 12px", background: T.panelAlt, borderRadius: 10, border: `1px solid ${T.line}` }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textSub, marginBottom: 5 }}>{t("demoData")}</div>
        <div style={{ fontSize: 11, color: T.textFaint, lineHeight: 1.7 }}>
          {STUDENTS.length}名・{TESTS.length}テスト・{subs.length}枚の答案で全機能を試せます。
        </div>
      </div>
    </nav>
  );

  if (!mobile) return body;
  return (
    <>
      {open && <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(10,14,20,.5)", zIndex: 150 }} />}
      <div style={{
        position: "fixed", insetBlock: 0, insetInlineStart: 0, zIndex: 160,
        transform: open ? "translateX(0)" : "translateX(-105%)", transition: "transform .25s ease",
        boxShadow: open ? "0 0 40px rgba(0,0,0,.3)" : "none",
      }}>{body}</div>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * 18. アプリ本体
 * -------------------------------------------------------------------------*/
const TITLES = {
  dashboard: ["nav_dashboard", "採点の状況・お知らせ・利用状況をまとめて確認できます"],
  new: ["nav_new", "答案画像を取り込むと、5つのステップで自動採点します"],
  history: ["nav_history", "採点済みの答案を検索・書き出しできます"],
  processing: ["nav_processing", "いま処理中の答案とその進み具合"],
  tests: ["nav_tests", "テストの設問構成・配点・単元を管理します"],
  model: ["nav_model", "模範解答と解説を生成・保存します"],
  rubric: ["nav_rubric", "採点のきびしさと表記の扱いを決めます"],
  students: ["nav_students", "実名を保存しない設計で生徒を管理します"],
  classes: ["nav_classes", "クラスごとの平均と分布"],
  scores: ["nav_scores", "クラス × テストの得点を一覧します"],
  weakness: ["nav_weakness", "単元別・設問別のつまずきを可視化します"],
  reports: ["nav_reports", "クラス成績レポートと個人成績票を作ります"],
  review: ["nav_review", "認識信頼度が低い設問を確定させます"],
  settings: ["nav_settings", "言語・表示・データの扱い・外部連携"],
  detail: ["nav_history", "赤ペン採点画像・修正・分析・フィードバック"],
};

export default function App() {
  const [mode, setMode] = useState("light");
  const [lang, setLang] = useState("ja");
  const [view, setView] = useState("dashboard");
  const [param, setParam] = useState(null);
  const [subs, setSubs] = useState(INITIAL_SUBMISSIONS);
  const [favs, setFavs] = useState(["new", "review"]);
  const [toasts, setToasts] = useState([]);
  const [anonMode, setAnonMode] = useState(false);
  const [display, setDisplay] = useState("class");
  const [answerLang, setAnswerLang] = useState("ja");
  const [studentLang, setStudentLang] = useState("ja");
  const [retention, setRetention] = useState("year");
  const [rubric, setRubric] = useState(DEFAULT_RUBRIC);
  const [drawer, setDrawer] = useState(false);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 900);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const T = THEME[mode];
  const t = useMemo(() => makeT(lang), [lang]);
  const rtl = isRTL(lang);

  const toast = useCallback((msg, tone = "ok") => {
    const id = uid("t");
    setToasts((p) => [...p, { id, msg, tone }]);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 3200);
  }, []);

  const go = useCallback((v, p = null) => {
    setView(v); setParam(p); setDrawer(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const updateSub = useCallback((id, patch) => {
    setSubs((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);
  const addSubs = useCallback((made) => setSubs((prev) => [...made, ...prev]), []);
  const resetDemo = useCallback(() => { setSubs(INITIAL_SUBMISSIONS); go("dashboard"); }, [go]);
  const toggleFav = useCallback((k) => {
    setFavs((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }, []);

  const ctx = {
    T, t, lang, setLang, mode, setMode, view, go, param, subs, setSubs, updateSub, addSubs,
    favs, toggleFav, toast, anonMode, setAnonMode, display, setDisplay,
    answerLang, setAnswerLang, studentLang, setStudentLang, rubric, setRubric,
    retention, setRetention, resetDemo, mobile,
  };

  const [tk, sub] = TITLES[view] || TITLES.dashboard;
  const reviewCount = subs.filter((s) => s.status !== "processing" && s.result.items.some((i) => i.needReview)).length;

  const body = () => {
    switch (view) {
      case "dashboard": return <Dashboard />;
      case "new": return <NewGrading />;
      case "history": return <History />;
      case "processing": return <Processing />;
      case "tests": return <TestsView />;
      case "model": return <ModelAnswersView />;
      case "rubric": return <RubricView />;
      case "students": return <StudentsView />;
      case "classes": return <ClassesView />;
      case "scores": return <ScoresView />;
      case "weakness": return <WeaknessView />;
      case "reports": return <ReportsView />;
      case "review": return <ReviewView />;
      case "settings": return <SettingsView />;
      case "detail": return <GradingDetail subId={param} />;
      default: return <Dashboard />;
    }
  };

  return (
    <Ctx.Provider value={ctx}>
      <div dir={rtl ? "rtl" : "ltr"} style={{
        display: "flex", minHeight: "100vh", background: T.bg, color: T.text,
        font: `14px/1.6 ${FONT_UI}`, WebkitFontSmoothing: "antialiased",
      }}>
        <Sidebar open={drawer} onClose={() => setDrawer(false)} />

        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <header style={{
            position: "sticky", top: 0, zIndex: 100, background: `${T.panel}f2`, backdropFilter: "blur(8px)",
            borderBottom: `1px solid ${T.line}`, padding: "11px 16px",
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          }}>
            {mobile && (
              <button onClick={() => setDrawer(true)} aria-label="メニュー"
                style={{ border: `1px solid ${T.lineStrong}`, background: T.panel, borderRadius: 9, width: 36, height: 34, cursor: "pointer", color: T.text, fontSize: 15 }}>☰</button>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ margin: 0, font: `700 16px ${FONT_UI}`, color: T.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t(tk)}
              </h1>
              <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
            </div>
            {!mobile && reviewCount > 0 && view !== "review" && (
              <Btn size="sm" variant="soft" onClick={() => go("review")}>要確認 {reviewCount}</Btn>
            )}
            <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="language"
              style={{ ...inputStyle(T), width: "auto", padding: "6px 8px", fontSize: 12 }}>
              {LANGS.map((l) => <option key={l.c} value={l.c}>{l.f} {l.n}</option>)}
            </select>
            <button onClick={() => setMode(mode === "light" ? "dark" : "light")} aria-label="theme"
              style={{ border: `1px solid ${T.lineStrong}`, background: T.panel, borderRadius: 9, width: 36, height: 34, cursor: "pointer", color: T.text, fontSize: 14 }}>
              {mode === "light" ? "🌙" : "☀"}
            </button>
            {!mobile && <Btn size="sm" variant="shu" onClick={() => go("new")}>新規採点</Btn>}
          </header>

          <div style={{ padding: mobile ? "14px 12px 60px" : "20px 22px 70px", maxWidth: 1240, width: "100%", boxSizing: "border-box" }}>
            {body()}
          </div>

          <footer style={{ marginTop: "auto", borderTop: `1px solid ${T.line}`, padding: "14px 18px", background: T.panel }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 11.5, color: T.textFaint }}>
              <span style={{ fontWeight: 700, color: T.textSub }}>{t("appName")}</span>
              <span>生徒の実名は保存しません</span>
              <span>·</span>
              <span>AIの採点は下書きです。返却前に教師がご確認ください</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => go("settings")} style={{ border: "none", background: "transparent", color: T.accent, cursor: "pointer", font: `600 11.5px ${FONT_UI}` }}>
                プライバシー設定
              </button>
            </div>
          </footer>
        </main>

        {mobile && (
          <button onClick={() => go("new")} aria-label="新規採点"
            style={{
              position: "fixed", insetInlineEnd: 16, bottom: 16, zIndex: 120,
              width: 54, height: 54, borderRadius: 18, border: "none", background: T.shu, color: "#fff",
              fontSize: 21, cursor: "pointer", boxShadow: "0 8px 22px rgba(200,52,43,.4)",
            }}>＋</button>
        )}

        <Toast toasts={toasts} />
      </div>
    </Ctx.Provider>
  );
}
