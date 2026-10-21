import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { download } from 'geckodriver';
import { resolve } from 'node:path';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const uuid = 'f08aae46-85f3-4c94-af1e-71222610fe17';
const id = 'ai-usage-monitor@local.extension';
const { version } = JSON.parse(await readFile('public/manifest.json', 'utf8'));
const options = new firefox.Options()
  .addArguments('-headless')
  .setPreference('extensions.webextensions.uuids', JSON.stringify({ [id]: uuid }))
  // Tests use a clean profile and deliberately cannot contact provider services.
  .setPreference('network.proxy.type', 1)
  .setPreference('network.proxy.http', '127.0.0.1')
  .setPreference('network.proxy.http_port', 9)
  .setPreference('network.proxy.ssl', '127.0.0.1')
  .setPreference('network.proxy.ssl_port', 9);
if (process.env.FIREFOX_BINARY) options.setBinary(process.env.FIREFOX_BINARY);
else if (process.platform === 'win32')
  options.setBinary('C:/Program Files/Mozilla Firefox/firefox.exe');
const driverPath = await download('0.37.1');
const driver = await new Builder()
  .forBrowser('firefox')
  .setFirefoxOptions(options)
  .setFirefoxService(new firefox.ServiceBuilder(driverPath).addArguments('--allow-system-access'))
  .build();
const results = [];
const run = async (name, fn) => {
  await fn();
  results.push(name);
  console.log('PASS', name);
};
const script = async (fn, ...args) => driver.executeAsyncScript(fn, ...args);
try {
  await driver.manage().setTimeouts({ script: 60000 });
  await driver.manage().window().setRect({ width: 620, height: 1500 });
  const caps = await driver.getCapabilities();
  console.log('Firefox', caps.get('browserVersion'));
  await run('temporary Firefox MV3 install', async () =>
    assert.equal(
      await driver.installAddon(resolve(`artifacts/ai-usage-monitor-${version}.zip`), true),
      id,
    ),
  );
  await driver.get(`moz-extension://${uuid}/popup.html`);
  await driver.wait(until.elementLocated(By.css('.card')), 30000);
  await run('popup renders honest unavailable states without account data', async () => {
    const text = await driver.findElement(By.css('body')).getText();
    assert.match(text, /AI Usage Monitor/);
    assert.match(text, /ChatGPT/);
    assert.match(text, /Codex/);
    assert.doesNotMatch(text, /\d+% remaining/);
    assert.equal(Math.round((await driver.findElement(By.css('body')).getRect()).width), 520);
  });
  await run('background alarm and gray toolbar badge operate', async () => {
    // Cached popup rendering can precede first-install toolbar initialization.
    await driver.wait(
      async () =>
        (await script((done) => browser.action.getTitle({}).then(done))).includes(
          'Claude = top row',
        ),
      30000,
    );
    const result = await script((done) =>
      Promise.all([
        browser.alarms.get('usage-tick'),
        browser.action.getBadgeText({}),
        browser.action.getTitle({}),
      ]).then(done),
    );
    assert.equal(result[0].periodInMinutes, 1);
    assert.equal(result[1], '');
    assert.match(result[2], /Claude = top row/);
    assert.match(result[2], /ChatGPT/);
  });
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/firefox-popup-unavailable.png',
    await driver.findElement(By.css('body')).takeScreenshot(),
    'base64',
  );
  await run('settings save round trip and optional split icon', async () => {
    await driver.get(`moz-extension://${uuid}/options.html`);
    await driver.wait(until.elementLocated(By.css('form')), 10000);
    await driver.findElement(By.css('[name=theme] option[value=dark]')).click();
    const intervals = await driver.findElements(By.css('[name=interval] option'));
    const values = await Promise.all(intervals.map((o) => o.getAttribute('value')));
    for (const v of ['15', '30', '45', '60', '720', '1440']) assert.ok(values.includes(v));
    assert.ok(await driver.findElement(By.css('[name=idleAware]')).isEnabled());
    if (!(await driver.findElement(By.css('[name=dualIcon]')).isSelected()))
      await driver.findElement(By.css('[name=dualIcon]')).click();
    await driver.findElement(By.css('button[type=submit]')).click();
    await driver.wait(
      until.elementTextContains(driver.findElement(By.css('[role=status]')), 'Settings saved'),
      30000,
    );
    const s = await script((done) => browser.runtime.sendMessage({ type: 'read' }).then(done));
    assert.equal(s.settings.theme, 'dark');
    assert.equal(s.settings.dualIcon, true);
  });
  await run('compact popup fits all providers and extra caps without scrolling', async () => {
    // Synthetic data is injected only into this isolated test profile, never into a shipped build.
    await script((done) =>
      browser.runtime
        .sendMessage({ type: 'read' })
        .then(async (s) => {
          const now = Date.now();
          const q = {
            id: 'five_hour',
            label: '5-hour allowance',
            used: 28,
            remaining: 72,
            resetAt: now + 7200000,
            durationMs: 18000000,
            source: 'TEST FIXTURE ONLY',
          };
          s.providers.claude = {
            provider: 'claude',
            status: 'ok',
            detail: 'TEST FIXTURE ONLY',
            quotas: [
              q,
              { ...q, id: 'seven_day', label: 'Weekly allowance', used: 10, remaining: 90 },
              { ...q, id: 'seven_day_sonnet', label: 'Weekly · sonnet', used: 5, remaining: 95 },
              { ...q, id: 'seven_day_opus', label: 'Weekly · opus', used: 5, remaining: 95 },
            ],
            lastSuccess: now,
            lastAttempt: now,
            nextAttempt: now + 86400000,
            failures: 0,
          };
          s.providers.codex = {
            ...s.providers.claude,
            provider: 'codex',
            quotas: [
              { ...q, id: 'primary_window', used: 10, remaining: 90 },
              { ...q, id: 'secondary_window', label: 'Weekly allowance', used: 20, remaining: 80 },
            ],
          };
          s.history = [8, 18, 28].map((used, i) => ({
            ...q,
            provider: 'claude',
            status: 'ok',
            timestamp: now - (2 - i) * 900000,
            used,
            remaining: 100 - used,
            resetAt: q.resetAt + [437, -183, 445][i],
          }));
          s.history.push(
            ...s.history.map((p, i) => ({
              ...p,
              id: 'seven_day',
              used: 8 + i,
              remaining: 92 - i,
            })),
          );
          await browser.storage.local.set({ monitor: s });
          done();
        })
        .catch((e) => done({ error: String(e) })),
    );
    await driver.get(`moz-extension://${uuid}/popup.html`);
    await driver.wait(until.elementLocated(By.css('progress')), 10000);
    const snapshot = await driver.executeScript(() => ({
      text: document.body.innerText,
      hours: document.querySelector('.reset-hours').textContent,
      date: document.querySelector('.reset-date').textContent,
      iso: document.querySelector('time.reset-date').getAttribute('datetime'),
      forecasts: [...document.querySelectorAll('.claude .forecast-summary .compact-detail')].map(
        (p) => p.textContent,
      ),
    }));
    assert.match(snapshot.text, /72%/);
    assert.match(snapshot.hours, /2h 0m left/);
    assert.ok(snapshot.iso.endsWith('Z'));
    assert.ok(!snapshot.date.includes('left'));
    const forecasts = snapshot.forecasts;
    assert.equal(forecasts.length, 2);
    assert.match(forecasts[0], /Session.*40.0%\/h/s);
    assert.match(forecasts[1], /Weekly.*4.0%\/h/s);

    assert.equal((await driver.findElements(By.css('.chart svg'))).length, 0);
    console.log(
      'Popup dimensions',
      await driver.executeScript(() => ({
        width: document.body.getBoundingClientRect().width,
        height: document.body.getBoundingClientRect().height,
      })),
    );
    assert.ok(
      await driver.executeScript(() => document.body.getBoundingClientRect().height <= 580),
      'Popup must fit within 580px',
    );
    const badge = await script((done) =>
      browser.runtime
        .sendMessage({ type: 'popup' })
        .then(() => browser.action.getBadgeText({}))
        .then(done),
    );
    assert.equal(badge, '');
    const fill = await driver.executeScript(
      () =>
        getComputedStyle(document.querySelector('progress'), '::-moz-progress-bar').backgroundColor,
    );
    assert.equal(fill, 'rgb(36, 135, 103)');
    assert.equal(
      await driver.executeScript(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  });
  await writeFile(
    'artifacts/firefox-popup-test-fixture.png',
    await driver.findElement(By.css('body')).takeScreenshot(),
    'base64',
  );
  await run('larger light popup has readable reset text and no scrolling', async () => {
    await script((done) =>
      browser.runtime.sendMessage({ type: 'read' }).then(async (s) => {
        s.settings.theme = 'light';
        s.settings.enabled.chatgpt = false;
        await browser.storage.local.set({ monitor: s });
        done();
      }),
    );
    await driver.wait(
      async () => driver.executeScript(() => document.documentElement.dataset.theme === 'light'),
      10000,
    );
    const sizes = await driver.executeScript(() => ({
      date: parseFloat(getComputedStyle(document.querySelector('.reset-date')).fontSize),
      time: parseFloat(getComputedStyle(document.querySelector('.reset-hours')).fontSize),
      percent: parseFloat(
        getComputedStyle(document.querySelector('.compact-quota strong')).fontSize,
      ),
      width: document.body.getBoundingClientRect().width,
      height: document.body.getBoundingClientRect().height,
    }));
    assert.equal(sizes.width, 520);
    assert.ok(sizes.date >= 12 && sizes.time >= 11 && sizes.percent >= 16);
    console.log('Light popup dimensions', sizes);
    assert.ok(sizes.height <= 580);
    await writeFile(
      'artifacts/firefox-popup-readable-light.png',
      await driver.findElement(By.css('body')).takeScreenshot(),
      'base64',
    );
  });
  await run('expired short window leaves current weekly readings and forecast usable', async () => {
    await script((done) =>
      browser.runtime.sendMessage({ type: 'read' }).then(async (s) => {
        s.providers.claude.quotas[0].resetAt = Date.now() - 1000;
        const weekly = s.providers.claude.quotas[1];
        weekly.used = 28;
        weekly.remaining = 72;
        s.history = s.history
          .filter((p) => p.id === 'five_hour')
          .map((p, i) => ({
            ...p,
            id: weekly.id,
            resetAt: weekly.resetAt + [437, -183, 445][i],
          }));
        await browser.storage.local.set({ monitor: s });
        done();
      }),
    );
    await driver.get(`moz-extension://${uuid}/popup.html`);
    await driver.wait(until.elementLocated(By.css('.claude progress')), 10000);
    // Read one DOM snapshot: refresh replaces nodes while this page is opening.
    const snapshot = await driver.wait(
      () =>
        driver.executeScript(() => {
          const summary = document.querySelector(
            '.claude .forecast-summary .compact-detail:last-child',
          )?.textContent;
          if (!summary?.includes('40.0%/h')) return false;
          return [...document.querySelectorAll('.claude progress')].map((meter) =>
            meter.getAttribute('aria-label'),
          );
        }),
      10000,
    );
    assert.match(snapshot[0], /stale/);
    assert.doesNotMatch(snapshot[1], /stale/);
  });
  await run('history graphs and range selector are available in settings', async () => {
    await driver.get(`moz-extension://${uuid}/options.html#history`);
    await driver.wait(until.elementLocated(By.css('.chart svg')), 10000);
    assert.ok(
      await driver.executeScript(() =>
        [...document.querySelectorAll('.chart svg path')].some((path) =>
          path.getAttribute('d').includes('L'),
        ),
      ),
      'Reset timestamp jitter must not split every history point into a separate path',
    );
    await driver
      .findElement(By.css('select[aria-label="History time range"] option[value="7"]'))
      .click();
    assert.equal(
      await driver
        .findElement(By.css('select[aria-label="History time range"]'))
        .getAttribute('value'),
      '7',
    );
  });
  await run('settings suppress forecasts after authentication fails', async () => {
    await script((done) =>
      browser.runtime.sendMessage({ type: 'read' }).then(async (s) => {
        s.providers.claude.status = 'auth';
        await browser.storage.local.set({ monitor: s });
        done();
      }),
    );
    await driver.get(`moz-extension://${uuid}/options.html`);
    await driver.wait(until.elementLocated(By.css('#readings')), 10000);
    const readings = await driver.findElement(By.css('#readings')).getText();
    assert.match(readings, /Last known readings · stale/);
    assert.doesNotMatch(readings, /40.0%\/h/);
  });
  await run('history clear requires confirmation and clears observations', async () => {
    await driver.get(`moz-extension://${uuid}/options.html`);
    await driver.wait(until.elementLocated(By.css('.danger')), 10000);
    await driver.findElement(By.css('.danger')).click();
    await driver.switchTo().alert().accept();
    await driver.wait(async () => {
      const s = await script((done) => browser.runtime.sendMessage({ type: 'read' }).then(done));
      return s.history.length === 0;
    }, 10000);
  });
  await writeFile(
    'artifacts/firefox-smoke-results.json',
    JSON.stringify(
      {
        firefox: caps.get('browserVersion'),
        checks: results,
        realAccountTested: false,
        providerNetworkBlocked: true,
      },
      null,
      2,
    ),
  );
} finally {
  await driver.quit();
}
