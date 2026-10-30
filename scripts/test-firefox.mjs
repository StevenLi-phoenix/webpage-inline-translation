// Test the installed Firefox in an isolated profile. Only model URLs in a
// disposable build are redirected; real download, hash and inference code runs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { startFirefox } from './lib/firefox.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, '.npm-cache/firefox');
await fs.mkdir(path.join(output, 'models'), { recursive: true });
new vm.Script(await fs.readFile(path.join(root, 'dist-firefox/content.js'), 'utf8'));
assert.ok((await fs.stat(path.join(root, 'dist-firefox/ocr-runtime/engine.js'))).size < 5 * 1024 * 1024);
assert.equal((await fs.readFile(path.join(root, 'dist-firefox/ocr-runtime/opencv.wasm'))).subarray(0, 4).toString('hex'), '0061736d');
const catalog = JSON.parse(await fs.readFile(path.join(root, 'src/local/catalog.json'), 'utf8'));
const model = catalog.find(entry => entry.id === 'en-zh-Hans');
const ocrBase = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/';
const fixtures = new Map(model.files.map(file => [file.name, { url: file.url,
  local: path.join(process.env.LOCAL_MODEL_FIXTURE_DIR || path.join(root, '.npm-cache/bergamot'), file.name) }]));
for (const name of ['PP-OCRv5_mobile_det', 'PP-OCRv5_mobile_rec']) {
  fixtures.set(`${name}_onnx_infer.tar`, { url: `${ocrBase}${name}_onnx_infer.tar` });
}
const calls = [], origins = [];
let modelRequests = 0;
let delayLocalDownload = true;
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
pdf.addPage([595, 842]).drawText('Firefox translation test.', { x: 60, y: 740, size: 14, font });
const pdfBytes = await pdf.save();
const pdfFile = path.join(output, 'fixture.pdf');
await fs.writeFile(pdfFile, pdfBytes);
const html = `<!doctype html><meta charset="utf-8"><title>Firefox translation fixture</title>
<style>body{margin:32px;font:16px/1.6 Arial}main{max-width:720px}img{display:block;width:600px;height:180px}</style>
<main><h2>Firefox translation test</h2><p id="rich">Use <code>first()</code> before continuing.</p>
<p hidden>Hidden private text.</p><p contenteditable="true">Unsent private draft.</p></main>
<img id="sample"><script>const c=document.createElement('canvas');c.width=600;c.height=180;
const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,600,180);ctx.fillStyle='#172026';
ctx.font='28px Arial';ctx.fillText('Cache performance',25,60);ctx.fillText('Hit rate 41.7%',25,120);
document.querySelector('img').src=c.toDataURL();</script>`;
const server = createServer(async (request, response) => {
  try {
    response.setHeader('access-control-allow-origin', '*');
    if (request.url.startsWith('/models/')) {
      const name = decodeURIComponent(request.url.slice('/models/'.length));
      const fixture = fixtures.get(name);
      if (!fixture) { response.writeHead(404).end(); return; }
      modelRequests++;
      if (delayLocalDownload && model.files.some(file => file.name === name)) {
        delayLocalDownload = false;
        // Exceed Firefox's normal 30-second event-page idle timeout.
        await delay(35_000);
      }
      const cached = path.join(output, 'models', name);
      let bytes;
      try { bytes = await fs.readFile(fixture.local || cached); }
      catch {
        try { bytes = await fs.readFile(cached); }
        catch {
          console.log('Downloading public model:', name);
          const downloaded = await fetch(fixture.url, { signal: AbortSignal.timeout(180_000) });
          if (!downloaded.ok) throw new Error(`Model download HTTP ${downloaded.status}`);
          bytes = Buffer.from(await downloaded.arrayBuffer());
          await fs.writeFile(cached, bytes);
        }
      }
      const offset = Number(/^bytes=(\d+)-$/.exec(request.headers.range || '')?.[1] || 0);
      response.writeHead(offset ? 206 : 200, { 'content-type': 'application/octet-stream', 'content-length': String(bytes.length - offset),
        ...(offset ? { 'content-range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}` } : {}) });
      response.end(bytes.subarray(offset));
    } else if (request.url === '/fixture.pdf') {
      response.writeHead(200, { 'content-type': 'application/pdf' }).end(pdfBytes);
    } else if (request.method === 'POST') {
      let body = ''; for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      const texts = payload.texts || JSON.parse(payload.messages.at(-1).content).texts;
      calls.push(...texts); origins.push(request.headers.origin || null);
      const translations = texts.map(text => text.includes('⟪WUPAGESEGMENT')
        ? text.replace(/(⟪WUPAGESEGMENT\d+⟫\n)/g, '$1译文：') : `译文：${text}`);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload.texts ? { translations } : { choices: [{ message: { content: JSON.stringify(translations) } }] }));
    } else response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  } catch (error) { console.error(error); response.writeHead(500).end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const extension = await fs.mkdtemp(path.join(output, 'extension-'));
await fs.cp(path.join(root, 'dist-firefox'), extension, { recursive: true });
async function redirectModels(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) { await redirectModels(location); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const source = await fs.readFile(location, 'utf8');
    let updated = source.replaceAll(ocrBase, `${origin}/models/`);
    for (const file of model.files) updated = updated.replaceAll(file.url, `${origin}/models/${file.name}`);
    if (updated !== source) await fs.writeFile(location, updated);
  }
}
await redirectModels(extension);
let firefox;
const report = { passed: false, checks: [],
  environment: 'Installed Firefox in an isolated profile. Online translation uses a local mock service; OCR and Bergamot run real models with production integrity checks. Only model URLs in a disposable test build are redirected.' };
const check = name => { report.checks.push(name); console.log('PASS:', name); };
try {
  firefox = await startFirefox(output, extension);
  report.version = firefox.session.capabilities.browserVersion;
  const controlResult = await firefox.command('WebDriver:GetWindowHandle');
  const control = controlResult.value ?? controlResult;
  const select = handle => firefox.command('WebDriver:SwitchToWindow', { handle });
  const api = async (script, args = []) => {
    await select(control);
    const result = await firefox.executeAsync(`const done=arguments[arguments.length-1];
      const input=JSON.parse(arguments[0]); const chrome=window.wrappedJSObject.chrome;
      (async()=>{${script}})().then(value=>done(JSON.stringify({value})),error=>done(JSON.stringify({error:String(error)})));`, [JSON.stringify(args)]);
    const parsed = JSON.parse(result);
    if (parsed.error) throw new Error(parsed.error);
    return parsed.value;
  };
  const runtime = async request => {
    const response = await api('return chrome.runtime.sendMessage(input[0]);', [request]);
    assert.equal(response?.ok, true, JSON.stringify(response)); return response.data;
  };
  const waitFor = async (read, predicate, label, timeout = 30_000) => {
    const start = Date.now(); let value;
    do { value = await read(); if (predicate(value)) return value; await delay(150); } while (Date.now() - start < timeout);
    throw new Error(`Timed out: ${label}; last value: ${JSON.stringify(value)}`);
  };
  const screenshot = async name => {
    const result = await firefox.command('WebDriver:TakeScreenshot', { id: null, highlights: [], full: true });
    await fs.writeFile(path.join(output, name), Buffer.from(result.value, 'base64'));
  };
  await firefox.command('WebDriver:Navigate', { url: `${firefox.base}options.html` });
  const settings = await runtime({ type: 'GET_SETTINGS' });
  Object.assign(settings, { activeProviderId: 'http-template', cacheEnabled: true, sourceLang: 'en', targetLang: 'zh-CN' });
  Object.assign(settings.providers.find(entry => entry.id === 'http-template'), { url: `${origin}/translate`, method: 'POST',
    headers: { 'Content-Type': 'application/json' }, bodyTemplate: '{"texts":{{json texts}}}', responsePath: 'translations' });
  await runtime({ type: 'SAVE_SETTINGS', settings });
  await firefox.command('WebDriver:Refresh');
  assert.equal((await runtime({ type: 'GET_SETTINGS' })).activeProviderId, 'http-template');
  assert.equal((await runtime({ type: 'GET_OCR_STATUS' })).state, 'missing');
  assert.equal((await runtime({ type: 'GET_LOCAL_MODEL_STATUS' })).models.find(entry => entry.id === model.id).state, 'missing');
  assert.equal(modelRequests, 0);
  check('installation, settings persistence, local runtime readiness and no implicit model downloads');
  await screenshot('options.png');

  const newWindow = await firefox.command('WebDriver:NewWindow', { type: 'tab' });
  const page = (newWindow.value ?? newWindow).handle;
  await select(page); await firefox.command('WebDriver:Navigate', { url: `${origin}/page` });
  await waitFor(() => firefox.execute('return !!document.getElementById("wupage-floating-ball");'), Boolean, 'content script');
  const message = request => api('const tab=(await chrome.tabs.query({})).find(tab=>tab.url===input[0]); await chrome.tabs.update(tab.id,{active:true}); return chrome.tabs.sendMessage(tab.id,input[1]);', [`${origin}/page`, request]);
  const translated = await message({ type: 'TRANSLATE_PAGE' });
  assert.equal(translated.ok, true, JSON.stringify(translated));
  assert.equal(translated.data.failed, 0); assert.equal(translated.data.translated, 2);
  assert.equal(calls.some(text => /Hidden private|Unsent private/.test(text)), false);
  for (const mode of ['replace', 'bilingual-accent', 'bilingual']) {
    const before = calls.length;
    await runtime({ type: 'SAVE_SETTINGS', settings: { ...settings, translationDisplayMode: mode } });
    await select(page);
    await waitFor(() => firefox.execute('return [...document.querySelectorAll(".wupage-translation")].map(node=>node.dataset.wupageDisplayMode);'),
      values => values.length === 2 && values.every(value => value === mode), 'display mode');
    assert.equal(calls.length, before);
  }
  await screenshot('page.png'); await message({ type: 'CLEAR_TRANSLATION' }); await select(page);
  assert.equal(await firefox.execute('return document.querySelectorAll(".wupage-translation").length;'), 0);
  check('content script translation, protected code, draft exclusion, display modes and clear');

  const provider = settings.providers.find(entry => entry.id === 'openai-compatible');
  Object.assign(provider, { baseURL: `${origin}/v1`, apiKey: 'test-only', model: 'fixture' });
  await runtime({ type: 'SAVE_SETTINGS', settings: { ...settings, activeProviderId: provider.id } });
  assert.match((await runtime({ type: 'TEST_PROVIDER', providerId: provider.id })).translation, /译文/);
  await runtime({ type: 'SAVE_SETTINGS', settings });
  check('OpenAI-compatible request');

  await select(page);
  await firefox.command('WebDriver:Navigate', { url: `${firefox.base}pdf.html?url=${encodeURIComponent(`${origin}/fixture.pdf`)}&translate=1` });
  await waitFor(() => firefox.execute('return {rendered:!!document.querySelector(".translation-canvas-shell.is-rendered"),text:document.body.textContent};'), value => value.rendered, 'PDF translation');
  await screenshot('pdf.png');
  await firefox.command('WebDriver:Navigate', { url: `${firefox.base}pdf.html` });
  const fileInput = await firefox.command('WebDriver:FindElement', { using: 'css selector', value: '#fileInput' });
  await firefox.command('WebDriver:ElementSendKeys', { id: Object.values(fileInput.value)[0], text: pdfFile, value: [...pdfFile] });
  await waitFor(() => firefox.execute('return document.querySelectorAll(".page-row").length;'), count => count === 1, 'local PDF file selection');
  check('remote PDF automatic translation and local PDF file selection');

  await runtime({ type: 'INSTALL_OCR' });
  const ocr = await waitFor(() => runtime({ type: 'GET_OCR_STATUS' }), value => ['installed', 'error'].includes(value.state), 'OCR model installation', 240_000);
  assert.equal(ocr.state, 'installed', JSON.stringify(ocr));
  settings.imageTranslationEnabled = true; await runtime({ type: 'SAVE_SETTINGS', settings });
  await select(page); await firefox.command('WebDriver:Navigate', { url: `${origin}/page` });
  const dataUrl = await firefox.execute('return document.querySelector("#sample").src;');
  const imageRequest = { type: 'TRANSLATE_IMAGE', dataUrl, width: 600, height: 180 };
  const image = await runtime(imageRequest);
  assert.ok(image.regions.length >= 2, JSON.stringify(image));
  assert.ok(calls.some(text => /Cache performance/i.test(text)), 'Recognized text reaches the provider');
  const before = calls.length;
  assert.equal((await runtime(imageRequest)).cached, true); assert.equal(calls.length, before);
  check('real OCR download, hash verification, isolated sandbox, recognition and translation cache');
  await select(page);
  const pointer = await firefox.execute('const r=document.querySelector("#sample").getBoundingClientRect();return {x:Math.round(r.left+100),y:Math.round(r.top+50)};');
  await firefox.command('WebDriver:PerformActions', { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' },
    actions: [{ type: 'pointerMove', duration: 0, ...pointer }] }] });
  await waitFor(() => firefox.execute('return !!document.querySelector("#wupage-image-tools")?.shadowRoot.querySelector("button");'), Boolean, 'image button');
  await firefox.execute('document.querySelector("#wupage-image-tools").shadowRoot.querySelector("button").click();');
  await waitFor(() => firefox.execute('return document.querySelector("#wupage-image-tools")?.shadowRoot.querySelector("button")?.textContent;'), text => text === '原', 'image overlay');
  await screenshot('image.png');
  for (let cycle = 0; cycle < 3; cycle++) {
    await firefox.execute('document.querySelector("#wupage-image-tools").shadowRoot.querySelector("button").click();');
    await firefox.execute('document.querySelector("#wupage-image-tools").shadowRoot.querySelector("button").click();');
  }
  assert.equal(calls.length, before);
  check('real image button, translated canvas overlay and repeated original/translation toggles');

  await runtime({ type: 'SAVE_SETTINGS', settings: { ...settings, activeProviderId: 'firefox-local' } });
  const missing = await api('return chrome.runtime.sendMessage(input[0]);', [{ type: 'TRANSLATE_BATCH', texts: ['Hello world'], sourceLang: 'en', targetLang: 'zh-CN' }]);
  assert.equal(missing.ok, false); assert.match(missing.error, /下载或导入/);
  await runtime({ type: 'INSTALL_LOCAL_MODEL', modelId: model.id });
  await firefox.command('WebDriver:Navigate', { url: 'about:blank' });
  await select(page); await firefox.command('WebDriver:Navigate', { url: 'about:blank' });
  // No extension UI, status polling or browser API activity keeps it awake.
  await delay(36_000);
  await select(control); await firefox.command('WebDriver:Navigate', { url: `${firefox.base}options.html` });
  const backgroundDownload = await runtime({ type: 'GET_LOCAL_MODEL_STATUS' });
  assert.ok(backgroundDownload.downloading || backgroundDownload.models.find(entry => entry.id === model.id).state === 'ready', 'Closing the UI must not cancel the model download');
  await waitFor(() => runtime({ type: 'GET_LOCAL_MODEL_STATUS' }), value => value.models.find(entry => entry.id === model.id).state === 'ready', 'Bergamot model installation', 240_000);
  check('model download continues with all extension and source tabs closed for over 30 seconds');
  const modelDownloads = modelRequests;
  await firefox.command('Marionette:SetContext', { value: 'chrome' }); await firefox.execute('Services.io.offline=true;');
  await firefox.command('Marionette:SetContext', { value: 'content' });
  const local = await runtime({ type: 'TRANSLATE_BATCH', texts: ['Hello world. This is a local translation test.'], sourceLang: 'en', targetLang: 'zh-CN' });
  assert.match(local.translations[0], /[\u4e00-\u9fff]/);
  const auto = await runtime({ type: 'TRANSLATE_BATCH', texts: ['This is an English sentence that can be reliably detected without any network connection.'], sourceLang: 'auto', targetLang: 'zh-CN' });
  assert.match(auto.translations[0], /[\u4e00-\u9fff]/); assert.equal(modelRequests, modelDownloads);
  check('real Bergamot model, offline English to Chinese translation and automatic language detection');
  report.localTranslation = local;
  await firefox.command('Marionette:SetContext', { value: 'chrome' }); await firefox.execute('Services.io.offline=false;');
  await firefox.command('Marionette:SetContext', { value: 'content' });
  await runtime({ type: 'REMOVE_LOCAL_MODEL', modelId: model.id });
  assert.equal((await runtime({ type: 'GET_LOCAL_MODEL_STATUS' })).models.find(entry => entry.id === model.id).state, 'missing');
  await runtime({ type: 'REMOVE_OCR' });
  assert.equal((await runtime({ type: 'GET_OCR_STATUS' })).state, 'missing');
  assert.equal((await runtime({ type: 'GET_SETTINGS' })).imageTranslationEnabled, false);
  check('model deletion and persisted image translation settings');
  report.passed = true;
} catch (error) {
  report.error = String(error);
  if (firefox) {
    try {
      const shot = await firefox.command('WebDriver:TakeScreenshot', { id: null, highlights: [], full: true });
      await fs.writeFile(path.join(output, 'failure.png'), Buffer.from(shot.value, 'base64'));
    } catch { /* Keep the original failure. */ }
  }
  throw error;
} finally {
  if (firefox) await firefox.close();
  await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}
