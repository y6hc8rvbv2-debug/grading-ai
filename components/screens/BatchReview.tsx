"use client";
import { useCallback, useEffect, useState } from "react";
import { useUI } from "@/components/ui-context";
import { Btn, Card } from "@/components/ui";
import AnswerFocus from "@/components/AnswerFocus";
import { createClient } from "@/lib/supabase/client";
import { loadSubmissions } from "@/lib/db/grading";
import type { Submission, Mark } from "@/lib/types";
export default function BatchReview() {
  const { ws, ds, who, editItem, toast, isAdmin } = useUI();
  const [testId, setTest] = useState(ws.tests[0]?.id || "");
  const [classId, setClass] = useState(ws.classes[0]?.id || "");
  const [list, setList] = useState<Submission[]>([]);
  const [qno, setQno] = useState(0);
  const [only, setOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [student, setStudent] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setList(
        ds.mode === "supabase"
          ? await loadSubmissions({ testId, classId, limit: 1000 })
          : await ds.loadSubmissions(),
      );
      if (ds.mode === "supabase") {
        const { data, error } = await createClient()
          .from("student_accounts")
          .select("student_id");
        if (error) throw error;
        setAccounts((data || []).map((a) => a.student_id));
      }
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込み失敗");
    }
  }, [ds, testId, classId]);
  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]); // 採点画面と並行して確認
  const test = ws.tests.find((t) => t.id === testId);
  const roster = ws.students.filter((s) => s.classId === classId);
  const submissions = list.filter(
    (s) => s.testId === testId && s.classId === classId,
  );
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "操作に失敗しました", "ng");
    } finally {
      setBusy(false);
    }
  };
  const publish = () =>
    act(async () => {
      if (
        !window.confirm(
          `${roster.length}名の本人専用ページへ採点結果を一斉配信します。宛先と結果を確認しましたか？`,
        )
      )
        return;
      const { data, error } = await createClient().rpc(
        "publish_class_results",
        { p_test: testId, p_class: classId },
      );
      if (error) throw error;
      toast(`${data}名分を配信しました。生徒は /student で確認できます`);
    });
  const publishOne = (sub: Submission) => act(async () => {
    if (!window.confirm(`${who(sub.studentId)} の「${test?.name}」（${sub.result.total}点）を、登録済みの本人専用ページへ返却しますか？`)) return;
    const { data, error } = await createClient().rpc("publish_submission_result", { p_submission: sub.id });
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883")
        throw new Error("個別返却には 0011_individual_return.sql の実行が必要です。");
      throw new Error(error.message);
    }
    toast(data ? "この生徒に返却しました。生徒画面の「更新」で確認できます" : "同じ内容で返却済みです");
  });
  return (
    <div>
      <h2>答案の確認・個別返却・一斉配信</h2>
      <p>
        採点中も10秒ごとに更新します。設問を選ぶと同じ問題の回答を横に並べます。
      </p>
      <p>
        <select
          aria-label="テスト"
          value={testId}
          onChange={(e) => {
            setTest(e.target.value);
            setQno(0);
          }}
        >
          {ws.tests.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>{" "}
        <select
          aria-label="クラス"
          value={classId}
          onChange={(e) => setClass(e.target.value)}
        >
          {ws.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </p>
      {error && <p role="alert">{error}</p>}
      <Card>
        <p>
          提出 {submissions.length}／{roster.length}名・未確認{" "}
          {submissions.filter((s) => !s.reviewedBy).length}名
        </p>
        <p>
          未提出：
          {roster
            .filter((st) => !submissions.some((s) => s.studentId === st.id))
            .map((st) => who(st.id))
            .join("・") || "なし"}
        </p>
        <p>
          配信先未登録：
          {roster
            .filter((st) => !accounts.includes(st.id))
            .map((st) => who(st.id))
            .join("・") || "なし"}
        </p>
        <p>
          本人専用ページ：
          <a href="/student" target="_blank" rel="noreferrer">
            /student
          </a>
          （スマホ・タブレット対応。メール・プッシュ通知は送信しません）
        </p>
        {isAdmin && (
          <details>
            <summary>配信先を登録する</summary>
            <p>
              生徒が /student
              から本人のメールアドレスを登録し、確認メールで本人確認した後に紐づけます。
            </p>
            <select
              aria-label="配信先の生徒"
              value={student}
              onChange={(e) => setStudent(e.target.value)}
            >
              <option value="">生徒を選ぶ</option>
              {roster.map((st) => (
                <option key={st.id} value={st.id}>
                  {who(st.id)}
                </option>
              ))}
            </select>
            <input
              aria-label="生徒のメール"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Btn
              disabled={busy || !student || !email}
              onClick={() =>
                act(async () => {
                  if (
                    !window.confirm(
                      `${who(student)} と ${email} の対応を確認しましたか？`,
                    )
                  )
                    return;
                  const { error } = await createClient().rpc(
                    "bind_student_account",
                    { p_student: student, p_email: email },
                  );
                  if (error) throw error;
                  setEmail("");
                  toast("配信先を登録しました");
                })
              }
            >
              本人対応を確認して登録
            </Btn>
          </details>
        )}
        <Btn
          disabled={busy || ds.mode === "demo" || !roster.length}
          onClick={publish}
        >
          全員の確認済み結果を一斉配信
        </Btn>
      </Card>
      <p>
        <select
          aria-label="設問"
          value={qno}
          onChange={(e) => setQno(Number(e.target.value))}
        >
          <option value={0}>全設問</option>
          {test?.questions.map((q) => (
            <option key={q.no} value={q.no}>
              {q.label}
            </option>
          ))}
        </select>{" "}
        <label>
          <input
            type="checkbox"
            checked={only}
            onChange={(e) => setOnly(e.target.checked)}
          />
          要確認のみ
        </label>
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
          gap: 12,
        }}
      >
        {submissions.map((sub) => (
          <Card key={sub.id}>
            <h3>
              {who(sub.studentId)}・{sub.result.total}点
            </h3>
            <p>
              <Btn disabled={busy || ds.mode === "demo" || !accounts.includes(sub.studentId) || !sub.reviewedBy ||
                ["uploaded", "processing"].includes(sub.status) || !sub.result.items.length ||
                sub.result.items.length !== test?.questions.length ||
                sub.result.items.some(i => i.needReview || (i.mark === "-" && !i.blank))}
                onClick={() => publishOne(sub)}>この生徒に返却</Btn>
            </p>
            <p>{!accounts.includes(sub.studentId) ? "配信先を登録すると個別返却できます。" :
              !sub.reviewedBy ? "全設問を確認済みにすると個別返却できます。" :
              "個別返却は、ほかの生徒が未提出でも利用できます。"}</p>
            {["uploaded", "processing"].includes(sub.status) ? (
              <p>採点待ち・採点中</p>
            ) : (
              <>
                {sub.result.items
                  .filter(
                    (it) =>
                      (!qno || qno === it.qno) && (!only || it.needReview),
                  )
                  .sort((a, b) => Number(b.needReview) - Number(a.needReview))
                  .map((it) => (
                    <section
                      key={it.id}
                      style={{ borderBottom: "1px solid #ccc", padding: 10 }}
                    >
                      <b>
                        {it.label} {it.mark} {it.earned}/{it.points}点{" "}
                        {it.needReview ? "要確認" : ""}
                      </b>
                      <AnswerFocus sub={sub} item={it} />
                      <p>
                        模範解答：
                        {test?.questions.find((q) => q.no === it.qno)?.correct}
                      </p>
                      <p>
                        {test?.questions.find((q) => q.no === it.qno)?.model}
                      </p>
                      <p>読み取り：{it.detected}</p>
                      <p>{it.comment}</p>
                      {(["○", "△", "×"] as Mark[]).map((mark) => (
                        <Btn
                          key={mark}
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              if (!(await editItem(sub.id, it, { mark })))
                                throw new Error("保存に失敗しました");
                            })
                          }
                        >
                          {mark}
                        </Btn>
                      ))}
                    </section>
                  ))}
                <Btn
                  disabled={
                    busy ||
                    sub.result.items.some((i) => i.needReview) ||
                    sub.result.items.length !== test?.questions.length
                  }
                  onClick={() =>
                    act(async () => {
                      if (!window.confirm(`${who(sub.studentId)} の全 ${sub.result.items.length} 問を確認しましたか？`)) return;
                        await ds.markReviewed(sub.id);
                      toast("この生徒の全設問を確認済みにしました");
                    })
                  }
                >
                  {sub.reviewedBy ? "確認済み" : "この生徒の全設問を確認した"}
                </Btn>
              </>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
