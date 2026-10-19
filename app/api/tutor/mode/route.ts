// 復習の方式：アプリ内の会話（A方式）を使う設定か（教職員の設定画面が表示を切り替えるのに使う）。秘密は返さない。
// 「本人の ChatGPT で復習」（B方式）は、この設定に関係なく、学校・クラスの設定（0015）で表示する
import { json } from "@/lib/tutor/server";
import { inAppEnabled } from "@/lib/tutor/mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return json({ inapp: inAppEnabled() });
}
