// 復習の方式のスイッチ（サーバーの環境変数）。秘密は扱わない。
//   - TUTOR_FEATURE=off：アプリ内の会話（A方式）の緊急停止
//   - TUTOR_INAPP=on：アプリ内の会話（A方式：本人の API キーでの音声・文字の会話）を使う。既定は使わない
// 「本人の ChatGPT で復習」（B方式）は、これらに関係なく学校・クラスの設定（0015）で決まり、ブラウザだけで動く。
export const featureOff = () => (process.env.TUTOR_FEATURE ?? "").toLowerCase() === "off";
/** アプリ内の会話（A方式）を使うか。既定は使わない。止める操作（終了・撤回・削除）はこの設定に関係なく受け付ける */
export const inAppEnabled = () => (process.env.TUTOR_INAPP ?? "").toLowerCase() === "on" && !featureOff();
