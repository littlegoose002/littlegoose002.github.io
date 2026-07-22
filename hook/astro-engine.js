(function () {
  'use strict';

  if (!window.Astronomy) throw new Error('Astronomy Engine 没有载入');

  const A = window.Astronomy;
  const HOUR = 3600000;
  const DAY = 24 * HOUR;
  const TZ_OFFSET = '+08:00';
  const ZODIAC = ['白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天秤座', '天蝎座', '射手座', '摩羯座', '水瓶座', '双鱼座'];
  const BODY_NAMES = {
    Sun: '太阳', Moon: '月亮', Mercury: '水星', Venus: '金星', Mars: '火星',
    Jupiter: '木星', Saturn: '土星', Uranus: '天王星', Neptune: '海王星', Pluto: '冥王星'
  };
  const BODIES = Object.keys(BODY_NAMES);
  const PLANETS = BODIES.filter(name => !['Sun', 'Moon'].includes(name));
  const ASPECTS = [
    { angle: 0, name: '合相', short: '合' },
    { angle: 60, name: '六合', short: '六合' },
    { angle: 90, name: '四分相', short: '刑' },
    { angle: 120, name: '三分相', short: '拱' },
    { angle: 180, name: '对分相', short: '冲' }
  ];
  const cache = new Map();

  function normalize(value) { return ((value % 360) + 360) % 360; }
  function signedDelta(next, previous) { return ((next - previous + 540) % 360) - 180; }
  function separation(a, b) { return Math.abs(signedDelta(a, b)); }
  function signIndex(longitude) { return Math.floor(normalize(longitude) / 30); }
  function signName(longitude) { return ZODIAC[signIndex(longitude)]; }
  function localDayStart(key) { return new Date(`${key}T00:00:00${TZ_OFFSET}`); }
  function at(start, hours) { return new Date(start.getTime() + hours * HOUR); }
  function timeLabel(date) {
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }
  function longitude(bodyName, date) {
    const vector = A.GeoVector(A.Body[bodyName], date, true);
    return normalize(A.Ecliptic(vector).elon);
  }
  function speed(bodyName, date) {
    const before = longitude(bodyName, new Date(date.getTime() - 3 * HOUR));
    const after = longitude(bodyName, new Date(date.getTime() + 3 * HOUR));
    return signedDelta(after, before) * 4;
  }
  function bisect(startHour, endHour, evaluator, targetTest) {
    let left = startHour;
    let right = endHour;
    let leftValue = evaluator(left);
    for (let index = 0; index < 24; index++) {
      const middle = (left + right) / 2;
      const middleValue = evaluator(middle);
      if (targetTest(leftValue, middleValue)) right = middle;
      else { left = middle; leftValue = middleValue; }
    }
    return (left + right) / 2;
  }
  function phaseInfo(angle) {
    const value = normalize(angle);
    let name;
    if (value < 4 || value >= 356) name = '新月';
    else if (value < 90) name = '娥眉月';
    else if (value < 94) name = '上弦月';
    else if (value < 180) name = '盈凸月';
    else if (value < 184) name = '满月';
    else if (value < 270) name = '亏凸月';
    else if (value < 274) name = '下弦月';
    else name = '残月';
    return { angle: value, name, illumination: Math.round((1 - Math.cos(value * Math.PI / 180)) * 50) };
  }

  function findIngresses(start, hourly) {
    const events = [];
    for (const body of BODIES) {
      for (let hour = 0; hour < 24; hour++) {
        const from = hourly[hour][body];
        const to = hourly[hour + 1][body];
        if (signIndex(from) === signIndex(to)) continue;
        const forward = signedDelta(to, from) >= 0;
        const boundary = forward ? (signIndex(to) * 30) : ((signIndex(from) * 30) || 360);
        const crossing = bisect(hour, hour + 1, h => longitude(body, at(start, h)), (left, middle) => {
          const leftSide = signedDelta(left, boundary);
          const middleSide = signedDelta(middle, boundary);
          return leftSide === 0 || Math.sign(leftSide) !== Math.sign(middleSide);
        });
        const when = at(start, crossing);
        const destination = signName(longitude(body, new Date(when.getTime() + 60000)));
        events.push({ time: timeLabel(when), sortTime: when.getTime(), kind: 'ingress', title: `${BODY_NAMES[body]}进入${destination}`, meta: `北京时间 · 行星换座`, bodies: [body] });
      }
    }
    return events;
  }

  function findStations(start) {
    const events = [];
    for (const body of PLANETS) {
      let previous = speed(body, start);
      for (let hour = 2; hour <= 24; hour += 2) {
        const current = speed(body, at(start, hour));
        if (previous !== 0 && Math.sign(previous) !== Math.sign(current)) {
          const crossing = bisect(hour - 2, hour, h => speed(body, at(start, h)), (left, middle) => Math.sign(left) !== Math.sign(middle));
          const when = at(start, crossing);
          const after = speed(body, new Date(when.getTime() + HOUR));
          events.push({
            time: timeLabel(when), sortTime: when.getTime(), kind: 'station',
            title: `${BODY_NAMES[body]}${after < 0 ? '开始逆行' : '恢复顺行'}`,
            meta: `${signName(longitude(body, when))} · 北京时间`, bodies: [body]
          });
          break;
        }
        previous = current;
      }
    }
    return events;
  }

  function findQuarterPhases(start) {
    const events = [];
    const endTime = start.getTime() + DAY;
    for (const target of [0, 90, 180, 270]) {
      const result = A.SearchMoonPhase(target, start, 1.05);
      if (!result || result.date.getTime() < start.getTime() || result.date.getTime() >= endTime) continue;
      const title = { 0: '新月', 90: '上弦月', 180: '满月', 270: '下弦月' }[target];
      events.push({
        time: timeLabel(result.date), sortTime: result.date.getTime(), kind: 'phase',
        title: `${signName(longitude('Moon', result.date))}${title}`,
        meta: `精确月相 · 北京时间`, bodies: ['Sun', 'Moon']
      });
    }
    return events;
  }

  function refineAspect(start, bodyA, bodyB, target, lowHour, highHour) {
    const residual = hour => Math.abs(separation(longitude(bodyA, at(start, hour)), longitude(bodyB, at(start, hour))) - target);
    let left = lowHour;
    let right = highHour;
    for (let index = 0; index < 22; index++) {
      const oneThird = left + (right - left) / 3;
      const twoThirds = right - (right - left) / 3;
      if (residual(oneThird) <= residual(twoThirds)) right = twoThirds;
      else left = oneThird;
    }
    const hour = (left + right) / 2;
    return { hour, residual: residual(hour) };
  }

  function findAspects(start, hourly) {
    const events = [];
    for (let first = 0; first < BODIES.length; first++) {
      for (let second = first + 1; second < BODIES.length; second++) {
        const bodyA = BODIES[first];
        const bodyB = BODIES[second];
        if (bodyA === 'Sun' && bodyB === 'Moon') continue;
        const hasMoon = bodyA === 'Moon' || bodyB === 'Moon';
        for (const aspect of ASPECTS) {
          const residuals = hourly.map(row => Math.abs(separation(row[bodyA], row[bodyB]) - aspect.angle));
          let bestHour = 1;
          for (let hour = 2; hour < 24; hour++) if (residuals[hour] < residuals[bestHour]) bestHour = hour;
          if (!(residuals[bestHour] <= residuals[bestHour - 1] && residuals[bestHour] <= residuals[bestHour + 1])) continue;
          const refined = refineAspect(start, bodyA, bodyB, aspect.angle, bestHour - 1, bestHour + 1);
          const threshold = hasMoon ? 0.12 : 0.06;
          if (refined.residual > threshold) continue;
          const when = at(start, refined.hour);
          events.push({
            time: timeLabel(when), sortTime: when.getTime(), kind: 'aspect',
            title: `${BODY_NAMES[bodyA]}${aspect.short}${BODY_NAMES[bodyB]}`,
            meta: `${signName(longitude(bodyA, when))}—${signName(longitude(bodyB, when))} · 精确相位`,
            bodies: [bodyA, bodyB], aspect: aspect.angle
          });
        }
      }
    }
    const moonEvents = events.filter(event => event.bodies.includes('Moon')).slice(0, 6);
    const planetEvents = events.filter(event => !event.bodies.includes('Moon')).slice(0, 4);
    return [...moonEvents, ...planetEvents];
  }

  function scoreSigns(positions) {
    const weights = {
      Moon: { harmony: .6, tension: .7, conjunction: .2 }, Mercury: { harmony: .8, tension: .8, conjunction: .35 },
      Venus: { harmony: 1.8, tension: .7, conjunction: 1.2 }, Mars: { harmony: .8, tension: 1.5, conjunction: -1 },
      Jupiter: { harmony: 2.2, tension: .8, conjunction: 1.5 }, Saturn: { harmony: .7, tension: 1.8, conjunction: -1.3 },
      Uranus: { harmony: .5, tension: .8, conjunction: -.4 }, Neptune: { harmony: .5, tension: .8, conjunction: -.35 },
      Pluto: { harmony: .6, tension: 1, conjunction: -.6 }, Sun: { harmony: .45, tension: .45, conjunction: .5 }
    };
    const rows = ZODIAC.map((name, index) => {
      const midpoint = index * 30 + 15;
      let score = 0;
      const contributions = [];
      for (const body of BODIES) {
        const distance = separation(midpoint, positions[body]);
        const nearest = ASPECTS.map(aspect => ({ ...aspect, orb: Math.abs(distance - aspect.angle) })).sort((a, b) => a.orb - b.orb)[0];
        if (nearest.orb > 8) continue;
        const closeness = 1 - nearest.orb / 8;
        const weight = weights[body];
        let contribution = 0;
        if ([60, 120].includes(nearest.angle)) contribution = weight.harmony * closeness;
        else if ([90, 180].includes(nearest.angle)) contribution = -weight.tension * closeness;
        else contribution = weight.conjunction * closeness;
        score += contribution;
        const planetSignIndex = Math.floor(normalize(positions[body]) / 30);
        const house = ((planetSignIndex - index + 12) % 12) + 1;
        contributions.push({ body, value: contribution, aspect: nearest.angle, house });
      }
      return { name, score: Math.round(score * 100) / 100, contributions };
    });
    const descending = [...rows].sort((a, b) => b.score - a.score || ZODIAC.indexOf(a.name) - ZODIAC.indexOf(b.name));
    const ascending = [...rows].sort((a, b) => a.score - b.score || ZODIAC.indexOf(a.name) - ZODIAC.indexOf(b.name));
    const planetVoices = {
      Moon: ['月亮带动', '月亮扰动'], Mercury: ['水星理清', '水星考验'], Venus: ['金星润滑', '金星拉扯'],
      Mars: ['火星推动', '火星催促'], Jupiter: ['木星扩展', '木星放大'], Saturn: ['土星稳固', '土星加压'],
      Uranus: ['天王星更新', '天王星带来变动'], Neptune: ['海王星启发', '海王星模糊'],
      Pluto: ['冥王星深化', '冥王星强化'], Sun: ['太阳照亮', '太阳放大']
    };
    const houseTopics = {
      1: '自我状态', 2: '金钱与价值', 3: '沟通学习', 4: '家庭与内在', 5: '创作与心动', 6: '日常与效率',
      7: '合作关系', 8: '共享资源', 9: '进修与远行', 10: '事业与公开表达', 11: '社群与长期计划', 12: '休息与幕后整理'
    };
    const detail = (row, mode) => {
      const candidates = row.contributions.filter(item => mode === 'lucky' ? item.value > 0 : item.value < 0);
      const dominant = candidates.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
      const fallback = mode === 'lucky' ? '整体节奏较顺' : '适合低调稳步推进';
      if (!dominant) return { name: row.name, reason: fallback };
      const voice = planetVoices[dominant.body][mode === 'lucky' ? 0 : 1];
      const topic = houseTopics[dominant.house];
      return { name: row.name, reason: mode === 'lucky' ? `${voice}：${topic}更顺` : `${voice}：${topic}宜放慢` };
    };
    const luckyRows = descending.slice(0, 3);
    const cautiousRows = ascending.slice(0, 3);
    return {
      lucky: luckyRows.map(row => row.name),
      cautious: cautiousRows.map(row => row.name),
      luckyDetails: luckyRows.map(row => detail(row, 'lucky')),
      cautiousDetails: cautiousRows.map(row => detail(row, 'cautious')),
      scores: rows
    };
  }

  function unique(items) { return [...new Set(items.filter(Boolean))]; }
  function buildRecommendations(key, phase, statuses, events, moonSign, rankings) {
    const yi = [];
    const ji = [];
    const hasTenseMoon = events.some(event => event.bodies.includes('Moon') && [90, 180].includes(event.aspect));
    const hasHarmony = events.some(event => [60, 120].includes(event.aspect));
    const mercuryRetro = statuses.some(status => status.body === 'Mercury' && status.retrograde);
    const hasStation = events.some(event => event.kind === 'station');
    const hasIngress = events.some(event => event.kind === 'ingress');

    if (mercuryRetro) { yi.push('复盘旧计划', '文书校对', '备份资料'); ji.push('仓促签约', '只凭口头确认'); }
    if (hasTenseMoon) { yi.push('给情绪留缓冲', '先听再回应'); ji.push('冲动消费', '情绪化决定'); }
    if (hasHarmony) yi.push('社交邀约', '创作表达');
    if (hasStation) { yi.push('放慢重大决定'); ji.push('强推尚未稳定的计划'); }
    if (hasIngress) yi.push('更新主题与表达方式');
    if (phase.name === '新月') yi.push('设定新意图', '开始小计划');
    if (phase.name === '满月') { yi.push('完成与公开', '清理积压'); ji.push('继续无边界扩张'); }
    if (phase.angle > 90 && phase.angle < 180) yi.push('推进已启动的工作');
    if (phase.angle > 180 && phase.angle < 360) yi.push('整理、复盘与收尾');

    const finalYi = unique([...yi, '处理最重要的一件事', '留出独处时间']).slice(0, 4);
    const finalJi = unique([...ji, '同时开启太多任务', '替别人承担全部情绪']).slice(0, 4);
    const element = Math.floor(ZODIAC.indexOf(moonSign) / 1) % 4;
    const palettes = [
      ['石榴红', '琥珀金', '暖橙'], ['苔藓绿', '米白', '沙金'], ['雾霾蓝', '银灰', '浅青'], ['午夜蓝', '烟灰紫', '珍珠白']
    ];
    const directions = ['东方', '东南', '南方', '西南', '西方', '西北', '北方', '东北'];
    let seed = 2166136261;
    for (const char of key) { seed ^= char.charCodeAt(0); seed = Math.imul(seed, 16777619); }
    return {
      yi: finalYi,
      ji: finalJi,
      color: palettes[element][Math.abs(seed) % 3],
      number: String((Math.abs(seed >>> 3) % 9) + 1),
      direction: directions[Math.abs(seed >>> 5) % directions.length],
      rankings
    };
  }

  function calculateDay(key) {
    if (cache.has(key)) return cache.get(key);
    const start = localDayStart(key);
    const hourly = [];
    for (let hour = 0; hour <= 24; hour++) {
      const row = {};
      for (const body of BODIES) row[body] = longitude(body, at(start, hour));
      hourly.push(row);
    }
    const noon = hourly[12];
    const phase = phaseInfo(A.MoonPhase(at(start, 12)));
    const moonSign = signName(noon.Moon);
    const statuses = PLANETS.map(body => ({
      body, name: BODY_NAMES[body], longitude: noon[body], sign: signName(noon[body]), retrograde: speed(body, at(start, 12)) < 0
    }));
    const events = [
      ...findIngresses(start, hourly),
      ...findStations(start),
      ...findQuarterPhases(start),
      ...findAspects(start, hourly)
    ].sort((a, b) => a.sortTime - b.sortTime);
    const rankings = scoreSigns(noon);
    const recommendations = buildRecommendations(key, phase, statuses, events, moonSign, rankings);
    const lead = events.find(event => ['ingress', 'station', 'phase'].includes(event.kind)) || events[0];
    const title = lead
      ? (lead.kind === 'aspect' ? `月亮在${moonSign.replace('座', '')}，形成主要相位` : `${lead.title}，月亮在${moonSign.replace('座', '')}`)
      : `月亮在${moonSign.replace('座', '')}`;
    const result = {
      key, timezone: 'Asia/Shanghai', source: 'Astronomy Engine 2.1.19',
      positions: noon, phase: { ...phase, moonSign }, statuses, events, rankings, recommendations,
      title
    };
    cache.set(key, result);
    return result;
  }

  window.HookAstro = Object.freeze({ calculateDay, ZODIAC, BODY_NAMES, version: '2.1.19', timezone: 'Asia/Shanghai' });
})();
