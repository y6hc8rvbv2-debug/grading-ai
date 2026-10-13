"use client";
// AI に答案などを送る前の同意の画面（lib/ai-consent.ts）。AppShell の中に1つだけ置く。
import React, { useEffect, useState } from "react";
import { onAiConsentRequest, type ConsentRequest } from "@/lib/ai-consent";
import { useUI } from "@/components/ui-context";
import { Btn, Modal } from "@/components/ui";

export function AiConsentDialog() {
  const { T } = useUI();
  const [queue, setQueue] = useState<ConsentRequest[]>([]);
  useEffect(() => onAiConsentRequest((done) => setQueue((q) => [...q, done])), []);
  const answer = (ok: boolean) => { queue.forEach((d) => d(ok)); setQueue([]); };
  return (
    <div data-ai-consent>
      <Modal open={queue.length > 0} onClose={() => answer(false)} title="AI に送る内容の確認" width={560}
        footer={<>
          <Btn onClick={() => answer(false)}>送らない</Btn>
          <Btn variant="primary" onClick={() => answer(true)}>同意して AI に送る</Btn>
        </>}>
        <div style={{ fontSize: 13, color: T.text, lineHeight: 1.9 }}>
          <p style={{ marginTop: 0 }}>AI での採点・読み取りのため、次の内容を <b>Anthropic, PBC（米国）</b> の AI に送ります。</p>
          <ul style={{ paddingInlineStart: 20, margin: "0 0 8px" }}>
            <li>答案の写真（氏名などが書かれていれば、それも写っています）</li>
            <li>テストの設問・正答・配点・採点基準、模範解答や問題用紙の写真（テストの読み取りのとき）</li>
          </ul>
          <p style={{ margin: "0 0 8px" }}>
            使い道は、採点の下書き・答案の振り分け・模範解答の読み取りだけです。生徒の名簿の情報（番号・匿名ID）やメールアドレスは送りません。
            AI の結果は下書きです。返却の前に先生が確認してください。
          </p>
          <p style={{ margin: 0, fontSize: 12, color: T.textSub }}>
            この同意はこの端末に保存し、設定画面の「AIエンジン」から取り消せます。詳しくは <a href="/privacy" target="_blank" rel="noopener">プライバシーポリシー</a> をご覧ください。
          </p>
        </div>
      </Modal>
    </div>
  );
}
