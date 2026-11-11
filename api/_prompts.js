// Claude に渡す指示文（プロンプト）をタスクごとに組み立てる。
// 画面側からは「タスク名＋材料」だけを受け取り、指示文はサーバー側で固定する
// （＝このAPIを別目的に流用されにくくするため）。

const LANG = { ja: '日本語', en: 'English', zh: '中文', ko: '한국어', es: 'Español', fr: 'Français', de: 'Deutsch', pt: 'Português' };
const langName = (code) => LANG[code] || code || '日本語';
const s = (v, fallback = '（未入力）') => (v === undefined || v === null || v === '' ? fallback : String(v));
const clip = (v, n = 6000) => String(v ?? '').slice(0, n);

const BASE = `あなたは日本の学校教育（学習指導要領・授業研究）に精通した、指導主事クラスの教育専門家です。
現場の教員がそのまま使える、具体的で実践的な内容を書きます。断定できない事柄は断定せず、教員による確認が前提であることを踏まえます。
児童生徒は「生徒1」「生徒2」のような仮名で渡されます。仮名はそのまま使い、実名を推測しないでください。`;

const JSON_RULE = `出力は有効なJSONオブジェクト1つだけにしてください。前置き・後書き・Markdownのコードフェンスは書きません。`;

const PLAN_SCHEMA = `{
  "title": "授業タイトル",
  "introduction": "導入（3〜5文）",
  "development": "展開（5〜8文）",
  "conclusion": "まとめ（3〜5文）",
  "detailedPlan": [
    { "time": "0-5分", "activity": "学習活動", "teacherAction": "教師の働きかけ", "studentAction": "児童生徒の活動", "materials": "教材・教具", "notes": "留意点" }
  ],
  "evaluationCriteria": ["評価規準1", "評価規準2", "評価規準3", "評価規準4"],
  "boardPlan": "板書計画（左・中央・右の構成が分かるように）"
}`;

function planFacts(p = {}) {
  const school = p.schoolType === 'elementary' ? '小学校' : p.schoolType === 'middle' ? '中学校' : p.schoolType === 'high' ? '高等学校' : s(p.schoolType);
  return `- 校種: ${school}
- 学年: ${s(p.grade)}
- 教科: ${s(p.subject)}
- 単元: ${s(p.unit)}
- 単元のねらい: ${s(p.unitObjective, '学習指導要領に基づき設定')}
- 小単元: ${s(p.subUnit, 'なし')}／小単元のねらい: ${s(p.subUnitObjective, 'なし')}
- 本時のねらい: ${s(p.currentLessonObjective, '単元のねらいから設定')}
- 次数: ${s(p.lessonNumber, 1)}／指導時間数: ${s(p.teachingHours, 1)}
- 授業形態: ${s(p.classFormat, '一斉授業')}
- 指導理論: ${s(p.teachingTheory, 'アクティブラーニング')}
- 児童生徒数: ${s(p.studentCount, 30)}
- 教材: ${s(p.materials, '教科書')}／教具: ${s(p.teachingTools, '黒板・ホワイトボード')}
- 学校と地域の環境: ${s(p.schoolEnvironment, '標準的')}
- 児童生徒全体の特徴: ${s(p.studentCharacteristics, '標準的')}
- 特別な支援を要する児童生徒: ${s(p.specialNeedsInfo, 'なし')}
- 既習事項: ${s(p.priorKnowledge, '指定なし')}
- 体験活動: ${s(p.experientialActivities, 'なし')}／コミュニケーション活動: ${s(p.communicationActivities, 'なし')}
- 発問: ${s(p.questions, 'AIが設定')}／予想される反応: ${s(p.expectedResponses, 'AIが設定')}
- 評価: ${s(p.evaluation, 'AIが設定')}
- 注意事項: ${s(p.notes, 'なし')}／その他: ${s(p.otherInfo, 'なし')}`;
}

function planBody(p = {}) {
  const c = p.generatedContent || {};
  const rows = (c.detailedPlan || []).map((b) => `  [${b.time}] ${b.activity}｜教師: ${b.teacherAction}｜児童生徒: ${b.studentAction}`).join('\n');
  return `導入: ${s(c.introduction, 'なし')}
展開: ${s(c.development, 'なし')}
まとめ: ${s(c.conclusion, 'なし')}
学習過程:
${rows || '  なし'}
評価規準: ${(c.evaluationCriteria || []).join(' / ') || 'なし'}
板書計画: ${s(c.boardPlan, 'なし')}`;
}

const image = (dataUrl) => {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
};

export const TASKS = {
  // ── 指導案の生成 ──────────────────────────────
  generatePlan(p) {
    const theories = (p.teachingTheories || []).filter((t) => t?.name).map((t) => `- ${t.name}: ${s(t.summary, '')}`).join('\n');
    const papers = (p.adoptedPapers || []).map((x, i) => `【${i + 1}】${x.title}（${s(x.authors, '著者不明')}）\n概要: ${clip(x.abstract, 600)}\n授業への示唆: ${clip(x.summary, 600)}`).join('\n\n');
    const needs = (p.detectedDisabilitySuggestions || []).map((x) => `【${x.label}】\n${(x.tips || []).map((t) => `  - ${t}`).join('\n')}`).join('\n');
    return {
      maxTokens: 16000,
      effort: 'medium',
      text: `次の条件で、学習指導要領に沿った学習指導案を作成してください。

## 授業の条件
${planFacts(p)}

## 作成の方針
- 指導理論は「飾り」にせず、導入・展開・まとめ・学習過程・評価・板書のすべてに一貫して反映します。学習過程の各「留意点」には、その場面でどの理論のどの考え方を使っているかを一言添えます。${theories ? `\n- 選択された指導理論の要点:\n${theories}` : ''}
- 教材・教具は名前を挙げるだけでなく、「何を映す／何を配る／どう操作させるか」まで具体的に書きます。電子黒板が含まれる場合は、板書計画に「手書きする内容」と「デジタルで提示する内容」を分けて書きます。
- 既習事項が指定されている場合は、導入で想起させ、展開で新しい内容へ橋渡しし、評価規準にも既習と新出の統合を見取る項目を入れます。既に学んだ内容の教え直しはしません。
- 特別な支援を要する児童生徒の記載がある場合は、1か所の注記で済ませず、教師の働きかけ・児童生徒の活動・教材・評価の各所に具体的な手立てを織り込みます。医学的な診断や断定は書きません。${needs ? `\n- 参考にする支援の手立て:\n${needs}` : ''}${papers ? `\n- 教員が採用した研究知見を授業設計に生かし、どの活動がどの知見に基づくかを留意点に書きます:\n${papers}` : ''}
- 学習過程（detailedPlan）は授業全体を覆う5〜7ブロック、評価規準は4つ以上にします。

## 出力言語
${langName(p.language)}

## 出力形式
${JSON_RULE}
${PLAN_SCHEMA}`,
    };
  },

  // ── 改善版の生成（振り返り・総合評価・自由な指示から） ──
  improvePlan(p) {
    return {
      maxTokens: 16000,
      effort: 'medium',
      text: `次の指導案を、示された根拠に基づいて改善してください。効果のあった部分は残し、課題が指摘された部分を具体的に作り直します。

## 元の授業の条件
${planFacts(p.plan)}

## 元の指導案
${planBody(p.plan)}

## 改善の根拠
${clip(p.feedback, 8000) || '特になし（全体をより良くする）'}

## 出力言語
${langName(p.plan?.language)}

## 出力形式
${JSON_RULE}
${PLAN_SCHEMA.replace(/\n}$/, ',\n  "improvementSummary": "元の指導案からの主な変更点（3〜5文）"\n}')}`,
    };
  },

  // ── 振り返り会議（文字起こし → 要約・助言） ──
  reflection(p) {
    return {
      maxTokens: 8000,
      effort: 'medium',
      text: `授業後の振り返り会議（反省協議会）の文字起こしを整理し、授業者への建設的なフィードバックを作成してください。文字起こしは音声認識によるため誤変換を含みます。文脈から補って読み、発言にないことは作らないでください。

## 授業の条件
${planFacts(p.plan)}

## 参加者数
${s(p.participantCount, '不明')}名（参加者は「参加者1」などの仮名で扱います）

## 文字起こし
${clip(p.transcript, 30000)}

## 出力形式
${JSON_RULE}
{
  "meetingTitle": "会議の議題",
  "keyPoints": ["協議の要点"],
  "positives": ["良かった点（具体的な場面と教育的効果）"],
  "improvements": ["改善点（理由つき）"],
  "actionItems": ["次の授業に向けた具体的な行動"],
  "overallSummary": "全体の要約（3〜5文）",
  "aiAdvice": {
    "teacherStrengths": ["授業者の強み"],
    "improvementSuggestions": ["代替の指導法を含む具体的な提案"],
    "nextSteps": ["次のステップ"],
    "overallFeedback": "授業者の成長を促す、温かく建設的な総評（3〜5文）",
    "score": 0,
    "scoreReason": "本時のねらいに対する達成度を100点満点で評価した理由（3〜5文）"
  }
}
score は 0〜100 の整数です。`,
    };
  },

  // ── 児童生徒ノートの分析（画像） ──
  analyzeNote(p) {
    const img = image(p.image);
    const blocks = [];
    if (img) blocks.push(img);
    blocks.push({
      type: 'text',
      text: `添付はある児童生徒のノートの写真です。記述・計算過程・図・メモから思考の流れを読み取り、本時のねらいに照らして理解度を評価してください。読み取れない部分は推測で埋めず「判読できない」と書きます。

## 授業の条件
${planFacts(p.plan)}

## 対象
${s(p.studentLabel, '生徒1')}
${p.speech ? `\n## この児童生徒の発言記録（教員または本人が記録）\n${clip(p.speech, 3000)}\n` : ''}${p.transcript ? `\n## 授業全体の文脈（会議の文字起こし。誰の発言か特定できないものは個人の思考として扱わない）\n${clip(p.transcript, 6000)}\n` : ''}
## 出力形式
${JSON_RULE}
{
  "thinkingProcess": {
    "steps": [ { "order": 1, "label": "短い見出し", "description": "この段階でどう考えたか", "type": "understanding" } ],
    "summary": "思考過程の要約"
  },
  "score": 0,
  "feedback": "本人に返す、具体的で前向きなフィードバック",
  "analysis": {
    "strengths": ["強み"],
    "weaknesses": ["課題"],
    "comprehensionLevel": "high",
    "noteQuality": "good",
    "keyObservations": "教員向けの主な観察事項"
  }
}
type は understanding / application / analysis / creation / confusion のいずれか。score は 0〜100 の整数。comprehensionLevel は high / medium / low。noteQuality は excellent / good / fair / poor。`,
    });
    return { maxTokens: 6000, effort: 'medium', content: blocks };
  },

  // ── 授業観察・行動分析（画像） ──
  behavior(p) {
    const blocks = (p.images || []).slice(0, 4).map(image).filter(Boolean);
    blocks.push({
      type: 'text',
      text: `添付は授業中の教室の写真です。写真から観察できる行動（挙手、ノートを取る、話し合いに参加する、姿勢や視線など）に基づき、学習意欲と学習態度を補助的に評価してください。
写真から個人を特定することはしません。どの児童生徒がどこに写っているかは分からない前提で、教室全体やグループの様子から読み取れる範囲を各人の参考評価とし、observations にその限界（「写真からは個別の特定はできないため全体傾向に基づく」等）を正直に書いてください。外見・属性による評価は行いません。

## 授業の条件
${planFacts(p.plan)}

## 評価対象（仮名）
${(p.students || []).map((n, i) => `${i + 1}. ${n}`).join('\n')}

## 出力形式
${JSON_RULE}
{
  "evaluations": [
    { "studentName": "生徒1", "motivationScore": 0, "attitudeScore": 0, "observations": "観察された具体的な行動", "strengths": "良い点", "improvements": "今後の支援の方向" }
  ],
  "overallFeedback": "学級全体の意欲・態度について教員へのフィードバック（3〜5文）"
}
studentName は渡された仮名をそのまま使い、全員分を出力します。スコアは 0〜100 の整数。`,
    });
    return { maxTokens: 8000, effort: 'medium', content: blocks };
  },

  // ── 特別支援：個別評価と支援の案内 ──
  specialNeeds(p) {
    return {
      maxTokens: 5000,
      effort: 'medium',
      text: `特別な支援を要する児童生徒1名について、本時の授業での理解の状況を個別に見立て、担任への助言を作成してください。
これは教育的な見立てであり医学的診断ではありません。診断名の推定や断定はせず、必要に応じて特別支援教育コーディネーターや専門機関との連携を促します。

## 授業の条件
${planFacts(p.plan)}

## 指導案の流れ
${planBody(p.plan)}

## 対象
${s(p.studentLabel, '生徒1')}
教員が把握している特性: ${s(p.disabilityType, '詳細不明')}
${p.noteSummary ? `\n## ノート分析の結果\n${clip(p.noteSummary, 2500)}\n` : ''}${p.behaviorSummary ? `\n## 行動観察の結果\n${clip(p.behaviorSummary, 2500)}\n` : ''}
## 出力形式
${JSON_RULE}
{
  "comprehensionScore": 0,
  "comprehensionAssessment": "本時のねらいに対する理解の状況（5〜8文）",
  "teacherAdvice": "担任への具体的な助言（5〜8文）",
  "feedback": "良い点を先に、成長のための具体的なフィードバック（3〜5文）",
  "supportStrategies": {
    "environmentalSupport": "環境面（座席・教材の工夫など）",
    "instructionalSupport": "指導面（発問・説明の工夫など）",
    "socialSupport": "対人関係面（グループ活動での配慮など）",
    "emotionalSupport": "情緒面（不安への対応・自己肯定感など）"
  }
}
comprehensionScore は 0〜100 の整数。根拠となるデータが乏しい場合は、その旨を comprehensionAssessment に明記します。`,
    };
  },

  // ── 総合評価 ──
  comprehensive(p) {
    return {
      maxTokens: 12000,
      effort: 'medium',
      text: `授業に関する記録を総合し、「本時のねらい」に対して児童生徒の思考過程と授業態度がどうであったか、教師の働きかけが有効であったかを評価してください。データがない観点は推測で埋めず、scoreBreakdown の該当項目を null にし、所見でも「データなし」と明記します。

## 授業の条件
${planFacts(p.plan)}

## 指導案の流れ
${planBody(p.plan)}

## ノート分析（思考過程）
${clip(p.notes, 9000) || 'データなし'}

## 行動観察（意欲・態度）
${clip(p.behaviors, 6000) || 'データなし'}

## 特別支援の個別評価
${clip(p.specialNeeds, 3000) || 'データなし'}

## 振り返り会議
${clip(p.reflection, 6000) || 'データなし'}

## 出力形式
${JSON_RULE}
{
  "overallScore": 0,
  "categoryScores": { "objectiveAchievement": 0, "understanding": 0, "problemSolving": 0, "communication": 0, "motivationAttitude": 0 },
  "scoreBreakdown": { "notesScore": null, "behaviorScore": null, "reflectionScore": null },
  "overallAssessment": "総合所見（5〜8文）",
  "objectiveAchievement": "ねらいの達成度の分析（5〜8文）",
  "teacherInterventionAnalysis": "教師の働きかけの有効性（5〜8文）",
  "effectiveInterventions": ["有効だった働きかけ"],
  "ineffectiveInterventions": ["改善が必要な働きかけ（理由と改善案）"],
  "studentEngagement": "意欲・態度の分析（3〜5文）",
  "thinkingQuality": "思考力・理解度の分析（3〜5文）",
  "teachingEffectiveness": "指導の効果と改善（3〜5文）",
  "strengths": ["授業の強み"],
  "improvements": ["今後の改善点"],
  "recommendations": ["推奨アクション"],
  "studentHighlights": [ { "studentName": "生徒1", "highlight": "特筆事項" } ],
  "improvementPlanSuggestions": {
    "introductionChanges": "導入の改善", "developmentChanges": "展開の改善", "conclusionChanges": "まとめの改善",
    "questioningChanges": "発問の改善", "supportChanges": "個別支援の改善", "materialChanges": "教材・教具の改善"
  }
}
スコアはすべて 0〜100 の整数です。`,
    };
  },

  // ── 教育論文・研究知見の提示 ──
  papers(p) {
    const ctx = p.query
      ? `検索キーワード: ${clip(p.query, 300)}`
      : `教科: ${s(p.subject, '')}／学年: ${s(p.grade, '')}\n単元: ${s(p.unit)}\n本時のねらい: ${s(p.objective)}`;
    return {
      maxTokens: 6000,
      effort: 'medium',
      text: `次の授業・テーマに関連が深い教育研究を5件挙げてください。

${ctx}

重要: あなたの知識の中で実在に確信が持てる、広く知られた研究・著作だけを挙げます。書誌情報（著者・年・掲載誌）に自信がない項目は、でっち上げずに空文字にし、confidence を "low" にしてください。国内外の研究をバランスよく含めます。利用者は後で原典を自分で確認します。

## 出力形式
${JSON_RULE}
{
  "papers": [
    {
      "title": "タイトル（原題。外国語の場合は日本語訳を括弧で添える）",
      "authors": "著者", "year": "出版年", "journal": "掲載誌・出版社",
      "abstract": "研究の概要（150〜200字）",
      "summary": "この授業への具体的な示唆（200字程度）",
      "keywords": ["キーワード"],
      "relevance": "高",
      "country": "主な研究国",
      "confidence": "high"
    }
  ]
}
relevance は 高 / 中 / 低。confidence は high / medium / low。`,
    };
  },

  // ── 研究の解説レポート（論文形式の文章） ──
  paperReport(p) {
    return {
      maxTokens: 9000,
      effort: 'medium',
      text: `次の研究について、教員向けの「解説レポート」を論文の章立てで書いてください。これは原論文の全文ではなく、あなたの知識に基づく解説です。原論文の具体的な数値・統計・引用文を創作してはいけません。確かでない点は「原典で確認が必要」と書きます。

タイトル: ${s(p.title)}
著者: ${s(p.authors, '不明')}／年: ${s(p.year, '不明')}／掲載: ${s(p.journal, '不明')}
概要: ${clip(p.abstract, 1500)}

## 出力形式
${JSON_RULE}
{
  "introduction": "1. 研究の背景と目的（400〜600字）",
  "literature": "2. 関連する研究の流れ（400〜600字）",
  "methodology": "3. 研究のアプローチ（300〜500字）",
  "results": "4. 主な知見（400〜600字）",
  "discussion": "5. 教育的意義と授業への活かし方（400〜600字）",
  "conclusion": "6. まとめと留意点（300〜400字）",
  "references": ["原典確認のために当たるとよい文献・検索キーワード"]
}`,
    };
  },

  // ── 指導案に基づく教材づくり（文章で返す） ──
  material(p) {
    const kinds = {
      worksheet: '児童生徒に配るワークシート（めあて・課題・考えを書く欄・振り返り欄の構成。記入欄は「＿＿＿」や空行で示す）',
      quiz: '確認用の小テスト（5〜8問。基礎から活用まで。最後に解答と採点のポイント）',
      rubric: '評価ルーブリック（観点×4段階の表。観点は指導案の評価規準に対応させる）',
      newsletter: '保護者向けの学級通信の文章（この授業で何を学び、家庭でどう声をかけるとよいか。400〜600字。個人が特定される記述はしない）',
      homework: '家庭学習の課題（15〜20分で取り組める内容。基礎・発展の2段階。ねらいを一言添える）',
      questions: '発問集（導入・展開・まとめの各場面で使える主発問と補助発問。予想される反応と切り返しも添える）',
      boardwork: '板書計画の詳細（左・中央・右の区画ごとに、書く順番・色分け・児童生徒の考えを書く場所を示す）',
    };
    return {
      maxTokens: 8000,
      effort: 'medium',
      json: false,
      text: `次の指導案に基づいて、${kinds[p.kind] || kinds.worksheet}を作成してください。
そのまま印刷・配布できる完成度で、Markdown（見出し・箇条書き・表）で書きます。前置きや解説は不要で、成果物だけを出力します。${p.note ? `\n\n教員からの追加の希望: ${clip(p.note, 800)}` : ''}

## 授業の条件
${planFacts(p.plan)}

## 指導案の流れ
${planBody(p.plan)}

## 出力言語
${langName(p.plan?.language)}`,
    };
  },

  // ── 指導案についての相談（会話） ──
  assistant(p) {
    const history = (p.messages || []).slice(-12).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: clip(m.content, 4000) }));
    return {
      maxTokens: 6000,
      effort: 'low',
      json: false,
      system: `${BASE}

あなたは教員の相談相手です。下の指導案について、質問への回答・代案の提示・時間配分の見直し・発問の磨き上げなどを手伝います。回答は要点から先に、短い段落と箇条書きで読みやすく書きます。指導案そのものを書き換えることはできないので、変更案は「どこを・どう直すか」が分かる形で示します。

## 授業の条件
${planFacts(p.plan)}

## 指導案の流れ
${planBody(p.plan)}`,
      messages: history.length ? history : [{ role: 'user', content: 'この指導案の改善点を教えてください。' }],
    };
  },
};

export function buildRequest(task, payload) {
  const make = TASKS[task];
  if (!make) return null;
  const r = make(payload || {});
  return {
    system: r.system || BASE,
    messages: r.messages || [{ role: 'user', content: r.content || r.text }],
    maxTokens: r.maxTokens || 8000,
    effort: r.effort || 'medium',
    json: r.json !== false,
  };
}
