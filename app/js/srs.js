/* 间隔重复调度(SM-2 简化版)—— 「今日复习」的算法建议层。
   ------------------------------------------------------------------
   在此之前,复习队列只有手工状态:标「还不熟/待复习」的题永远在队列里,
   标「基本掌握」的题永远出去。它能兜底,但记不住「什么时候该再看一眼」。
   本模块补的就是这一层:每次明确的复盘信号(标状态)都排一个「建议到期时间」,
   到期的题出现在复习中心与工作台的「到期建议」里。

   原则(与本项目其它部分一致):
     - 手动状态永远优先:weak/review 的题始终进手动队列,不看排期;
     - 算法只产生「建议」,不产生义务:到期建议单独一节,可以无视;
     - 重复点击同一状态不推进排期(模拟面试里的复盘标记是例外——那是一次真实练习);
     - 状态清空(未练习)时排期一并清掉:没有状态就没有建议。
     - 专项尝试的自评(solved/partial/unsolved)归属 drillId,与题目没有稳定映射,
       本版不参与排期——不猜映射,如实不做。

   数据形状:题目记录上的可选字段
     srs = { due, ivl, ease, streak, lapses, lastAt, lastRating }
     due/lastAt 毫秒时间戳;ivl 天;ease 易度因子;streak 连续成功次数;lapses 遗忘次数。

   本模块自包含:不依赖 DOM、不依赖其它模块,Node 里可直接加载断言。 */
'use strict';

const SRS = (() => {
  const DAY = 86400000;
  const MIN_EASE = 1.3;
  const MAX_EASE = 2.8;
  const MAX_IVL = 180;          /* 天。面试备考场景,超过半年不再拉长 */
  const RATINGS = ['again', 'hard', 'good', 'easy'];
  const RATING_LABEL = { again: '还不熟', hard: '需巩固', good: '基本掌握', easy: '很熟练' };

  /* 手动状态 → 评分。唯一映射点:所有入口都经 Store.setStatus,
     这里改了,复习中心/学习页/模拟面试三处同时生效。 */
  const STATUS_RATING = { weak: 'again', review: 'hard', ok: 'good' };
  function ratingFromStatus(status) { return STATUS_RATING[status] || null; }

  /* 排期一次。prev 为该题当前 srs(可为 null);rating 见 RATINGS;now 为毫秒时间戳。
     规则( SM-2 简化):
       again → 连续成功清零,间隔清零(当天就该再看),ease 下降,遗忘次数 +1;
       hard  → 小幅延长(×1.2,至少 1 天),ease 略降,连续成功不涨;
       good  → 连续成功 +1;第 1 次成功后 1 天,第 2 次后 6 天,之后按间隔×ease;
       easy  → 同 good 但更快(×ease×1.3;首次 3 天),ease 上升。
     ease 限制在 [1.3, 2.8];ivl 上限 180 天。返回新的 srs 对象(不修改 prev)。 */
  function schedule(prev, rating, now) {
    if (!RATINGS.includes(rating)) throw new Error('SRS 未知评分:' + rating);
    if (typeof now !== 'number' || !isFinite(now) || now < 0) throw new Error('SRS 时间非法:' + now);
    const p = (prev && typeof prev === 'object') ? prev : {};
    let ease = num(p.ease, 2.5, MIN_EASE, MAX_EASE);
    const prevIvl = num(p.ivl, 0, 0, MAX_IVL);
    const streak = num(p.streak, 0, 0, 1e9);
    const lapses = num(p.lapses, 0, 0, 1e9);
    let nextStreak = streak, nextLapses = lapses, ivl;
    if (rating === 'again') {
      nextStreak = 0; nextLapses = lapses + 1; ivl = 0;
      ease = Math.max(MIN_EASE, ease - 0.2);
    } else if (rating === 'hard') {
      ivl = Math.max(1, Math.round(Math.max(prevIvl, 1) * 1.2));
      ease = Math.max(MIN_EASE, ease - 0.15);
    } else if (rating === 'good') {
      nextStreak = streak + 1;
      ivl = nextStreak === 1 ? 1 : nextStreak === 2 ? 6 : Math.max(1, Math.round(Math.max(prevIvl, 1) * ease));
    } else { /* easy */
      nextStreak = streak + 1;
      ivl = nextStreak === 1 ? 3 : Math.max(1, Math.round(Math.max(prevIvl, 1) * ease * 1.3));
      ease = Math.min(MAX_EASE, ease + 0.15);
    }
    ivl = Math.min(ivl, MAX_IVL);
    return {
      due: ivl === 0 ? now : now + ivl * DAY,
      ivl, ease: Math.round(ease * 100) / 100,
      streak: nextStreak, lapses: nextLapses,
      lastAt: now, lastRating: rating
    };
  }

  function num(v, dflt, min, max) {
    if (typeof v !== 'number' || !isFinite(v)) return dflt;
    return Math.min(max, Math.max(min, v));
  }

  /* 该题当前是否到期(建议队列的唯一判定)。没有排期的题永远不产生建议。 */
  function isDue(rec, now) {
    const s = rec && rec.srs;
    if (!s || typeof s !== 'object') return false;
    if (typeof s.due !== 'number' || !isFinite(s.due)) return false;
    const t = (typeof now === 'number' && isFinite(now)) ? now : Date.now();
    return s.due <= t;
  }

  /* 到期时间的人话版:已到期 / 今天 / 明天 / N 天后(学习页与建议列表共用)。 */
  function dueLabel(due, now) {
    if (typeof due !== 'number' || !isFinite(due)) return '';
    const t = (typeof now === 'number' && isFinite(now)) ? now : Date.now();
    const days = Math.floor((due - t) / DAY);
    if (days <= 0) return '已到期';
    if (days === 1) return '明天';
    return days + ' 天后';
  }

  return { schedule, ratingFromStatus, isDue, dueLabel, RATINGS, RATING_LABEL, MIN_EASE, MAX_EASE, MAX_IVL, DAY };
})();

if (typeof window !== 'undefined') window.SRS = SRS;
