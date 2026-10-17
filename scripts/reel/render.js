// Renders scripts/reel/film.html frame by frame in headless Chrome and encodes it with ffmpeg.
// Needs: npm i -D puppeteer-core ffmpeg-static   (Chrome installed)
// usage: node scripts/reel/render.js stills 2.5,7.5,12.5   |   node scripts/reel/render.js video out.mp4
// then for the web: ffmpeg -i out.mp4 -vf scale=960:540 -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart -an public/video/synapx-reel.mp4
const puppeteer = require('puppeteer-core');
const ffmpeg = require('ffmpeg-static');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const [mode, arg] = process.argv.slice(2);
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-watchdog', '--disable-features=GpuWatchdog'],
    protocolTimeout: 600000,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('console', (m) => console.log('[page]', m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(require('url').pathToFileURL(path.resolve(__dirname, 'film.html')).href, { timeout: 0 });
  await page.evaluate(() => window.ready);
  console.log('GPU:', await page.evaluate(() => window.gpu));
  if (mode === 'stills') {
    fs.mkdirSync(path.join(__dirname, 'stills'), { recursive: true });
    for (const t of arg.split(',').map(Number)) {
      const t0 = Date.now();
      const url = await page.evaluate((t) => window.renderAt(t), t);
      fs.writeFileSync(path.join(__dirname, 'stills', `t${t}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
      console.log('still', t, Date.now() - t0, 'ms');
    }
  } else {
    const N = 24 * 30;
    const ff = spawn(ffmpeg, ['-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
      '-movflags', '+faststart', '-an', arg], { stdio: ['pipe', 'inherit', 'inherit'] });
    const t0 = Date.now();
    for (let f = 0; f < N; f++) {
      const url = await page.evaluate((t) => window.renderAt(t), f / 30);
      if (!ff.stdin.write(Buffer.from(url.split(',')[1], 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % 30 === 0) console.log(`frame ${f}/${N}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
  }
  await browser.close();
})();
