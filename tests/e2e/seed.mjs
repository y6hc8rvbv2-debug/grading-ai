// ローカル Supabase にテスト用の学校・教職員・名簿を作る（tests/e2e/run.sh から呼ぶ）。
// 教職員は SUPABASE-SETUP.md の招待手順どおり app_metadata で所属校を付ける。
import { createClient } from "@supabase/supabase-js";
const URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE = process.env.SERVICE;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function school(name, code) {
  const { data, error } = await admin.from("schools").insert({ name, code, plan: "school" }).select("id").single();
  if (error) throw error;
  return data.id;
}
const A = await school("テスト中学校", "SCHOOL-A");
const B = await school("別の中学校", "SCHOOL-B");

// 1人目（管理者）: createUser + app_metadata
const { data: u1, error: e1 } = await admin.auth.admin.createUser({
  email: "admin@a.example", password: "pass-A-123", email_confirm: true,
  app_metadata: { school_id: A, role: "admin" }, user_metadata: { display_name: "T.K" },
});
if (e1) throw e1;
// 2人目（教員）: SUPABASE-SETUP.md の招待手順どおり — ユーザー作成 → updateUserById で app_metadata
const { data: u2, error: e2 } = await admin.auth.admin.createUser({ email: "teacher@a.example", password: "pass-A-456", email_confirm: true });
if (e2) throw e2;
const { error: e3 } = await admin.auth.admin.updateUserById(u2.user.id, { app_metadata: { school_id: A, role: "teacher" } });
if (e3) throw e3;
// 他校の教員
const { data: u3, error: e4 } = await admin.auth.admin.createUser({
  email: "teacher@b.example", password: "pass-B-123", email_confirm: true, app_metadata: { school_id: B },
});
if (e4) throw e4;
// 攻撃者: 一般サインアップで user_metadata に school_id/role を入れる
const anonKey = process.env.ANON;
const pub = createClient(URL, anonKey, { auth: { persistSession: false } });
const { data: u4 } = await pub.auth.signUp({ email: "attacker@x.example", password: "pass-X-123", options: { data: { school_id: A, role: "admin" } } });

const { data: profiles } = await admin.from("profiles").select("id, school_id, role, display_name");
console.log("✓ app_metadata から profiles を作成:", JSON.stringify(profiles.map((p) => [p.role, p.school_id === A ? "A" : "B"])));
if (profiles.some((p) => p.id === u4?.user?.id)) {
  throw new Error("一般サインアップ（user_metadata）で所属校付きの profile が作られた。handle_new_user を確認すること");
}
console.log("✓ 一般サインアップでは所属校が付かない");
if (profiles.length !== 3) throw new Error(`profiles が3件でない: ${profiles.length}`);

// クラスと生徒（SUPABASE-SETUP.md ステップ4 相当）
const { data: c, error: e5 } = await admin.from("classes").insert({ school_id: A, grade: 2, name: "A", teacher_label: "担任 T.K", school_year: 2026 }).select("id").single();
if (e5) throw e5;
const students = Array.from({ length: 9 }, (_, i) => ({
  school_id: A, class_id: c.id, number: i + 1, exam_no: `2A${String(i + 1).padStart(2, "0")}`,
  anon_id: `生徒${String(i + 1).padStart(3, "0")}`, initials: "",
}));
const { error: e6 } = await admin.from("students").insert(students);
if (e6) throw e6;
const { data: cb } = await admin.from("classes").insert({ school_id: B, grade: 1, name: "B", school_year: 2026 }).select("id").single();
await admin.from("students").insert({ school_id: B, class_id: cb.id, number: 1, exam_no: "1B01", anon_id: "生徒B01" });
// ---------------------------------------------------------------- 学校C：返却とチャッピー先生の確認用（tests/e2e/tutor.mjs）
// 既存のシナリオ（学校A・B）と混ざらないように別の学校にする。答案は採点済み（大問1-(2) だけ ×）、まだ確認・返却していない
const C = await school("チャッピー中学校", "SCHOOL-C");
const { data: uc, error: ec } = await admin.auth.admin.createUser({ email: "admin@c.example", password: "pass-C-123", email_confirm: true });
if (ec) throw ec;
await admin.auth.admin.updateUserById(uc.user.id, { app_metadata: { school_id: C, role: "admin" } });
const { data: cc } = await admin.from("classes").insert({ school_id: C, grade: 2, name: "C", school_year: 2026 }).select("id").single();
const { data: stC } = await admin.from("students").insert([1, 2].map((n) => ({ school_id: C, class_id: cc.id, number: n, exam_no: `2C0${n}`, anon_id: `生徒C0${n}` }))).select("id, number");
stC.sort((a, b) => a.number - b.number);
for (const [i, s] of stC.entries()) {
  const { data: u, error } = await admin.auth.admin.createUser({ email: `student${i + 1}@c.example`, password: `pass-S-${i + 1}${i + 1}${i + 1}x`, email_confirm: true });
  if (error) throw error;
  const { error: eb } = await admin.from("student_accounts").insert({ student_id: s.id, user_id: u.user.id, school_id: C });
  if (eb) throw eb;
}
const { data: tc } = await admin.from("tests").insert({ school_id: C, name: "チャッピー確認テスト", subject: "数学", grade: 2, max_score: 12 }).select("id").single();
const qs = [1, 2, 3].map((no) => ({ school_id: C, test_id: tc.id, no, big: 1, label: `大問1-(${no})`, qtype: "calc", points: 4, correct: ["-1", "-4a+6b-12", "3a²/b"][no - 1] }));
const { data: qrows, error: eq } = await admin.from("questions").insert(qs).select("id, no");
if (eq) throw eq;
const { data: subC, error: es } = await admin.from("submissions").insert({ school_id: C, test_id: tc.id, student_id: stC[0].id, class_id: cc.id, status: "done", progress: 100 }).select("id").single();
if (es) throw es;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC", "base64");
const imgPath = `${C}/${tc.id}/${subC.id}/1.png`;
const { error: eu } = await admin.storage.from("answer-sheets").upload(imgPath, png, { contentType: "image/png" });
if (eu) throw eu;
await admin.from("submissions").update({ image_paths: [imgPath] }).eq("id", subC.id);
const marks = { 1: ["○", 4, "", "-1"], 2: ["×", 0, "符号に注意", "-4a-6b-12"], 3: ["○", 4, "", "3a²/b"] };
const { error: ei } = await admin.from("submission_items").insert(qrows.map((q) => ({
  school_id: C, submission_id: subC.id, question_id: q.id, qno: q.no, mark: marks[q.no][0], earned: marks[q.no][1],
  comment: marks[q.no][2], detected: marks[q.no][3], confidence: 0.95, need_review: false,
})));
if (ei) throw ei;
console.log("✓ 学校C（返却とチャッピー先生の確認用）");
console.log("seeded", { A, B, C });
