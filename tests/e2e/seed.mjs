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
console.log("seeded", { A, B });
