// 共有リンクで開いた指導案（リンクの中に内容が入っている。サーバーには保存されない）
import { useMemo } from 'react';
import LZString from 'lz-string';
import { Download, Printer, FilePlus2 } from 'lucide-react';
import { useStore, db } from '../lib/store.js';
import { navigate, href } from '../lib/router.js';
import { printPlan, exportPlan } from '../lib/exporters.js';
import { schoolLabel } from '../lib/util.js';
import { Button, Card, Badge, Notice, toast } from '../ui.jsx';
import { PlanMeta, PlanBody } from './PlanView.jsx';

export default function Shared({ data }) {
  const profile = useStore((s) => s.profile);
  const ready = useStore((s) => s.ready);
  const plan = useMemo(() => { try { return JSON.parse(LZString.decompressFromEncodedURIComponent(data || '')); } catch { return null; } }, [data]);
  if (!plan) return <div className="max-w-xl mx-auto p-8"><Notice tone="bad">共有リンクが壊れているか、途中で切れています。送り主にもう一度送ってもらってください。</Notice></div>;
  const save = () => { const { id, createdAt, updatedAt, ...rest } = plan; const p = db.add('plans', { ...rest, tags: [...(rest.tags || []), '共有'], bookmarked: false }); toast('自分の指導案に保存しました'); navigate(`/plans/${p.id}`); };
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-2 mb-6 no-print"><a href={href('/')} className="font-display font-bold">授業スタジオ</a><Badge>共有された指導案</Badge></div>
      <div className="flex flex-col md:flex-row md:items-end gap-4 mb-6">
        <div className="flex-1"><div className="flex gap-1.5 mb-2"><Badge tone="brand">{plan.subject}</Badge><Badge>{[schoolLabel(plan.schoolType), plan.grade && `${plan.grade}年`].filter(Boolean).join(' ')}</Badge></div><h1 className="text-3xl font-bold">{plan.title}</h1></div>
        <div className="flex flex-wrap gap-2 no-print">
          <Button variant="outline" icon={Printer} onClick={() => { try { printPlan(plan); } catch (e) { toast(e.message, 'bad'); } }}>印刷</Button>
          <Button variant="outline" icon={Download} onClick={() => exportPlan(plan, 'docx').catch((e) => toast(e.message, 'bad'))}>Word</Button>
          {ready && profile ? <Button icon={FilePlus2} onClick={save}>自分の指導案に保存</Button> : <Button icon={FilePlus2} onClick={() => navigate('/')}>授業スタジオを使ってみる</Button>}
        </div>
      </div>
      <Card className="p-5 mb-6"><PlanMeta p={plan} /></Card>
      <PlanBody c={plan.generatedContent} />
    </div>
  );
}
