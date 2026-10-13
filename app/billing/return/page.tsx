"use client";
import Link from "next/link";
export default function BillingReturn() {
  return <main style={{ maxWidth: 600, margin: "60px auto", padding: 24 }}><h1>支払いの確認</h1><p>支払い結果は決済サービスから確認して反映します。遅れる場合があります。</p><p>Opus単独の採点は入金確認後、自動で進みます。夜間プランは日本時間22時〜翌6時に処理します。結果は採点履歴で確認してください。</p><Link href="/">アプリに戻る</Link></main>;
}
