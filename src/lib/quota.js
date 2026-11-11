// 「今月あと何件AIで指導案を作れるか」の計算
import { db, getState, monthKey, trialInfo } from './store.js';
import { planOf } from './options.js';

export function quota(state = getState()) {
  const profile = state.profile;
  const plan = planOf(profile?.plan);
  const used = state.usage?.[monthKey()] || 0;
  const trial = trialInfo(profile);
  const left = trial.expired ? 0 : plan.limit === Infinity ? Infinity : Math.max(0, plan.limit - used);
  return { plan, used, left, limit: plan.limit, trial };
}
export function countUsage() {
  const s = getState();
  db.set('usage', { ...(s.usage || {}), [monthKey()]: (s.usage?.[monthKey()] || 0) + 1 });
}
