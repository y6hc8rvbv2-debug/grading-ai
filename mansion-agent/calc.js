// 給与・社会保険の計算（画面から独立。Node でもテストできる）
'use strict';
(function (root) {
  // 標準報酬月額表 [標準報酬月額, この金額未満]
  const STD = [
    [58000, 63000], [68000, 73000], [78000, 83000], [88000, 93000], [98000, 101000],
    [104000, 107000], [110000, 114000], [118000, 122000], [126000, 130000], [134000, 138000],
    [142000, 146000], [150000, 155000], [160000, 165000], [170000, 175000], [180000, 185000],
    [190000, 195000], [200000, 210000], [220000, 230000], [240000, 250000], [260000, 270000],
    [280000, 290000], [300000, 310000], [320000, 330000], [340000, 350000], [360000, 370000],
    [380000, 395000], [410000, 425000], [440000, 455000], [470000, 485000], [500000, 515000],
    [530000, 545000], [560000, 575000], [590000, 605000], [620000, 635000], [650000, 665000],
    [680000, 695000], [710000, 730000], [750000, 770000], [790000, 810000], [830000, 855000],
    [880000, 905000], [930000, 955000], [980000, 1005000], [1030000, 1055000], [1090000, 1115000],
    [1150000, 1175000], [1210000, 1235000], [1270000, 1295000], [1330000, 1355000], [1390000, Infinity],
  ];

  function stdHealth(pay) {
    for (const [s, lim] of STD) if (pay < lim) return s;
    return 1390000;
  }
  function stdPension(pay) {
    return Math.min(650000, Math.max(88000, stdHealth(pay)));
  }
  // 被保険者負担の端数：50銭以下切り捨て、50銭を超えたら切り上げ
  function r50(x) {
    const f = Math.floor(x);
    return x - f > 0.5 ? f + 1 : f;
  }
  function n(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }

  // 源泉所得税（月額表・甲欄を電子計算機特例の式で計算）
  function withholding(A, deps, r) {
    A = Math.floor(n(A));
    if (A <= 0) return 0;
    let k;
    if (A <= 158333) k = r.taxKyuyoMin;
    else if (A <= 299999) k = Math.ceil(A * 0.3 + 6667);
    else if (A <= 549999) k = Math.ceil(A * 0.2 + 36667);
    else if (A <= 708330) k = Math.ceil(A * 0.1 + 91667);
    else k = 162500;
    const B = Math.floor(A - k - r.taxKiso - r.taxFuyo * n(deps));
    if (B <= 0) return 0;
    let t;
    if (B <= 162500) t = B * 0.05105;
    else if (B <= 275000) t = B * 0.1021 - 8296;
    else if (B <= 579166) t = B * 0.2042 - 36374;
    else if (B <= 750000) t = B * 0.23483 - 54113;
    else if (B <= 1500000) t = B * 0.33693 - 130688;
    else if (B <= 3333333) t = B * 0.4084 - 237893;
    else t = B * 0.45945 - 408061;
    return Math.max(0, Math.round(t / 10) * 10);
  }

  function ageAt(birth, ym) {
    if (!/^\d{4}-\d{2}$/.test(birth || '')) return null;
    const [by, bm] = birth.split('-').map(Number);
    const [y, m] = ym.split('-').map(Number);
    return y - by - (m < bm ? 1 : 0);
  }

  function schedDays(emp) { return Math.round(n(emp.weeklyDays) * 52 / 12); }
  function schedHours(emp) {
    return emp.payType === 'monthly' ? n(emp.monthlyHours) || 173 : Math.round(n(emp.weeklyHours) * 52 / 12);
  }
  function expectedMonthly(emp) {
    const base = emp.payType === 'hourly' ? n(emp.base) * n(emp.weeklyHours) * 52 / 12 : n(emp.base);
    return Math.round(base + n(emp.allowance) + n(emp.commute));
  }
  function eligibility(emp, r) {
    return {
      shaho: emp.shahoOverride === 'yes' || (emp.shahoOverride !== 'no' && n(emp.weeklyHours) >= r.shahoHours),
      koyo: n(emp.weeklyHours) >= r.koyoHours,
    };
  }
  function hourlyUnit(emp) {
    return emp.payType === 'hourly' ? n(emp.base) : (n(emp.base) + n(emp.allowance)) / (n(emp.monthlyHours) || 173);
  }
  function defaultAttendance(emp) {
    return {
      days: schedDays(emp),
      hours: emp.payType === 'hourly' ? schedHours(emp) : 0,
      ot: 0, night: n(emp.nightHoursDefault), holiday: 0, absent: 0,
      resTax: n(emp.residentTax), otherDed: 0,
    };
  }

  function payroll(emp, att, r, ym) {
    att = Object.assign(defaultAttendance(emp), att || {});
    const unit = hourlyUnit(emp);
    const hourly = emp.payType === 'hourly';
    const basePay = hourly ? Math.round(n(emp.base) * n(att.hours)) : n(emp.base);
    const absentDed = hourly ? 0 : Math.round((n(emp.base) + n(emp.allowance)) / Math.max(1, schedDays(emp)) * n(att.absent));
    const otPay = Math.round(unit * 1.25 * n(att.ot));
    const nightPay = Math.round(unit * 0.25 * n(att.night));
    const holPay = Math.round(unit * 1.35 * n(att.holiday));
    const commute = n(emp.commute);
    const gross = basePay + n(emp.allowance) + otPay + nightPay + holPay - absentDed + commute;

    const el = eligibility(emp, r);
    const std = el.shaho ? (n(emp.stdOverride) || stdHealth(expectedMonthly(emp))) : 0;
    const stdP = el.shaho ? stdPension(std) : 0;
    const age = ageAt(emp.birth, ym);
    const kaigo = el.shaho && age !== null && age >= 40 && age < 65;
    const hRate = r.healthPct + (kaigo ? r.kaigoPct : 0);
    const healthAll = std * hRate / 100, pensionAll = stdP * r.pensionPct / 100, shienAll = std * r.kodomoShienPct / 100;
    const health = r50(healthAll / 2), pension = r50(pensionAll / 2), shien = r50(shienAll / 2);
    const koyo = el.koyo ? r50(gross * r.koyoEmpPerMil / 1000) : 0;
    const social = health + pension + shien + koyo;
    const taxable = Math.max(0, gross - Math.min(commute, 150000) - social);
    const tax = withholding(taxable, emp.dependents, r);
    const deductions = social + tax + n(att.resTax) + n(att.otherDed);
    const net = gross - deductions;

    const erShaho = Math.round(healthAll - health + pensionAll - pension + shienAll - shien + stdP * r.kodomoKyoshutsuPct / 100);
    const erKoyo = el.koyo ? Math.floor(gross * r.koyoErPerMil / 1000) : 0;
    const erRosai = Math.floor(gross * r.rosaiPerMil / 1000);
    const employerCost = gross + erShaho + erKoyo + erRosai;

    const warn = [];
    if (unit < r.minWage) warn.push(`時間あたり ${Math.floor(unit)}円 が最低賃金（${r.minWage}円）を下回っています`);
    if (n(att.ot) > 0 && !emp.agreement36) warn.push('残業があります。36協定の届出が必要です');
    if (!emp.birth && el.shaho) warn.push('生年月が未入力のため、介護保険料（40〜64歳）を計算していません');

    return {
      att, unit, basePay, absentDed, otPay, nightPay, holPay, commute, gross,
      el, std, stdP, kaigo, age, health, pension, shien, koyo, social, taxable, tax,
      resTax: n(att.resTax), otherDed: n(att.otherDed), deductions, net,
      erShaho, erKoyo, erRosai, employerCost, warn,
    };
  }

  // 有給休暇の付与日数（勤続年数・週の勤務日数）
  const PAID = {
    5: [10, 11, 12, 14, 16, 18, 20], 4: [7, 8, 9, 10, 12, 13, 15], 3: [5, 6, 6, 8, 9, 10, 11],
    2: [3, 4, 4, 5, 6, 6, 7], 1: [1, 2, 2, 2, 3, 3, 3],
  };
  function paidLeave(emp, today) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(emp.hireDate || '')) return null;
    const hire = new Date(emp.hireDate + 'T00:00:00');
    const first = new Date(hire); first.setMonth(first.getMonth() + 6);
    const wd = n(emp.weeklyHours) >= 30 ? 5 : Math.min(5, Math.max(1, Math.round(n(emp.weeklyDays))));
    if (today < first) return { days: 0, next: first, nextDays: PAID[wd][0] };
    let idx = 0; const grant = new Date(first);
    while (true) {
      const nx = new Date(grant); nx.setFullYear(nx.getFullYear() + 1);
      if (nx > today) break;
      grant.setTime(nx.getTime()); idx++;
    }
    const nextGrant = new Date(grant); nextGrant.setFullYear(nextGrant.getFullYear() + 1);
    return { days: PAID[wd][Math.min(6, idx)], granted: grant, next: nextGrant, nextDays: PAID[wd][Math.min(6, idx + 1)] };
  }

  const api = { stdHealth, stdPension, r50, withholding, payroll, paidLeave, defaultAttendance, expectedMonthly, eligibility, schedHours, schedDays };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
