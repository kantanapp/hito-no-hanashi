/*
 * 通しテスト（任意）。index.html をスマホ幅のブラウザで開き、3つのむずかしさを最後まで動かして確かめる。
 *
 *   npm i -D playwright && npx playwright install chromium
 *   node tools/playtest.js
 *
 * 見ているもの：お願い文と50品の山に矛盾がないか／品物が重ならないか／電話・50品の確認・
 * ハッピーエンド・失敗画面に進むか／GA4のイベントが正しい中身で出るか／画面が横にはみ出さないか。
 * 最後に「ALL OK」が出れば合格。ゲーム内の window.kiite はこのテスト用の のぞき窓。
 */
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const FILE = 'file://' + path.resolve(__dirname, '..', 'index.html');
const problems = [];
const check = (ok, label) => { console.log((ok ? '  ok   ' : '  NG   ') + label); if (!ok) problems.push(label); };

(async () => {
  const browser = await chromium.launch();
  for (const [w, h] of [[390, 760], [320, 600]]) {
    console.log(`\n== ${w}x${h} ==`);
    const page = await browser.newPage({ viewport: { width: w, height: h }, hasTouch: true });
    page.on('pageerror', e => problems.push('page error: ' + e.message));
    // GA4 には送らず、送られたイベントを ためておく（gtag は dataLayer に積むので そこで受ける）
    await page.route(/googletagmanager\.com/, r => r.abort());
    await page.addInitScript(() => { window.__ev = []; window.dataLayer = { push: a => { if (a && a[0] === 'event') window.__ev.push([a[1], a[2]]); } }; });
    await page.goto(FILE);
    await page.waitForTimeout(300);

    /* ---- ルール：お願い文と50品の山 ---- */
    const logic = await page.evaluate(() => {
      const K = window.kiite, bad = new Set();
      for (const k of Object.keys(K.LEVELS)) for (let i = 0; i < 300; i++) {
        K.makeErrand(k).stages.forEach(st => {
          if (/undefined|NaN/.test(st.speech)) bad.add(k + ': おねがい文');
          if (st.type === 'bank') {
            if (K.bankDeck().length !== 50) bad.add('ぎんこう: 50まいでない');
            if (st.amount % 100 || st.amount < 1200 || st.amount > 9800) bad.add('ぎんこう: 金額');
            return;
          }
          if (st.avoid.some(a => a in st.want)) bad.add(k + ': かわないで と おねがいが かぶる');
          const d = K.buildDeck(st.pool, st.want, st.avoid, st.late);
          if (d.length !== 50) bad.add(k + ': 50品でない');
          let want = st.want;
          st.calls.forEach(c => { want = K.applyCall(want, c); if (c.at >= 25) bad.add(k + ': 電話がおそすぎる'); });
          const n = {}; d.forEach(x => { n[x] = (n[x] || 0) + 1; });
          for (const id in want) if ((n[id] || 0) < want[id]) bad.add(k + ': たのまれた品が足りない');
          for (const id in st.late) if (d.slice(25).filter(x => x === id).length < st.late[id]) bad.add(k + ': 電話のあとに品が出ない');
          if (!K.judge(want, { ...want }).ok) bad.add(k + ': ぴったりなのに失敗');
          const over = { ...want }; over[Object.keys(over)[0]]++;
          if (K.judge(want, over).ok) bad.add(k + ': 多いのに成功');
        });
      }
      return [...bad];
    });
    check(logic.length === 0, 'お願い文・50品の山・判定' + (logic.length ? ' → ' + logic.join(' / ') : ''));

    const S = fn => page.evaluate(fn);
    const start = async level => {            // むずかしさを選んで、あそぶ画面まで進む
      await page.click('#lv-' + level);
      await page.click('#btn-start');         // 1回め：話を最後まで出す
      await page.click('#btn-start').catch(() => {});
      await page.waitForSelector('#scr-play:not([hidden])');
    };
    const overlapWatch = async ms => {        // 落ちている品物どうしが重なっていないか
      let n = 0;
      for (let t = 0; t < ms; t += 250) {
        await page.waitForTimeout(250);
        n += await page.evaluate(() => {
          const r = [...document.querySelectorAll('.item')].filter(e => e.style.pointerEvents !== 'none').map(e => e.getBoundingClientRect());
          let c = 0;
          for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++)
            if (r[i].left < r[j].right && r[j].left < r[i].right && r[i].top < r[j].bottom && r[j].top < r[i].bottom) c++;
          return c;
        });
      }
      return n;
    };
    const noSideScroll = async label => check(await S(() => document.documentElement.scrollWidth <= innerWidth), label + '：横にはみ出さない');

    /* ---- やさしい：タップ・もどす・50品の確認・成功 ---- */
    await noSideScroll('タイトル');
    await start('easy');
    check(await overlapWatch(4000) === 0, 'やさしい：品物が重ならない');
    const first = await page.$('.item');
    await first.dispatchEvent('pointerdown'); await page.waitForTimeout(300);
    check(await page.$$eval('button.chip', a => a.length) === 1, 'やさしい：タップでカゴに入る');
    await page.click('button.chip');
    check(await page.$$eval('button.chip', a => a.length) === 0, 'やさしい：カゴから戻せる');
    await S(() => { const s = window.kiite.state; s.deckPos = s.deck.length; });
    await page.waitForSelector('#ask:not([hidden])', { timeout: 15000 });
    check(true, 'やさしい：50品流れたら確認が出る');
    await page.click('#btn-ask-more'); await page.waitForTimeout(600);
    check(await S(() => window.kiite.state.pass === 2 && window.kiite.state.running), 'やさしい：もういちど見る');
    await S(() => { const s = window.kiite.state; s.basket = { ...s.want }; });
    await page.click('#btn-register'); await page.waitForTimeout(800);
    check(await page.$eval('#scr-ending', e => !e.hidden), 'やさしい：成功でハッピーエンド');
    await noSideScroll('ハッピーエンド');
    await page.click('#btn-end-receipt');
    check(await page.$eval('#scr-result', e => !e.hidden), 'レシートを見られる');
    await page.click('#btn-levels');

    /* ---- ふつう：買い物の途中の電話・失敗 ---- */
    await start('normal');
    await page.waitForSelector('#call:not([hidden])', { timeout: 30000 });
    const at = await S(() => window.kiite.state.deckPos);
    check(at >= 14 && at <= 21, `ふつう：途中で電話が鳴る（${at}品め）`);
    await page.click('#btn-answer'); await page.click('#btn-hangup'); await page.click('#btn-hangup').catch(() => {});
    await page.waitForSelector('#call', { state: 'hidden' });
    await page.click('#btn-register'); await page.waitForTimeout(500);
    check(await page.$eval('#scr-result', e => !e.hidden) && await page.$eval('#stamp', e => e.classList.contains('bad')), 'ふつう：足りないと失敗');
    await page.click('#btn-levels');

    /* ---- むずかしい：読む時間・3か所・ぎんこう ---- */
    await page.click('#lv-hard');
    await page.waitForFunction(() => /あと/.test(document.getElementById('mission-timer-label').textContent), null, { timeout: 30000 });
    check(true, 'むずかしい：話し終わってからカウントダウン');
    await page.click('#btn-start'); await page.waitForSelector('#scr-play:not([hidden])');
    for (const place of ['やおや', 'スーパー']) {
      await S(() => { const s = window.kiite.state; s.basket = { ...s.want }; });
      await page.click('#btn-register');
      await page.waitForSelector('#call:not([hidden])');
      await page.click('#btn-answer'); await page.click('#btn-hangup'); await page.click('#btn-hangup').catch(() => {});
      await page.waitForSelector('#call', { state: 'hidden' });
      check(true, `むずかしい：${place}のレジのあとに電話`);
    }
    check(await S(() => window.kiite.state.stage.type === 'bank'), 'むずかしい：ぎんこうに進む');
    check(await overlapWatch(4000) === 0, 'ぎんこう：おかねが重ならない');
    await S(() => { const s = window.kiite.state; s.total = s.stage.amount; });
    await page.click('#btn-register'); await page.waitForTimeout(800);
    check(await page.$eval('#scr-ending', e => !e.hidden), 'むずかしい：3か所そろって成功');

    /* ---- GA4 のイベント ---- */
    const ev = await S(() => window.__ev);
    const has = (name, test) => ev.some(([n, p]) => n === name && (!test || test(p || {})));
    check(has('level_start', p => p.level_name === 'easy') && has('level_start', p => p.level_name === 'hard'), 'GA4：level_start');
    check(has('level_end', p => p.level_name === 'easy' && p.success === true), 'GA4：level_end（成功）');
    check(has('level_end', p => p.level_name === 'normal' && p.success === false && p.fail_place === 'super' && p.fail_reason === 'short'), 'GA4：level_end（失敗の場所と理由）');
    check(has('stage_clear', p => p.place === 'yao') && has('stage_clear', p => p.place === 'super'), 'GA4：stage_clear');
    check(has('deck_again', p => p.pass === 2), 'GA4：deck_again');
    check(has('receipt_view'), 'GA4：receipt_view');
    check(ev.filter(([n]) => n === 'level_start').length === 3 && ev.filter(([n]) => n === 'level_end').length === 3, 'GA4：1回のおつかいで start と end が1つずつ');
    await page.close();
  }
  await browser.close();
  console.log(problems.length ? `\nNG ${problems.length}件\n - ` + problems.join('\n - ') : '\nALL OK');
  process.exit(problems.length ? 1 : 0);
})();
