// メニューの表示言語（日本語・英語）。指導案そのものは、作成画面で選んだ言語で生成される。
import { useDisplay } from './store.js';

const EN = {
  'ダッシュボード': 'Dashboard', '新しい指導案': 'New lesson plan', '指導案一覧': 'Lesson plans', 'カレンダー': 'Calendar',
  '録画・録音': 'Recordings', '振り返り会議': 'Reflections', '評価レポート': 'Evaluations', '特別支援ガイド': 'Special needs guide',
  '指導案ライブラリ': 'Plan library', '教育論文': 'Research', 'テンプレート': 'Templates', '名簿': 'Class roster', '授業タイマー': 'Lesson timer',
  '利用者の声': 'Testimonials', '機能提案': 'Suggestions', 'ヘルプ': 'Help', 'プラン': 'Plans & billing', '設定': 'Settings',
  'つくる': 'Create', '記録と評価': 'Record & assess', '資料とツール': 'Resources & tools', 'みんなで': 'Community', 'サポート': 'Support',
  '検索・移動': 'Search / jump', '管理者': 'Admin',
};
export function useT() {
  const { language } = useDisplay();
  return (s) => (language === 'en' ? EN[s] || s : s);
}
