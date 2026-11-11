// AI が未接続の時に表示する「見本」。入力内容を当てはめただけの定型文で、AIの生成結果ではない。
const v = (x, d) => (x === undefined || x === null || x === '' || (Array.isArray(x) && !x.length) ? d : Array.isArray(x) ? x.join('・') : x);

function plan(p) {
  const unit = v(p.unit, '本単元'); const goal = v(p.currentLessonObjective, v(p.unitObjective, `${unit}の内容を理解する`));
  const tools = v(p.teachingTools, '黒板'); const mats = v(p.materials, '教科書'); const format = v(p.classFormat, '一斉授業'); const theory = v(p.teachingTheory, 'アクティブラーニング');
  const total = 45 * (Number(p.teachingHours) || 1) > 50 && p.schoolType !== 'elementary' ? 50 * (Number(p.teachingHours) || 1) : (p.schoolType === 'elementary' ? 45 : 50) * (Number(p.teachingHours) || 1);
  const t = (a, b) => `${Math.round(total * a)}-${Math.round(total * b)}分`;
  return {
    title: v(p.title, `${v(p.subject, '')}「${unit}」`),
    introduction: `前時までの学習${p.priorKnowledge ? `（${p.priorKnowledge}）` : ''}を短く振り返り、本時の課題につながる場面を${tools}で提示する。児童生徒の素朴な気付きや疑問を引き出し、「${goal}」に向かうめあてを全員で確認する。`,
    development: `めあてに沿って、まず一人で考える時間を確保する。その後、${format}の形で考えを伝え合い、${mats}を手がかりに根拠を明確にしていく。教師は机間指導で考えの違いを把握し、全体で取り上げる順序を決める。全体交流では複数の考えを比べ、共通点と相違点から本時の中心となる見方・考え方を引き出す。${theory}の考え方に基づき、教師が答えを先に示さず、児童生徒の言葉でまとめていく。${p.specialNeedsInfo ? '支援を要する児童生徒には、手順カードと選択式のヒントを用意し、活動の見通しを持てるようにする。' : ''}`,
    conclusion: `本時の学びを児童生徒の言葉でまとめ、板書と対応させて確認する。適用問題に取り組み、振り返りを書いて次時の学習につなげる。`,
    detailedPlan: [
      { time: t(0, 0.11), activity: '既習の確認と課題の把握', teacherAction: `${tools}で課題場面を提示し、既習との違いを問う`, studentAction: '気付いたことを発表し、めあてをつかむ', materials: tools, notes: '全員が見通しを持てたかを挙手で確認する' },
      { time: t(0.11, 0.33), activity: '自力解決', teacherAction: '机間指導で考えを把握し、つまずきにはヒントカードを渡す', studentAction: '自分の考えをノートに書く', materials: mats, notes: `${theory}：まず自分の考えを持たせる` },
      { time: t(0.33, 0.55), activity: 'ペア・グループでの交流', teacherAction: '話し合いの視点を示し、根拠を尋ねる', studentAction: '考えを説明し合い、違いを見つける', materials: 'ワークシート', notes: '発言が偏らないよう役割を決める' },
      { time: t(0.55, 0.78), activity: '全体での練り上げ', teacherAction: '複数の考えを板書で整理し、比較させる', studentAction: '共通点・相違点を話し合い、よりよい考えをまとめる', materials: tools, notes: '児童生徒の言葉を生かして板書する' },
      { time: t(0.78, 0.9), activity: '適用・定着', teacherAction: '適用問題を提示し、個別に支援する', studentAction: '学んだ方法を使って問題を解く', materials: mats, notes: '早く終えた児童生徒には発展問題を用意する' },
      { time: t(0.9, 1), activity: 'まとめと振り返り', teacherAction: '本時の学びを確認し、次時を予告する', studentAction: '振り返りを書き、学びを言葉にする', materials: 'ノート', notes: '振り返りの視点を2つ示す' },
    ],
    evaluationCriteria: [
      `【知識・技能】${goal}`,
      '【思考・判断・表現】自分の考えを根拠とともに説明している',
      '【主体的に学習に取り組む態度】友達の考えを聞き、自分の考えを見直そうとしている',
      '【知識・技能】既習事項と本時の内容を関連付けて理解している',
    ],
    boardPlan: `【左】日付・単元名「${unit}」／めあて\n【中央】課題場面と児童生徒の考え（考えA・考えB を並べて比較）\n【右】まとめ（児童生徒の言葉で）／適用問題／振り返りの視点`,
  };
}

const MATERIAL = {
  worksheet: (p, u, g) => `# ワークシート「${u}」\n\n　　年　　組　　番　名前＿＿＿＿＿＿＿＿\n\n## めあて\n${g}\n\n## 1. まず自分で考えよう\n＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿\n\n＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿\n\n## 2. 友達の考えをメモしよう\n| 友達の考え | なるほどと思ったところ |\n|---|---|\n| 　 | 　 |\n| 　 | 　 |\n\n## 3. まとめ\n＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿\n\n## 4. ふりかえり\n- 今日わかったこと：＿＿＿＿＿＿＿＿＿＿＿＿\n- もっと知りたいこと：＿＿＿＿＿＿＿＿＿＿＿`,
  quiz: (p, u) => `# 確認テスト「${u}」\n\n1. 今日の学習で使った大切な言葉を1つ書きましょう。\n2. めあてについて、自分の言葉で説明しましょう。\n3. 基本問題（教科書の例題と同じ型）\n4. 基本問題（数値や場面を変えたもの）\n5. 活用問題（理由も書きましょう）\n\n---\n## 解答と採点のポイント\n- 1〜2：用語の正確さよりも、意味を捉えているかを見る\n- 3〜4：手順が正しければ部分点\n- 5：結論と理由の両方が書けていて満点`,
  rubric: (p, u, g) => `# 評価ルーブリック「${u}」\n\n| 観点 | A（十分満足） | B（おおむね満足） | C（努力を要する） | 支援の手立て |\n|---|---|---|---|---|\n| 知識・技能 | ${g}ことが正確にでき、説明もできる | ${g} | 手順の一部につまずきがある | 手順カードで確認する |\n| 思考・判断・表現 | 複数の根拠を挙げて説明している | 根拠を1つ挙げて説明している | 結論だけを述べている | 「なぜ？」と問い返す |\n| 主体的に学習に取り組む態度 | 友達の考えを取り入れて考えを深めている | 友達の考えを聞いて見直している | 自分の考えに留まっている | ペアで話す場を設ける |`,
  newsletter: (p, u, g) => `# 学級通信　授業のようす\n\n今週は「${u}」の学習に取り組みました。この時間のめあては「${g}」です。\n\n授業では、まず一人ひとりが自分の考えをノートに書き、その後ペアやグループで伝え合いました。友達の考えを聞いて「そういう考え方もあるのか」と自分の考えを見直す姿がたくさん見られました。\n\n## ご家庭で\n- 「今日はどんなことを考えたの？」と聞いてみてください。正解かどうかよりも、考えた道筋を話せることが大切です。\n- 身の回りで学習とつながる場面を見つけたら、ぜひ話題にしてみてください。`,
  homework: (p, u, g) => `# 家庭学習「${u}」（めやす15〜20分）\n\nねらい：${g}\n\n## 基礎（全員）\n1. 今日のまとめをノートに写し、声に出して読む\n2. 教科書の練習問題を3問解く\n\n## 発展（できる人）\n3. 今日の学習を使って、自分で問題を1つ作る\n4. 作った問題の答えと、解き方の説明を書く`,
  questions: (p, u, g) => `# 発問集「${u}」\n\n## 導入\n- **主発問**：これまでに学習したことと、どこが違いますか。\n  - 予想される反応：「〜が違う」「前のやり方ではできない」\n  - 切り返し：「では、どうすればできそうですか」\n\n## 展開\n- **主発問**：${g}ために、どのように考えればよいでしょう。\n  - 補助発問：「どこに注目しましたか」「なぜそう言えますか」\n  - 切り返し：「Aさんの考えとBさんの考え、似ているところはどこですか」\n\n## まとめ\n- **主発問**：今日の学習で大切だったことは何ですか。\n  - 補助発問：「次に同じような問題が出たら、まず何をしますか」`,
  boardwork: (p, u, g) => `# 板書計画「${u}」\n\n| 区画 | 書く内容 | 順番 | 色 |\n|---|---|---|---|\n| 左 | 日付・単元名・めあて「${g}」 | 1 | 白／めあては黄で囲む |\n| 中央上 | 課題場面（掲示または投影） | 2 | 白 |\n| 中央下 | 児童生徒の考え A・B（名前マグネット） | 3 | 白／大切な言葉は赤 |\n| 右上 | まとめ（児童生徒の言葉で） | 4 | 赤で囲む |\n| 右下 | 適用問題・振り返りの視点 | 5 | 白 |`,
};

export function demo(task, p = {}) {
  const pl = p.plan || p; const unit = v(pl.unit, '本単元'); const goal = v(pl.currentLessonObjective, v(pl.unitObjective, '本時のねらいを達成する'));
  switch (task) {
    case 'generatePlan': return plan(p);
    case 'improvePlan': {
      const base = { ...plan(p.plan || {}), ...(p.plan?.generatedContent || {}) };
      return { ...base, development: `${base.development}\n【改善】全体交流の前に、考えを比べる視点（共通点・相違点）を明示し、発言が一部の児童生徒に偏らないよう指名計画を立てる。`, conclusion: `${base.conclusion}\n【改善】振り返りの時間を確実に確保するため、適用問題を2問から1問に絞る。`, improvementSummary: '全体交流に比較の視点を加え、まとめと振り返りの時間を確保するよう時間配分を見直しました。（これは見本です。AIを接続すると、振り返りや評価の内容に基づいて作り直されます）' };
    }
    case 'reflection': return {
      meetingTitle: `「${unit}」授業の振り返り`, keyPoints: ['めあての提示と課題把握の流れ', '交流場面での児童生徒の発言の質', 'まとめと振り返りの時間配分'],
      positives: ['導入で既習事項を想起させたことで、全員が課題に取り組めていた', '児童生徒の言葉を板書に生かしていた'], improvements: ['全体交流で発言が一部に偏ったため、ペアでの確認を挟むとよい', '振り返りの時間が不足した'],
      actionItems: ['次時は交流の視点を板書に示す', '適用問題を1問に絞り、振り返りを5分確保する'], overallSummary: 'ねらいに沿った授業展開であったが、交流の深まりと時間配分に改善の余地があることが確認された。',
      aiAdvice: { teacherStrengths: ['児童生徒の考えを丁寧に受け止める姿勢', '既習と新出をつなぐ導入'], improvementSuggestions: ['比較の視点を先に示してから交流に入る', '指名計画を机間指導の間に立てる'], nextSteps: ['次時の導入で本時の振り返りを紹介する'], overallFeedback: '児童生徒の考えを大切にする授業でした。交流の視点を明確にすると、さらに深い学びにつながります。', score: 78, scoreReason: 'これは見本の点数です。AIを接続すると、文字起こしの内容に基づいて評価します。' },
    };
    case 'analyzeNote': return {
      thinkingProcess: { steps: [
        { order: 1, label: '課題をつかむ', description: '問題場面を自分の言葉で書き直し、分かっていることを整理している', type: 'understanding' },
        { order: 2, label: '既習を使う', description: '前時の方法を当てはめようとしている', type: 'application' },
        { order: 3, label: '迷い', description: '途中で消した跡があり、方法を見直している', type: 'confusion' },
        { order: 4, label: 'まとめる', description: '友達の考えを取り入れて結論を書いている', type: 'analysis' },
      ], summary: '既習を手がかりに自力で考え、迷いながらも交流を通して考えを修正している。' },
      score: 72, feedback: '自分の考えを最後まで書けています。迷ったところを消さずに残すと、考えの変化がもっとよく分かります。',
      analysis: { strengths: ['考えの道筋を書いている', '友達の考えを取り入れている'], weaknesses: ['理由の説明が短い'], comprehensionLevel: 'medium', noteQuality: 'good', keyObservations: 'これは見本です。AIを接続すると、ノートの写真を実際に読み取って分析します。' },
    };
    case 'behavior': return {
      evaluations: (p.students?.length ? p.students : ['生徒1', '生徒2', '生徒3']).map((n, i) => ({ studentName: n, motivationScore: 70 + ((i * 7) % 25), attitudeScore: 68 + ((i * 11) % 27), observations: '写真からは個別の特定はできないため、学級全体の傾向に基づく参考評価です。', strengths: '話し合いに参加している様子が見られる', improvements: '発言の機会を意図的に設ける' })),
      overallFeedback: '学級全体として前向きに活動に参加している様子です。（これは見本です。AIを接続すると写真を実際に読み取ります）',
    };
    case 'specialNeeds': return {
      comprehensionScore: 65, comprehensionAssessment: '手順が示されている場面では安定して取り組めている。一方で、複数の指示が続く場面では活動が止まりやすい。記録が少ないため、継続的な観察が必要である。（これは見本です）',
      teacherAdvice: '指示は一つずつ、視覚的な手がかりと合わせて伝える。活動の終わりを明確に示し、できたことをその場で具体的に認める。必要に応じて特別支援教育コーディネーターと情報を共有する。',
      feedback: '最後まで課題に取り組もうとする姿が見られました。次は、困った時に合図を出す方法を一緒に決めましょう。',
      supportStrategies: { environmentalSupport: '前方で刺激の少ない座席。手順カードを机上に置く。', instructionalSupport: '指示は短く一つずつ。見本を示してから取り組ませる。', socialSupport: 'グループでは役割を明確にし、得意な役割を任せる。', emotionalSupport: '見通しを事前に伝え、できたことを具体的に認める。' },
    };
    case 'comprehensive': return {
      overallScore: 76, categoryScores: { objectiveAchievement: 78, understanding: 74, problemSolving: 72, communication: 80, motivationAttitude: 77 },
      scoreBreakdown: { notesScore: p.notes ? 72 : null, behaviorScore: p.behaviors ? 77 : null, reflectionScore: p.reflection ? 78 : null },
      overallAssessment: `「${goal}」というねらいに対し、多くの児童生徒が見通しを持って取り組んでいた。（これは見本です。AIを接続すると、集めた記録に基づいて評価します）`,
      objectiveAchievement: 'ねらいはおおむね達成されたが、理由を説明する場面で差が見られた。', teacherInterventionAnalysis: '導入の課題提示は有効だった。全体交流では比較の視点が不明確で、深まりが限定的だった。',
      effectiveInterventions: ['既習を想起させる導入', '机間指導での個別の声かけ'], ineffectiveInterventions: ['全体交流の進め方（視点を先に示すと改善できる）'],
      studentEngagement: '意欲的に取り組む姿が多く見られた。', thinkingQuality: '手順の理解は良好。理由の説明に課題がある。', teachingEffectiveness: '時間配分を見直すと、振り返りの質が高まる。',
      strengths: ['児童生徒の言葉を生かした板書', '安心して発言できる雰囲気'], improvements: ['交流の視点の明示', '振り返りの時間の確保'], recommendations: ['次時の導入で本時の振り返りを共有する', '説明の型（結論→理由）を掲示する'],
      studentHighlights: [], improvementPlanSuggestions: { introductionChanges: '課題提示を短くし、めあての共有を早める', developmentChanges: '比較の視点を示してから交流に入る', conclusionChanges: '振り返りに5分を確保する', questioningChanges: '「なぜ」を問う補助発問を用意する', supportChanges: 'ヒントカードを段階別に用意する', materialChanges: 'ワークシートに説明の型を載せる' },
    };
    case 'papers': return { papers: [
      { title: 'Mind in Society（精神の社会的形成）', authors: 'L. S. Vygotsky', year: '1978', journal: 'Harvard University Press', abstract: '学習は他者との相互作用を通じて進むとし、「最近接発達領域」の概念を示した古典的著作。', summary: 'ペアやグループでの交流を、単なる活動ではなく「一人ではできないことを支援によってできるようにする場」として設計する根拠になる。', keywords: ['最近接発達領域', '社会的構成主義'], relevance: '高', country: 'ロシア／米国', confidence: 'high' },
      { title: 'Inside the Black Box: Raising Standards Through Classroom Assessment', authors: 'P. Black, D. Wiliam', year: '1998', journal: 'Phi Delta Kappan', abstract: '形成的評価が学力向上に大きく寄与することを、多数の研究のレビューから示した論考。', summary: '授業中の見取りとフィードバックを、評価規準と結び付けて計画する際の拠り所になる。', keywords: ['形成的評価', 'フィードバック'], relevance: '高', country: '英国', confidence: 'high' },
      { title: 'Visible Learning（学習に何が最も効果的か）', authors: 'J. Hattie', year: '2009', journal: 'Routledge', abstract: '800以上のメタ分析を統合し、学力に影響する要因の効果量を整理した。', summary: 'フィードバック、教師の明確さ、相互教授など、効果の大きい要因を授業設計の優先順位付けに使える。', keywords: ['メタ分析', '効果量'], relevance: '中', country: 'ニュージーランド／豪州', confidence: 'high' },
    ] };
    case 'paperReport': return { introduction: `「${v(p.title, 'この研究')}」の背景と目的の解説がここに入ります。（これは見本です。AIを接続すると解説レポートを作成します）`, literature: '関連する研究の流れの解説。', methodology: '研究のアプローチの解説。', results: '主な知見の解説（具体的な数値は原典で確認が必要）。', discussion: '教育的意義と授業への活かし方。', conclusion: 'まとめと留意点。', references: ['原典を図書館・CiNii・Google Scholar で確認してください'] };
    case 'material': return `${(MATERIAL[p.kind] || MATERIAL.worksheet)(pl, unit, goal)}\n\n---\n（これは見本です。AIを接続すると、指導案の内容に合わせて作成します）`;
    case 'assistant': return `ご質問ありがとうございます。\n\n**いまは見本の返答です。** AI（Claude）を接続すると、この指導案の内容を踏まえて具体的にお答えします。\n\n接続前でも確認できるポイント：\n- めあて「${goal}」が、導入の最後までに全員に伝わる流れになっているか\n- 交流の前に「何を比べるか」が示されているか\n- 振り返りの時間が5分以上確保されているか`;
    default: return {};
  }
}
