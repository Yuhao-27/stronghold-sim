"use strict";
/* ============ 属性 / DPS 计算引擎 ============
   数据：stats.js（PRTS 原型 / 本体页面的属性、天赋、技能、模组）
   规则：明日方舟通用公式
     攻击力 = (基础 + 固定加成) × (1 + Σ百分比加成) × Π(攻击力提升至X%)
     攻击间隔 = (基础间隔 + 间隔修正) ÷ (攻速/100)，攻速 = 100 + Σ攻速，限制在 10~600
     物理伤害 = max(攻击 − 防御, 5%攻击)；法术伤害 = max(攻击 × (1 − 法抗/100), 5%攻击)
     伤害倍率：同一来源取最大，不同来源相乘
*/
const CALC = (() => {
const ST = window.STATS;
// 各阶模拟配置（来自 PRTS「模拟配置」，与用户确认一致）
const TIERCFG = {
  "Ⅰ":{init:{e:1,lv:55,sk:4,mod:0}, elite:{e:2,lv:50,sk:7,mod:1}},
  "Ⅱ":{init:{e:1,lv:60,sk:4,mod:0}, elite:{e:2,lv:55,sk:7,mod:1}},
  "Ⅲ":{init:{e:2,lv:1, sk:4,mod:0}, elite:{e:2,lv:60,sk:7,mod:1}},
  "Ⅳ":{init:{e:2,lv:1, sk:4,mod:0}, elite:{e:2,lv:60,sk:7,mod:1}},
  "Ⅴ":{init:{e:2,lv:1, sk:4,mod:0}, elite:{e:2,lv:60,sk:7,mod:1}},
  "Ⅵ":{init:{e:2,lv:1, sk:4,mod:0}, elite:{e:2,lv:60,sk:7,mod:3}},
};
const CLASSES = ["先锋","近卫","重装","狙击","术师","医疗","辅助","特种"];
const src = name => ST.src[ST.map[name]];

/* ---------- 基础属性 ---------- */
function config(u, tier){ return TIERCFG[tier][u.elite ? "elite" : "init"]; }
function baseStats(s, e, lv){
  const kf = s.kf; const notes = [];
  let E = e;
  while (E > 0 && !kf["e"+E]) { E--; }
  if (E !== e) notes.push(`该数据源没有精英${e}数据，按精英${E}满级计算`);
  const lo = E===0 ? kf.e0_1 : kf["e"+(E-1)], hi = kf["e"+E], maxLv = kf["e"+E+"_lv"] || 1;
  let L = E!==e ? maxLv : lv;
  if (L > maxLv){ notes.push(`精英${E}最高 ${maxLv} 级，按 ${maxLv} 级计算`); L = maxLv; }
  const f = maxLv > 1 ? (L-1)/(maxLv-1) : 1;
  const r = {}; ["hp","atk","def","res"].forEach(k => r[k] = Math.round(lo[k] + (hi[k]-lo[k])*f));
  return {stats:r, e:E, lv:L, notes};
}

/* ---------- 文本解析 ---------- */
const CN = {"一":1,"两":2,"二":2,"三":3,"四":4,"五":5};
const toN = x => CN[x] ?? +x;
const subLayers = (text, L) => text.replace(/\(([-\d.]+)([+-])([\d.]+)×层数\)/g, (s,a,op,b) => {
  const v = op==="+" ? +a + +b*L : +a - +b*L; return String(Math.round(v*100)/100);
});
const STATW = {"攻击力":"atk","生命值":"hp","生命上限":"hp","最大生命值":"hp","生命力":"hp","防御力":"def","基础攻击力":"atkB","基础生命上限":"hpB"};
const CONDRE = /时|后|期间|每次|每有|每秒|每击倒|每阻挡|首次|若|当|如果|内|阻挡|被击倒|击倒|叠加/;
const ANGLE_OK = /^<(战斗中|在场\d+名[^>]*|达到\d+层|首次到达\d+层)>/;

function emptyMods(){ return {atkP:0,atkF:0,hpP:0,hpF:0,defP:0,defF:0,res:0,aspd:0,itv:0,dmg:[],atkMul:1,defIgnP:0,resIgnP:0,defIgnF:0,resIgnF:0,spRegen:0,spCostP:0,initSp:0,extra:[],weak:false,enemyResF:0,enemyDefP:0,dot:[]}; }

/* 解析一段效果文本 → [{mods, cond, skillOnly, desc}]，一个 seg 内的条件项合并为一个开关 */
function parseSegment(seg, ctx){
  // ctx: {layersOf(name), equipCount}
  let t = seg.replace(/【(?:基础|进阶|基础&进阶)】/g, "");
  const out = [];
  const push = (m, cond, skillOnly, desc, defOn) => out.push(defOn ? {m, cond, skillOnly, desc, defOn} : {m, cond, skillOnly, desc});
  // 「每次攻击时/后 +X，最多叠加 N 次」：打领袖时一直打同一个目标，几秒就叠满，默认按叠满算
  const atkStack = (idx, cond, st) => cond && st.mul > 1 && /(?:攻击|治疗)(?:时|后)/.test(prefixOf(idx).split(/[，；]/).pop()) ? "stack" : false;
  // 每叠加N层 系数
  let factor = 1, factorDesc = "";
  const fm = t.match(/((?:【[^】]+】)+)(?:盟约)?每叠加(\d+)层/);
  if (fm){
    const names = [...fm[1].matchAll(/【([^】]+)】/g)].map(x=>x[1]);
    const sum = names.reduce((a,n)=>a+(ctx.layersOf(n)||0),0);
    factor = Math.floor(sum / +fm[2]);
    factorDesc = `（${names.join("+")} ${sum} 层 → ×${factor}）`;
  }
  const em = t.match(/每携带1件装备/);
  if (em){ factor = ctx.equipCount; factorDesc = `（携带 ${factor} 件装备）`; }
  const scan = (re, fn) => { for (const m of t.matchAll(re)) fn(m); };
  const prefixOf = idx => {
    let p = t.slice(0, idx).replace(/<战斗中>|在场时|每叠加\d+层|每携带1件装备|携带装备的/g, "");
    if (ctx.skill) p = p.replace(/开启技能时|技能开启时|开启时|技能期间|技能持续期间|之后|随后|立即[^，；]*/g, "");
    return p;
  };
  const isCond = (idx, len) => {
    const p = prefixOf(idx);
    if (/<[^>]+>/.test(p.replace(/<(在场\d+名[^>]*|达到\d+层|首次到达\d+层)>/g,""))) return true;
    if (CONDRE.test(p.replace(/技能期间|技能持续期间|处于技能期间/g,""))) return true;
    const after = t.slice(idx+len, idx+len+30);
    if (/^[^，；]*?(最多|至多|最高)/.test(after)) return true;
    if (/^\s*[，,]?\s*持续[\d.]+秒/.test(after)) return true;
    return false;
  };
  const stackOf = (idx, len, val) => {
    const after = t.slice(idx+len, idx+len+40);
    let m = after.match(/^[^，；]*?(?:最多|至多)叠加(\d+)[次层]/) || after.match(/^[^；]*?（最多叠加(\d+)[次层]/) || after.match(/^[^，；]*?最高(\d+)层/);
    if (m) return {mul:+m[1], note:`叠满 ${m[1]} 次`};
    m = after.match(/^[^，；]*?（至多\s*\+?\s*([\d.]+)%?）/);
    if (m && val) return {mul:+m[1]/val, note:`取上限 ${m[1]}`};
    return {mul:1, note:""};
  };
  const skillOnlyAt = idx => /技能期间|技能持续期间|处于技能期间/.test(prefixOf(idx));
  const enemySubj = idx => { const p = prefixOf(idx); const c = p.split(/[，；]/).pop(); return /敌人/.test(c); };
  // --- 属性加减 ---
  scan(/(基础攻击力|基础生命上限|攻击力|生命值|生命上限|最大生命值|生命力|防御力)((?:(?:和|、|及)(?:攻击力|生命值|生命上限|防御力|基础生命上限))*)\s*(?:([+\-])|提升|提高|增加)(?!至)\s*([\d.]+)(%?)/g, m => {
    if (/无视[^，；]{0,6}$/.test(t.slice(0, m.index))) return;
    if (/受到/.test(t.slice(Math.max(0,m.index-6), m.index))) return;
    const names = [m[1], ...[...m[2].matchAll(/攻击力|生命值|生命上限|防御力|基础生命上限/g)].map(x=>x[0])];
    const sign = m[3]==="-" ? -1 : 1, v = sign * +m[4], pct = m[5]==="%";
    if (enemySubj(m.index)){
      if (names.includes("防御力") && sign<0 && pct){ const mm = emptyMods(); mm.enemyDefP = -v; push(mm, true, false, `敌人防御 ${v}%`); }
      return;
    }
    const cond = isCond(m.index, m[0].length), st = stackOf(m.index, m[0].length, Math.abs(v));
    const mm = emptyMods();
    names.forEach(n => {
      const k = STATW[n]; const val = v * factor * (cond ? st.mul : 1);
      if (k==="atkB") mm.atkF += val; else if (k==="hpB") mm.hpF += val;
      else if (pct) mm[k+"P"] += val; else mm[k+"F"] += val;
    });
    push(mm, cond, skillOnlyAt(m.index), `${names.join("、")}${v>=0?"+":""}${Math.round(v*factor*(cond?st.mul:1)*100)/100}${pct?"%":""}${factor!==1?factorDesc:""}${cond&&st.note?"（"+st.note+"）":""}`, atkStack(m.index, cond, st));
  });
  scan(/法术抗性\s*([+\-])\s*([\d.]+)(?!%)/g, m => {
    if (/无视[^，；]{0,8}$/.test(t.slice(0, m.index))) return;
    const v = (m[1]==="-"?-1:1) * +m[2];
    if (enemySubj(m.index)){
      const cap = t.slice(m.index).match(/至多\s*(-?[\d.]+)/);
      const mm = emptyMods(); mm.enemyResF = cap ? Math.abs(+cap[1]) : Math.abs(v);
      push(mm, true, false, `敌人法抗 -${mm.enemyResF}${cap?"（叠满）":""}`); return;
    }
    const mm = emptyMods(); mm.res = v*factor; push(mm, isCond(m.index, m[0].length), skillOnlyAt(m.index), `法抗${v>=0?"+":""}${v*factor}`);
  });
  scan(/(?:攻击速度|攻速)\s*([+\-])\s*([\d.]+)%?/g, m => {
    const v = (m[1]==="-"?-1:1) * +m[2];
    const cond = isCond(m.index, m[0].length), st = stackOf(m.index, m[0].length, Math.abs(v));
    const mm = emptyMods(); mm.aspd = v*factor*(cond?st.mul:1);
    push(mm, cond, skillOnlyAt(m.index), `攻速${v>=0?"+":""}${Math.round(mm.aspd*100)/100}${factor!==1?factorDesc:""}${cond&&st.note?"（"+st.note+"）":""}`, atkStack(m.index, cond, st));
  });
  scan(/攻击间隔[^，；。()（）]*?[(（]\s*([+\-]?[\d.]+)\s*s?\s*[)）]/g, m => {
    const mm = emptyMods(); mm.itv = +m[1]; push(mm, isCond(m.index, m[0].length), skillOnlyAt(m.index), `攻击间隔${+m[1]>=0?"+":""}${m[1]}s`);
  });
  // --- 伤害倍率 ---
  scan(/(?:伤害(?:提升|提高)至|额外提升至)\s*([\d.]+)%/g, m => {
    if (/受到的?[^，；]{0,8}$/.test(t.slice(0,m.index))) return;
    const mm = emptyMods(); mm.dmg.push(+m[1]/100); push(mm, isCond(m.index, m[0].length) || /对[^，；]*敌人/.test(t.slice(0,m.index).split(/[，；]/).pop()), skillOnlyAt(m.index), `伤害×${+m[1]/100}`);
  });
  scan(/伤害(?:额外)?(?:提高|提升|增加)(?!至)\s*([\d.]+)%/g, m => {
    if (/受到的?[^，；]{0,8}$/.test(t.slice(0,m.index))) return;
    const mm = emptyMods(); mm.dmg.push(1 + +m[1]/100); push(mm, isCond(m.index, m[0].length) || /对[^，；]*敌人|距离/.test(t.slice(0,m.index)), skillOnlyAt(m.index), `伤害×${1 + +m[1]/100}`);
  });
  scan(/攻击力提升至\s*([\d.]+)%/g, m => {
    const mm = emptyMods(); mm.atkMul = +m[1]/100; push(mm, true, skillOnlyAt(m.index), `攻击力×${+m[1]/100}`);
  });
  // --- 无视防御/法抗 ---
  scan(/无视(?:目标|其)?\s*([\d.]+)\s*(%?)\s*(?:的)?(防御力|防御|法术抗性)(?:和(法术抗性|防御力?))?/g, m => {
    const mm = emptyMods(); const v = +m[1], pct = m[2]==="%";
    [m[3], m[4]].filter(Boolean).forEach(k => {
      const isDef = /防御/.test(k);
      if (pct) mm[isDef?"defIgnP":"resIgnP"] += v; else mm[isDef?"defIgnF":"resIgnF"] += v;
    });
    push(mm, isCond(m.index, m[0].length) || /麻痹/.test(t.slice(0,m.index)), skillOnlyAt(m.index), `无视${v}${m[2]}${m[3]}${m[4]?"和"+m[4]:""}`);
  });
  // --- 技力 ---
  scan(/技力自然回复速度\s*\+\s*([\d.]+)/g, m => { const mm = emptyMods(); mm.spRegen = +m[1]*factor; push(mm, isCond(m.index, m[0].length), false, `技力回复+${Math.round(mm.spRegen*1000)/1000}/秒${factor!==1?factorDesc:""}`); });
  scan(/(?:技能开启所需技力|技力消耗)\s*-\s*([\d.]+)%/g, m => { const mm = emptyMods(); mm.spCostP = +m[1]; push(mm, isCond(m.index, m[0].length), false, `技力消耗-${m[1]}%`); });
  scan(/初始技力\s*\+\s*([\d.]+)/g, m => { const mm = emptyMods(); mm.initSp = +m[1]; push(mm, isCond(m.index, m[0].length), false, `初始技力+${m[1]}`); });
  // --- 额外伤害 ---
  const extra = (m, n, pct, type) => {
    const mm = emptyMods(); mm.extra.push({n: n ? toN(n.replace("次","")) : 1, pct:+pct, type: type==="法术"?"magic":type==="真实"?"true":"phys"});
    push(mm, isCond(m.index, m[0].length) && !/^[^，；]*?(?:每次)?(?:造成伤害|攻击)时\s*(?:额外)?\s*$/.test(prefixOf(m.index).split(/[，；]/).pop()), skillOnlyAt(m.index), `每次命中额外 ${mm.extra[0].n}×${pct}% ${type}伤害`);
  };
  scan(/(?:额外|附带|附加)(?:造成)?\s*(一次|1次|2次|两次)?\s*(?:相当于)?(?:自身)?攻击力\s*([\d.]+)%\s*的?\s*(法术|物理|真实)伤害/g, m => extra(m, m[1], m[2], m[3]));
  scan(/(?:额外|附带|附加)(?:造成)?\s*(一次|1次|2次|两次)?\s*([\d.]+)%\s*攻击力\s*的?\s*(法术|物理|真实)伤害/g, m => extra(m, m[1], m[2], m[3]));
  scan(/阻挡[^，；]*期间[，,]?\s*敌人每秒受到相当于(?:自身)?攻击力\s*([\d.]+)%\s*的?\s*(法术|物理|真实)伤害/g, m => {
    const mm = emptyMods(); mm.dot.push({pct:+m[1], type: m[2]==="法术"?"magic":m[2]==="真实"?"true":"phys"});
    push(mm, true, false, `阻挡时被阻挡的敌人每秒受到 ${m[1]}% 攻击力${m[2]}伤害`);
  });
  if (/弱点伤害/.test(t)){ const mm = emptyMods(); mm.weak = true; push(mm, false, false, "伤害转为弱点伤害（取物理/法术较高者）"); }
  return out;
}

/* ---------- 技能参数解析 ---------- */
function parseSkill(sk, rank){
  const lvKey = sk.lv[rank] ? rank : Object.keys(sk.lv).map(Number).sort((a,b)=>a-b).pop();
  const L = sk.lv[lvKey]; if (!L) return null;
  const d = L.d;
  const p = {rank:lvKey, desc:d, sp:sk.sp, trig:sk.trig, init:L.i, cost:L.c, dur:L.t,
    hitScale:100, hits:1, targets:1, burst:0, burstAll:false, type:"", noAttack:false, heal:false, charge:false};
  if (/停止攻击|不攻击/.test(d)) p.noAttack = true;
  if (/改为治疗|治疗友方/.test(d)) p.heal = true;
  let m;
  if ((m = d.match(/(?:立即|开启技能时|技能开启时|开启时)[^；]*?造成[^；]*?攻击力\s*([\d.]+)%\s*的?(物理|法术|真实)?伤害/))){
    p.burst = +m[1]; p.burstAll = /所有敌人|范围内/.test(m[0]); if (m[2]) p.burstType = m[2];
  }
  const rest = p.burst ? d.replace(m[0], "") : d;
  if ((m = rest.match(/攻击(?:造成|变为|改为)?[^，；]*?攻击力\s*([\d.]+)%\s*的?(物理|法术|真实)?(?:伤害|群体)/))){
    p.hitScale = +m[1]; if (m[2]) p.type = m[2];
  } else if ((m = rest.match(/攻击力\s*([\d.]+)%\s*的?(物理|法术|真实)伤害/))) { p.hitScale = +m[1]; p.type = m[2]; }
  if ((m = rest.match(/连续攻击\s*(\d+|两|三|四)\s*次|攻击\s*(\d+|两|三|四)\s*次/))) p.hits = toN(m[1]||m[2]);
  if ((m = rest.match(/同时攻击\s*(\d+|两|三|四|五)\s*个?(?:目标|敌人)/))) p.targets = toN(m[1]);
  if ((m = rest.match(/攻击目标数\s*\+\s*(\d+)/))) p.targets = 1 + +m[1];
  if (!p.type && /法术伤害/.test(rest)) p.type = "法术";
  if (!p.type && /真实伤害/.test(rest)) p.type = "真实";
  if (!p.type && /物理伤害/.test(rest) && p.hitScale!==100) p.type = "物理";
  if (!p.dur || p.dur <= 0){ p.charge = true; }
  if ((m = d.match(/攻击装有\s*(\d+)\s*发弹药/))){
    p.ammo = +m[1]; p.charge = false;
    // 维伊：储存能量的跳跃伤害只在没有目标时才有，打领袖时就是普通攻击 + 攻速
    if (/储存的能量/.test(d)){ p.hitScale = 100; p.type = ""; }
  }
  return p;
}

/* ---------- 收集作用于某干员的效果 ---------- */
function unitEffects(u, pos, ctx){
  // ctx: {state(compute结果), layersOf, lineupUnits:[{u,zone,i}], D, unitBonds}
  const list = []; // {key, src, text, cond, skillOnly, m, desc}
  const o = ctx.OPS[u.name], s = src(u.name);
  const add = (key, srcLabel, text, opts={}) => {
    text.split(/ \/ |；/).forEach((seg, si) => {
      if (!seg.trim()) return;
      let applicable = true, forced = opts.forced;
      // <在场N名> / <达到N层>
      const m1 = seg.match(/^<在场(\d+)名/); if (m1 && opts.total !== undefined && opts.total < +m1[1]) applicable = false;
      const m2 = seg.match(/^<(?:达到|首次到达)(\d+)层>/); if (m2 && opts.layers !== undefined && opts.layers < +m2[1]) applicable = false;
      if (!applicable) return;
      const segT = opts.layers !== undefined ? subLayers(seg, opts.layers) : seg;
      const items = parseSegment(segT, {layersOf:ctx.layersOf, equipCount:u.equips.filter(Boolean).length});
      if (!items.length) return;
      // 范围过滤（盟约）
      if (opts.scope){
        const sc = opts.scope(segT); if (sc === false) return;
        if (sc === "cond" || sc === "aura" || sc === "enemy") items.forEach(it => { it.cond = true; if (sc !== "cond") it.defOn = sc; });
      }
      // 精锐限定
      if (/精锐【/.test(segT) && !u.elite) return;
      const k = `${key}#${si}`;
      list.push({key:k, src:srcLabel, text:segT.replace(/【(?:基础|进阶|基础&进阶)】/g,""), items, cond: items.some(it=>it.cond), defOn: (items.find(it=>it.defOn)||{}).defOn || false});
    });
  };
  const st = ctx.state.res;
  const myBonds = new Set(ctx.unitBonds(u).base.concat(ctx.unitBonds(u).iso));
  const isHarmony = myBonds.has("调和") && st["调和"].level > 0;
  const ranged = s && /远程/.test(s.pos||"");
  const cls = s ? s.cls : "";
  // 1. 盟约
  ctx.D.bonds.forEach(b => {
    const r = st[b.name]; if (!r || r.level < 1) return;
    if (b.name === "独行" && r.count !== 1) return;
    let member = myBonds.has(b.name) || (isHarmony && b.category === "核心盟约");
    if (b.name === "绝技") member = !!u.elite;
    if (pos.zone !== "field") return;
    const L = ctx.layersOf(b.name);
    const zjEnh = b.name === "精准" && r.total >= 3 && ranged && !member;
    add("bond:"+b.name, `盟约【${b.name}】`, b.effect, {total:r.total, layers:L, scope: seg => {
      if (/所有干员|所有地面干员/.test(seg) && !/所有【/.test(seg)) return /地面/.test(seg) && ranged ? false : true;
      if (/精锐状态的干员/.test(seg)) return !!u.elite;
      if (/场上所有敌人/.test(seg)) return "enemy";
      if (member) return true;
      if (zjEnh) return true;
      // 「【X】干员及周围N格的干员」：本工具不知道站位，默认按站在 X 旁边算（可以取消勾选）
      if (/周围\d+格|相邻/.test(seg) && /【[^】]+】干员及/.test(seg)) return "aura";
      return false;
    }});
  });
  // 2. 装备（基础效果）
  u.equips.filter(Boolean).forEach((e, i) => {
    const E = ctx.EQUIP[e]; if (!E) return;
    const parts = E.effect.split(" / ");
    const basic = parts.filter(p => !/^【进阶】/.test(p)).join(" / ");
    add(`eq:${i}:${e}`, `装备「${e}」`, basic, {scope: seg => /左右两侧的我方干员/.test(seg) ? true : true});
  });
  // 2.5 策略（只算直接影响战斗的被动策略）
  if (ctx.strat && pos.zone === "field"){
    const SN = ctx.strat.name, srcL = `策略「${SN}」`;
    const sAdd = (text, mods, cond) => { const m = Object.assign(emptyMods(), mods);
      list.push({key:"strat:" + SN, src:srcL, text, items:[{m, cond:!!cond, skillOnly:false, desc:text}], cond:!!cond}); };
    if (SN === "众志合一"){
      const n = Object.keys(st).filter(k => st[k] && st[k].level > 0).length;
      const p = n >= 5 ? 40 : n >= 4 ? 30 : n >= 3 ? 20 : 0;
      if (p) sAdd(`场上 ${n} 种激活盟约：攻击力、生命上限 +${p}%`, {atkP:p, hpP:p});
    } else if (SN === "统御号令"){
      const n = (st["绝技"] || {}).count || 0;
      if (u.elite && n) sAdd(`场上 ${n} 名精锐干员：攻击力、生命上限 +${10 * n}%`, {atkP:10 * n, hpP:10 * n});
    } else if (SN === "以己之长"){
      sAdd("物理 / 法术伤害变为弱点伤害（取较高者）", {weak:true});
      if (u.elite) sAdd("精锐：攻击力 +16%，攻击速度 +16", {atkP:16, aspd:16});
    } else if (SN === "食腐之蝶"){
      sAdd("我方每有 1 名干员被击倒，攻击力 +20%（这里按 1 名算，最多 +200%）", {atkP:20}, true);
    }
  }
  // 3. 卫戍特质
  const trait = u.elite && o.trait_elite ? o.trait_elite : o.trait;
  if (trait) add("trait", u.elite ? "精锐特质" : "特质", trait);
  if (!s) return {list, notes:["无属性数据"]};
  // 4. 天赋（按精英阶段/模组等级选择变体）
  const cfg = config(u, o.tier);
  const modSel = moduleOf(u, cfg, s);
  const groups = {};
  s.talents.forEach(t => {
    if (/潜能/.test(t.cond)) return;
    const e = +(t.cond.match(/精英(\d)/)||[0,0])[1];
    const mm = t.cond.match(/([XYΔ])?模组(\d)级/);
    const lvReq = t.cond.replace(/模组\d级/,"").match(/(\d+)级/);
    if (e > cfg.e) return;
    if (lvReq && +lvReq[1] > cfg.lv && e === cfg.e) return;
    if (mm){
      if (!modSel || modSel.stage < +mm[2]) return;
      if (mm[1] && modSel.letter && mm[1] !== modSel.letter) return;
    }
    groups[t.g] = t;
  });
  Object.values(groups).forEach(t => add("tal:"+t.g, `天赋「${t.name}」`, t.text, {scope: seg => /^(?:自身|在场时)/.test(seg) || !/身后|身前|其余|其他|两侧|周围|相邻/.test(seg) || /自身及/.test(seg) ? true : false}));
  if (modSel && modSel.m.trait) add("modtrait", `模组「${modSel.m.name}」特性`, modSel.m.trait);
  return {list, notes:[], cls};
}
function moduleOf(u, cfg, s){
  if (!cfg.mod || !s.modules.length || cfg.e < 2) return null;
  const i = Math.min(u.mod ?? 0, s.modules.length-1);
  if (i < 0) return null;
  const m = s.modules[i];
  return {m, idx:i, stage:cfg.mod, letter:(m.type.match(/-(.)$/)||[])[1]||""};
}

/* ---------- 主计算 ---------- */
function dmgType(s, skillType){
  if (skillType === "法术") return "magic"; if (skillType === "真实") return "true"; if (skillType === "物理") return "phys";
  if (!s) return "phys";
  if (s.cls === "医疗" || /^恢复友方|^不攻击，持续恢复|治疗友方单位/.test(s.trait) && !/攻击造成/.test(s.trait)) return "heal";
  if (/法术伤害/.test(s.trait)) return "magic";
  return "phys";
}
function hitDamage(atk, type, en, M, weak){
  if (type === "heal") return atk;
  const def = Math.max(0, en.def * (1 - (M.defIgnP + (M.enemyDefP||0))/100) - M.defIgnF);
  const res = Math.max(0, en.res * (1 - M.resIgnP/100) - M.resIgnF - (M.enemyResF||0));
  const phys = Math.max(atk - def, atk*0.05), mag = Math.max(atk*(1 - res/100), atk*0.05);
  if (weak && type !== "true") return Math.max(phys, mag);
  return type === "true" ? atk : type === "magic" ? mag : phys;
}
function sumMods(items){
  const M = emptyMods(); const dmgBySrc = {};
  items.forEach(({it, srcKey}) => {
    const m = it.m;
    ["atkP","atkF","hpP","hpF","defP","defF","res","aspd","itv","defIgnP","resIgnP","defIgnF","resIgnF","spRegen","spCostP","initSp","enemyResF","enemyDefP"].forEach(k => M[k] += m[k]);
    M.atkMul *= m.atkMul; M.extra.push(...m.extra); M.dot.push(...(m.dot||[])); M.weak = M.weak || m.weak;
    m.dmg.forEach(v => dmgBySrc[srcKey] = Math.max(dmgBySrc[srcKey]||1, v));
  });
  M.dmgMul = Object.values(dmgBySrc).reduce((a,b)=>a*b, 1);
  return M;
}
function evaluate(u, pos, ctx){
  const o = ctx.OPS[u.name], s = src(u.name);
  if (o && o.wild) return {error:"占位干员（人选不限）：只计入盟约，不计算输出"};
  if (!s) return {error:"没有该干员的属性数据"};
  const cfg = config(u, o.tier);
  const B = baseStats(s, cfg.e, cfg.lv);
  const mod = moduleOf(u, cfg, s);
  const base = {...B.stats, interval:s.interval};
  if (mod){ const ms = mod.m.stages[mod.stage-1] || {}; ["hp","atk","def","res"].forEach(k => base[k] += ms[k]||0); base.aspdMod = ms.aspd||0; if (ms.interval) base.interval += ms.interval; }
  if (ctx.calc.trust){ base.hp += s.trust.hp; base.atk += s.trust.atk; base.def += s.trust.def; }
  const eff = unitEffects(u, pos, ctx);
  const conds = u.conds || {};
  // 技能
  const unlocked = s.skills.map((sk,i)=>({sk,i})).filter(x => x.sk.unlock <= B.e && Object.keys(x.sk.lv).length);
  let skIdx = u.skill ?? (unlocked.length ? unlocked[unlocked.length-1].i : -1);
  if (!unlocked.some(x=>x.i===skIdx)) skIdx = unlocked.length ? unlocked[unlocked.length-1].i : -1;
  const sk = skIdx >= 0 ? s.skills[skIdx] : null;
  let SP = sk ? parseSkill(sk, cfg.sk) : null;
  if (SP && u.skp) Object.assign(SP, u.skp);
  // 技能文本中的属性加成（技能期间）
  const skillEff = [];
  if (sk && SP){
    const text = SP.desc;
    text.split(/；/).forEach((seg, si) => {
      const items = parseSegment(seg, {layersOf:ctx.layersOf, equipCount:0, skill:true});
      if (!items.length) return;
      // 去掉已由技能参数处理的“攻击力X%的伤害”类（parseSegment 不处理它们，所以无需去重）
      skillEff.push({key:`skill:${skIdx}#${si}`, src:`技能「${sk.name}」`, text:seg, items, cond:items.some(it=>it.cond), defOn:(items.find(it=>it.defOn)||{}).defOn || false});
    });
  }
  const enabled = (row, it) => {
    const v = conds[row.key];
    return it.cond && !it.defOn ? v === true : v !== false;
  };
  const collect = (rows, skillOn) => {
    const items = [];
    rows.forEach(row => row.items.forEach(it => {
      if (!enabled(row, it)) return;
      if (it.skillOnly && !skillOn) return;
      items.push({it, srcKey:row.key});
    }));
    return items;
  };
  const manual = u.manual || {};
  const manualItem = () => { const m = emptyMods(); m.atkP = +manual.atkP||0; m.aspd = +manual.aspd||0; if (+manual.dmgP) m.dmg.push(1 + +manual.dmgP/100); m.hpP = +manual.hpP||0; m.defP = +manual.defP||0; return {it:{m}, srcKey:"manual"}; };
  const final = (M) => {
    const atk = (base.atk + M.atkF) * (1 + M.atkP/100) * M.atkMul;
    const hp = (base.hp + M.hpF) * (1 + M.hpP/100);
    const def = (base.def + M.defF) * (1 + M.defP/100);
    const res = base.res + M.res;
    const aspd = Math.min(600, Math.max(10, 100 + M.aspd + (base.aspdMod||0)));
    const interval = Math.max(0.067, (base.interval + M.itv)) * 100 / aspd;
    return {atk, hp, def, res, aspd, interval};
  };
  const passive = !!(SP && (!SP.sp || /被动/.test(SP.sp)));
  const Mn = sumMods(collect(eff.list, false).concat(passive ? collect(skillEff, true) : []).concat([manualItem()]));
  const Ms = sumMods(collect(eff.list, true).concat(collect(skillEff, true)).concat([manualItem()]));
  const Fn = final(Mn), Fs = final(Ms);
  if (SP && SP.ammo) SP.dur = SP.ammo * Fs.interval / Math.max(1, SP.hits);
  // 伤害：rates(en, nT) 计算给定敌人防御/法抗/目标数下的各类伤害速率
  const typeN = dmgType(s, "");
  const aoeTrait = /群体|所有敌人|阻挡的所有敌人|范围内所有/.test(s.trait);
  const typeS = SP ? (SP.heal ? "heal" : dmgType(s, SP.type)) : typeN;
  const rates = (en, nT) => {
    nT = Math.max(1, nT||1);
    const aoeN = aoeTrait ? nT : 1;
    const perHit = (F, M, scale, type, targets) => {
      const a = F.atk * scale/100;
      let d = hitDamage(a, type, en, M, M.weak);
      if (type !== "heal") M.extra.forEach(x => d += x.n * hitDamage(F.atk * x.pct/100, x.type, en, M, false));
      return d * (type==="heal" ? 1 : M.dmgMul) * targets;
    };
    const dot = (F, M) => M.dot.reduce((a, x) => a + hitDamage(F.atk * x.pct/100, x.type, en, M, false), 0) * M.dmgMul;
    const r = {N: perHit(Fn, Mn, 100, typeN, aoeN) / Fn.interval + dot(Fn, Mn), S:0, B:0, C:0};
    if (SP){
      const tS = Math.min(nT, Math.max(SP.targets, aoeN));
      r.S = (SP.noAttack ? 0 : perHit(Fs, Ms, SP.hitScale, typeS, tS) * SP.hits / Fs.interval) + dot(Fs, Ms);
      if (SP.burst) r.B = perHit(Fs, Ms, SP.burst, dmgType(s, SP.burstType||""), SP.burstAll ? nT : 1);
      if (SP.charge) r.C = perHit(Fs, Ms, SP.hitScale, typeS, tS) * SP.hits;
    }
    return r;
  };
  // 时间轴：只看初始技力 + 自然回复（自动回复 1/秒 + 加成；攻击回复 1/次攻击），不计其他技力变化
  // segs: [{a,b,m}] m = N 普攻 / S 技能 / C 蓄力攻击（以冲击计）；imp: [{t,b,c}] 技能开启瞬间的爆发 / 蓄力伤害
  const X = Math.max(1, +ctx.calc.x || 60);
  const H = Math.max(X, +ctx.horizon || 0);
  const segs = [], imp = [];
  if (SP && !/被动/.test(SP.sp) && SP.sp){
    const cost = Math.max(1, SP.cost * (1 - Mn.spCostP/100));
    let sp = Math.min(cost, ctx.spFull ? cost : SP.init + Mn.initSp), t = 0, guard = 0;
    const regen = 1 + Mn.spRegen;
    const isAtk = /攻击回复/.test(SP.sp), isHit = /受击回复/.test(SP.sp);
    while (t < H - 1e-9 && guard++ < 20000){
      if (!isHit && sp >= cost - 1e-9){
        if (SP.charge){ imp.push({t, b:1, c:1}); segs.push({a:t, b:t+Fn.interval, m:"C"}); t += Fn.interval; }
        else { imp.push({t, b:1, c:0}); segs.push({a:t, b:t+SP.dur, m:"S"}); t += SP.dur; }
        sp = 0; continue;
      }
      if (isHit){ segs.push({a:t, b:H, m:"N"}); t = H; break; }
      const need = cost - sp, dt = isAtk ? need * Fn.interval : need / regen;
      segs.push({a:t, b:t+dt, m:"N"}); t += dt; sp = cost;
    }
  } else segs.push({a:0, b:H, m:"N"});
  // 区间 [T0,T1) 内的伤害，拆成普攻 n 与技能 s（技能期间攻击、爆发、蓄力攻击都算技能）
  const damageSplit = (r, T0, T1) => {
    let n = 0, sk = 0;
    for (const g of segs){
      const a = Math.max(g.a, T0), b = Math.min(g.b, T1); if (b <= a) continue;
      if (g.m === "N") n += r.N * (b - a); else if (g.m === "S") sk += r.S * (b - a);
    }
    for (const p of imp){
      if (p.t < T0 || p.t >= T1) continue;
      sk += r.B;
      if (p.c){ const g = segs.find(x => x.a === p.t && x.m === "C"); sk += r.C * Math.min(1, (Math.min(T1, g ? g.b : T1) - p.t) / Fn.interval); }
    }
    return {n, s: sk};
  };
  const damageIn = (r, T0, T1) => { const d = damageSplit(r, T0, T1); return d.n + d.s; };
  // 单次攻击对给定敌人的伤害（不含伤害倍率），用来核对是否破防：物理低于防御时只剩攻击力的 5%
  const hitInfo = (en, skill) => {
    const F = skill ? Fs : Fn, M = skill ? Ms : Mn, type = skill ? typeS : typeN;
    const atk = F.atk * (skill && SP ? SP.hitScale : 100) / 100;
    const hit = hitDamage(atk, type, en, M, M.weak);
    return {type, atk, hit, floor: type !== "true" && type !== "heal" && hit <= atk * 0.05 + 1e-6};
  };
  const en = {def:+ctx.calc.def||0, res:+ctx.calc.res||0};
  const R0 = rates(en, +ctx.calc.targets||1);
  const split = damageSplit(R0, 0, X), total = split.n + split.s;
  const casts = imp.filter(p => p.t < X).length, timeline = imp.filter(p => p.t < X).map(p => Math.round(p.t*10)/10);
  return {
    cfg, base, B, mod, skIdx, unlocked, sk, SP, eff, skillEff, Mn, Ms, Fn, Fs,
    typeN, typeS, dpsN:R0.N, dpsS:R0.S, burstDmg:R0.B, chargeHit:R0.C, avg: total / X, avgN: split.n / X, avgS: split.s / X, total, totalN: split.n, totalS: split.s, casts, timeline, X,
    rates, damageIn, damageSplit, hitInfo, segs, imp, heal: typeN === "heal",
    notes: B.notes.concat(SP && /受击回复/.test(SP.sp) ? ["受击回复技能：不计受击回复，平均值只含普攻"] : [])
                 .concat(SP && /被动/.test(SP.sp) ? ["被动技能：效果已按常驻计入"] : [])
  };
}
return {TIERCFG, src, evaluate, parseSkill, config, CLASSES};
})();
