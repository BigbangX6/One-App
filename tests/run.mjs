// Banc d'essai de One App : exécute index.html dans Chromium face à un faux
// Google Drive (en mémoire). Lancement : node tests/run.mjs  (voir tests/README.md)
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { execSync } from 'child_process';

// Playwright installé localement (npm install) ou globalement
async function loadPlaywright() {
  try { return await import('playwright'); }
  catch (e) {
    const globalRoot = execSync('npm root -g').toString().trim();
    return import(pathToFileURL(path.join(globalRoot, 'playwright', 'index.mjs')).href);
  }
}
const { chromium } = await loadPlaywright();

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ONEAPP_ROOT || path.resolve(TESTS_DIR, '..');
const PORT = 8765;
const fixture = (name) => fs.readFileSync(path.join(TESTS_DIR, 'fixtures', name), 'utf8');
const only = process.argv[2]; // filtre optionnel : node tests/run.mjs "Compteur"
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200); res.end(fs.readFileSync(p));
}).listen(PORT);

// ---------- Faux Google Drive ----------
let files, seq, rev, ctl, log;
function reset() {
  seq = 0; rev = 0; log = [];
  ctl = { patchDelay: 0, failPatch: 0, force401: 0, validToken: 'tok1' };
  files = {};
  add({ id: 'root1', name: 'One App', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] });
  add({ id: 'fold1', name: "L'agenda", mimeType: 'application/vnd.google-apps.folder', parents: ['root1'] });
  add({ id: 'app1', name: "L'agenda.oneapp", mimeType: 'text/html', parents: ['fold1'], content: APP_HTML });
  add({ id: 'doc1', name: 'Doc.onefile', mimeType: 'application/json', parents: ['fold1'],
        content: JSON.stringify({ oneapp_metadata: { app_name: "L'agenda", source_app_drive_id: 'app1' }, app_data: ['initial'] }) });
  add({ id: 'pdf1', name: '#Ouvrir One App.pdf', mimeType: 'application/pdf', parents: ['root1'] });
}
function add(f) { f.headRevisionId = 'r' + (++rev); f.modifiedTime = new Date(Date.now() + rev).toISOString(); f.ownedByMe = true; files[f.id] = f; return f; }
function touchContent(f, content) { f.content = content; f.headRevisionId = 'r' + (++rev); f.modifiedTime = new Date(Date.now() + rev * 1000).toISOString(); }
function touchMeta(f) { f.modifiedTime = new Date(Date.now() + (++rev) * 1000).toISOString(); }

const APP_HTML = `<!DOCTYPE html><html><head><title>L'agenda</title></head><body><script>
window.OneAppAPI = window.OneAppAPI || { loadData: async () => ({ app_data: [] }), saveData: () => {} };
window.shown = null;
window.OneAppInternal_OnRestore = (d) => { window.shown = d; };
window.OneAppAPI.loadData().then(r => { window.shown = r.app_data; });
<\/script></body></html>`;

async function handleDrive(route) {
  const req = route.request();
  const url = new URL(req.url());
  const auth = req.headers()['authorization'];
  const method = req.method();
  log.push(`${method} ${url.pathname}${url.search}`);
  const json = (obj, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });

  if (ctl.force401 > 0 || auth !== `Bearer ${ctl.validToken}`) {
    if (ctl.force401 > 0) ctl.force401--;
    return json({ error: { message: 'Invalid Credentials' } }, 401);
  }
  if (url.pathname.includes('userinfo')) return json({ email: 'test@example.com' });

  const m = url.pathname.match(/\/(upload\/)?drive\/v3\/files(?:\/([^/]+))?(\/permissions|\/revisions)?/);
  const isUpload = !!m[1]; const id = m[2]; const sub = m[3];

  if (sub === '/permissions') return json({ id: 'perm1' });
  if (sub === '/revisions') return json({ revisions: [] });

  if (!id && method === 'GET') {
    const q = url.searchParams.get('q');
    let list = Object.values(files).filter(f => !f.trashed);
    const nm = q.match(/name = '((?:\\'|[^'])*)'/);
    if (nm) { const name = nm[1].replace(/\\'/g, "'"); list = list.filter(f => f.name === name); }
    if (q.includes("contains '.oneapp'")) list = list.filter(f => f.name.includes('.oneapp'));
    if (q.includes("contains '.onefile'")) list = list.filter(f => f.name.includes('.onefile'));
    const par = q.match(/'([^']+)' in parents/); if (par) list = list.filter(f => (f.parents || []).includes(par[1]));
    if (q.includes('shortcut')) list = [];
    return json({ files: list.map(f => ({ id: f.id, name: f.name, parents: f.parents, mimeType: f.mimeType, modifiedTime: f.modifiedTime })) });
  }
  if (!id && method === 'POST') {
    let meta, content = '';
    if (isUpload) {
      const body = req.postData(); const parts = body.split(/\r\n--[^\r\n]+(?:\r\n|--)/).filter(p => p.includes('Content-Type'));
      meta = JSON.parse(parts[0].split('\r\n\r\n').slice(1).join('\r\n\r\n'));
      content = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n');
    } else meta = JSON.parse(req.postData());
    const f = add({ id: 'new' + (++seq), ...meta, content });
    return json({ id: f.id, name: f.name });
  }
  const f = files[id];
  if (!f) return json({ error: { message: 'not found' } }, 404);
  if (method === 'GET') {
    if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, body: f.content });
    return json({ id: f.id, name: f.name, parents: f.parents, modifiedTime: f.modifiedTime, headRevisionId: f.headRevisionId, ownedByMe: f.ownedByMe, capabilities: { canEdit: true, canShare: true } });
  }
  if (method === 'PATCH' && isUpload) {
    if (ctl.patchDelay) await new Promise(r => setTimeout(r, ctl.patchDelay));
    if (ctl.failPatch > 0) { ctl.failPatch--; return json({ error: { message: 'Backend Error' } }, 500); }
    touchContent(f, req.postData());
    return json({ id: f.id, modifiedTime: f.modifiedTime, headRevisionId: f.headRevisionId });
  }
  if (method === 'PATCH') { Object.assign(f, JSON.parse(req.postData())); touchMeta(f); return json({ id: f.id }); }
  return json({}, 400);
}

// ---------- Harnais ----------
const browser = await chromium.launch();
let failures = 0;
async function test(name, fn) {
  if (only && !name.includes(only)) return;
  reset();
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => { page._dialogs = (page._dialogs || []).concat(d.message()); d.accept(); });
  await context.route('https://accounts.google.com/**', r => r.fulfill({ status: 200, body: '' }));
  await context.route('https://www.googleapis.com/**', handleDrive);
  await context.addInitScript(() => {
    if (window !== window.top) return; // pas dans l'iframe de l'app (sandbox)
    if (location.search.includes('notoken')) { localStorage.clear(); }
    else {
      localStorage.setItem('oneapp_gdrive_token', 'tok1');
      localStorage.setItem('oneapp_gdrive_expire', String(Date.now() + 3600e3));
    }
    // Faux Google Identity Services, piloté par window.__gisMode
    window.__gisMode = 'ok'; window.__gisCalls = 0;
    window.google = { accounts: { oauth2: { initTokenClient: (cfg) => ({ requestAccessToken: () => {
      window.__gisCalls++;
      setTimeout(() => {
        if (window.__gisMode === 'ok') cfg.callback({ access_token: window.__nextToken || 'tok2', expires_in: 3600 });
        else cfg.error_callback({ type: 'popup_failed_to_open' });
      }, 50);
    } }) } } };
  });
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForFunction(() => document.querySelector('.app-card'));
  try {
    await fn(page);
    await wait(50);
    if (pageErrors.length) throw new Error('Erreur JavaScript : ' + pageErrors.join(' | '));
    console.log('✅', name);
  } catch (e) {
    failures++;
    console.log('❌', name, '\n   ', e.message.split('\n')[0]);
    console.log('    log:', log.slice(-12).join('\n         '));
  }
  await context.close();
}
const openDoc = async (page) => {
  await page.evaluate(() => openAppEnvironment('app1', "L'agenda", 'doc1', 'Doc'));
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'));
  const frame = page.frames().find(f => f !== page.mainFrame());
  await frame.waitForFunction(() => window.shown !== null);
  return frame;
};
const saved = () => JSON.parse(files.doc1.content).app_data;
const save = (frame, data) => frame.evaluate(d => window.OneAppAPI.saveData(d), data);
const wait = ms => new Promise(r => setTimeout(r, ms));
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); }

await test("Liste des apps : dossier avec apostrophe trouvé (pas de doublon)", async (page) => {
  eq(Object.values(files).filter(f => f.name === "L'agenda").length, 1, 'dossiers');
});

await test("Sauvegarde normale après 3 s", async (page) => {
  const frame = await openDoc(page);
  eq(frame && true, true, 'iframe');
  await save(frame, ['a']);
  await wait(4500);
  eq(saved(), ['a'], 'contenu Drive');
  eq(await page.evaluate(() => isDirty), false, 'isDirty');
});

await test("Modification pendant un envoi lent : rien n'est perdu", async (page) => {
  const frame = await openDoc(page);
  ctl.patchDelay = 2500;
  await save(frame, ['v1']);
  await wait(3500);               // envoi de v1 en cours
  await save(frame, ['v2']);      // modif pendant l'envoi
  await wait(8000);
  eq(saved(), ['v2'], 'contenu Drive');
  eq(await page.evaluate(() => isDirty), false, 'isDirty');
});

await test("Fermer le fichier juste après une modif : enregistrée quand même", async (page) => {
  const frame = await openDoc(page);
  await save(frame, ['fermeture']);
  await wait(200);
  await page.evaluate(() => closeApp());
  eq(saved(), ['fermeture'], 'contenu Drive');
});

await test("Erreur serveur 500 : pas marqué enregistré, nouvel essai automatique", async (page) => {
  const frame = await openDoc(page);
  ctl.failPatch = 1;
  await save(frame, ['retry']);
  await wait(4000);
  eq(await page.evaluate(() => isDirty), true, 'isDirty après échec');
  eq(await page.evaluate(() => document.getElementById('sync-status-btn').style.color), 'rgb(239, 68, 68)', 'icône rouge');
  await wait(6000);
  eq(saved(), ['retry'], 'contenu Drive après nouvel essai');
  eq(await page.evaluate(() => isDirty), false, 'isDirty');
});

await test("Jeton expiré (401) : renouvelé automatiquement, puis enregistré", async (page) => {
  const frame = await openDoc(page);
  ctl.validToken = 'tok2';        // l'ancien jeton n'est plus valide
  await save(frame, ['apres-401']);
  await wait(5000);
  eq(saved(), ['apres-401'], 'contenu Drive');
  eq(await page.evaluate(() => localStorage.getItem('oneapp_gdrive_token')), 'tok2', 'jeton stocké');
});

await test("Jeton expiré + popup bloquée : bandeau, puis reconnexion par clic", async (page) => {
  const frame = await openDoc(page);
  ctl.validToken = 'tok2';
  await page.evaluate(() => { window.__gisMode = 'fail'; });
  await save(frame, ['attente']);
  await wait(4500);
  eq(await page.isVisible('#session-banner'), true, 'bandeau visible');
  eq(await page.evaluate(() => isDirty), true, 'isDirty');
  await page.evaluate(() => { window.__gisMode = 'ok'; });
  await page.click('#session-banner button');
  await wait(1500);
  eq(await page.isVisible('#session-banner'), false, 'bandeau masqué');
  eq(saved(), ['attente'], 'contenu Drive');
});

await test("Renommer le fichier ne provoque plus de faux conflit", async (page) => {
  const frame = await openDoc(page);
  await page.fill('#running-file-title', 'Nouveau nom');
  await page.evaluate(() => renameActiveFile());
  await save(frame, ['apres-renommage']);
  await wait(4500);
  eq(saved(), ['apres-renommage'], 'contenu Drive');
  eq((page._dialogs || []).filter(d => d.includes('Conflit')).length, 0, 'alertes de conflit');
  eq(Object.values(files).filter(f => f.name.includes('secours')).length, 0, 'copies de secours');
});

await test("Vrai conflit (autre appareil) : copie de secours + version Cloud affichée", async (page) => {
  const frame = await openDoc(page);
  touchContent(files.doc1, JSON.stringify({ oneapp_metadata: { app_name: "L'agenda", source_app_drive_id: 'app1' }, app_data: ['autre-appareil'] }));
  await save(frame, ['local']);
  await wait(5000);
  const backup = Object.values(files).find(f => f.name.includes('secours'));
  if (!backup) throw new Error('pas de copie de secours');
  eq(JSON.parse(backup.content).app_data, ['local'], 'contenu de la copie');
  eq(saved(), ['autre-appareil'], 'Drive non écrasé');
  eq(await frame.evaluate(() => window.shown), ['autre-appareil'], "affiché dans l'app");
});

await test("Polling : mise à jour silencieuse venue d'un autre appareil", async (page) => {
  const frame = await openDoc(page);
  touchContent(files.doc1, JSON.stringify({ oneapp_metadata: {}, app_data: ['distant'] }));
  await page.evaluate(() => checkCloudVersion());
  await wait(500);
  eq(await frame.evaluate(() => window.shown), ['distant'], "affiché dans l'app");
});

await test("Undo puis fermeture : l'annulation est enregistrée", async (page) => {
  const frame = await openDoc(page);
  await save(frame, ['x1']);
  await wait(100);
  await save(frame, ['x2']);
  await wait(100);
  await page.evaluate(() => appUndo());
  await page.evaluate(() => closeApp());
  eq(saved(), ['x1'], 'contenu Drive');
});


// App construite à partir du squelette réellement donné aux IA
async function skeletonApp(page) {
  return page.evaluate(() => {
    const m = ONEAPP_RULES.match(/<script>\n(window\.OneAppAPI[\s\S]*?)<\/script>/);
    let code = m[1]
      .replace('const DEFAULT_STATE = { /* structure de départ des données */ };', 'const DEFAULT_STATE = { count: 0 };')
      .replace('function render() { /* ... */ }', 'function render() { document.body.dataset.count = state.count; document.body.dataset.ro = readOnly; }');
    return '<!DOCTYPE html>\n<html lang="fr">\n<head lang="fr">\n<title>Compteur</title></head><body><button id="b">+</button><script>' + code +
      '\ndocument.getElementById("b").onclick = () => { state.count++; commit(); };<\/script></body></html>';
  });
}
async function openSkeleton(page) {
  files.app1.content = await skeletonApp(page);
  await page.evaluate(() => openAppEnvironment('app1', "L'agenda", 'doc1', 'Doc'));
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'));
  const frame = page.frames().find(f => f !== page.mainFrame());
  await frame.waitForFunction(() => document.body && document.body.dataset.count !== undefined);
  return frame;
}

await test("Squelette du prompt : nouveau document ([]) → état par défaut, puis sauvegarde", async (page) => {
  const frame = await openSkeleton(page);
  eq(await frame.evaluate(() => document.body.dataset.count), '0', 'compteur initial');
  await frame.click('#b'); await frame.click('#b');
  await page.evaluate(() => closeApp());
  eq(saved(), { count: 2 }, 'contenu Drive');
});

await test("Squelette : Ctrl+Z dans l'app → Annuler via One App + onDataChange", async (page) => {
  const frame = await openSkeleton(page);
  await frame.click('#b'); await frame.click('#b');
  await frame.locator('body').press('Control+z');
  await wait(200);
  eq(await frame.evaluate(() => document.body.dataset.count), '1', 'après Ctrl+Z');
  await frame.locator('body').press('Control+y');
  await wait(200);
  eq(await frame.evaluate(() => document.body.dataset.count), '2', 'après Ctrl+Y');
});

await test("Squelette : passage en lecture seule notifié (onModeChange)", async (page) => {
  const frame = await openSkeleton(page);
  await page.evaluate(() => toggleAppMode());
  await wait(200);
  eq(await frame.evaluate(() => document.body.dataset.ro), 'true', 'readOnly dans l\'app');
});

await test("Squelette : loadData rappelé après modifs renvoie les données à jour", async (page) => {
  const frame = await openSkeleton(page);
  await frame.click('#b');
  await wait(100);
  eq((await frame.evaluate(() => OneAppAPI.loadData())).app_data, { count: 1 }, 'loadData');
});

await test("Nettoyage d'une réponse d'IA (texte + ```html)", async (page) => {
  const out = await page.evaluate(() => extractAppHtml("Voici ton app :\n```html\n<!DOCTYPE html>\n<html><body>ok</body></html>\n```\nBonne utilisation !"));
  eq(out, '<!DOCTYPE html>\n<html><body>ok</body></html>', 'html extrait');
  const out2 = await page.evaluate(() => extractAppHtml("Blabla <!DOCTYPE html><html></html> fin"));
  eq(out2, '<!DOCTYPE html><html></html>', 'sans balises de code');
});

await test("Sécurité : noms et icône piégés affichés comme texte, sans exécution", async (page) => {
  add({ id: 'evilapp', name: '<img src=x onerror="window.__pwned=1">.oneapp', mimeType: 'text/html', parents: ['fold1'], content: APP_HTML,
        description: '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwned=2"><script>window.__pwned=3<\/script></svg>' });
  add({ id: 'evildoc', name: "x'); window.__pwned=4; ('<img src=x onerror=window.__pwned=5>.onefile", mimeType: 'application/json', parents: ['fold1'],
        content: JSON.stringify({ oneapp_metadata: { app_name: 'x', source_app_drive_id: 'app1' }, app_data: [] }) });
  await page.evaluate(() => listInstalledApps());
  await page.waitForFunction(() => document.querySelectorAll('.app-card').length === 2);
  const cards = await page.$$eval('.app-card span', els => els.map(e => e.textContent));
  if (!cards.some(c => c.includes('<img src=x'))) throw new Error('nom piégé non affiché en texte : ' + cards);
  await page.locator('.app-card', { hasText: "L'agenda" }).click();
  await page.waitForFunction(() => document.querySelectorAll('.file-item').length === 2);
  await page.locator('.file-item-menu').last().click();
  await wait(500);
  eq(await page.evaluate(() => window.__pwned), undefined, 'code injecté exécuté');
  const names = await page.$$eval('.file-item-name', els => els.map(e => e.textContent));
  if (!names.some(n => n.includes('window.__pwned=4'))) throw new Error('nom de fichier altéré : ' + names);
});

await test("Sous-menu : Nouveau / Modifier / menu fichier fonctionnent (apostrophe dans le nom d'app)", async (page) => {
  await page.locator('.app-card').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.file-item').length === 1);
  eq(await page.textContent('.submenu-title'), "L'agenda - Fichiers", 'titre');
  await page.locator('.file-item-menu').click();
  eq(await page.isVisible('.file-item-dropdown'), true, 'menu ouvert');
  await page.click('h2');
  eq(await page.isVisible('.file-item-dropdown'), false, 'menu fermé par clic ailleurs');
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept('Nouveau doc'));
  await page.click('#submenu-new-btn');
  await page.waitForFunction(() => document.getElementById('execution-view').style.display === 'flex');
  const created = Object.values(files).find(f => f.name === 'Nouveau doc.onefile');
  if (!created) throw new Error('fichier non créé');
  eq(JSON.parse(created.content).oneapp_metadata.app_name, "L'agenda", 'app_name');
  eq(await page.inputValue('#running-file-title'), 'Nouveau doc', 'titre ouvert');
});

await test("Lien partagé sans être connecté : écran d'invitation", async (page) => {
  await page.goto(`http://localhost:${PORT}/index.html?file=doc1&notoken=1`);
  await page.waitForLoadState('load');
  eq(await page.isVisible('#shared-invite-view'), true, 'invitation visible');
  eq(await page.isVisible('#unauthenticated-view'), false, 'écran générique masqué');
});

// --- Apps réelles générées par une IA (tests/fixtures) ---
async function openFixture(page, name) {
  files.app1.content = fixture(name);
  await page.evaluate(() => openAppEnvironment('app1', "L'agenda", 'doc1', 'Doc'));
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'));
  const frame = page.frames().find(f => f !== page.mainFrame());
  await frame.waitForLoadState('load');
  await wait(300);
  return frame;
}

await test("Compteur (Gemini) : ajout d'un joueur par formulaire, score, sauvegarde", async (page) => {
  const frame = await openFixture(page, 'compteur-gemini.html');
  await frame.fill('#new-player-name', 'Alice');
  await frame.click('.btn-add');
  await frame.waitForSelector('.player-card', { timeout: 3000 });
  await frame.click('.score-btn.positive >> nth=1'); // +5
  eq(await frame.textContent('.player-score'), '5', 'score affiché');
  await page.evaluate(() => closeApp());
  const data = saved();
  eq(data.players.map(p => [p.name, p.score]), [['Alice', 5]], 'contenu Drive');
});

await test("Compteur (Gemini) : Annuler remet l'écran à jour", async (page) => {
  const frame = await openFixture(page, 'compteur-gemini.html');
  await frame.fill('#new-player-name', 'Bob');
  await frame.click('.btn-add');
  await frame.waitForSelector('.player-card', { timeout: 3000 });
  await frame.click('.score-btn.positive >> nth=0'); // +1
  await page.evaluate(() => appUndo());
  await wait(200);
  eq(await frame.textContent('.player-score'), '0', 'score après annulation');
});

await test("Fermer une app avec le sous-menu ouvert : pas d'erreur, sous-menu rouvert", async (page) => {
  await page.locator('.app-card').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.file-item').length === 1);
  await page.locator('.file-item-name').first().click();
  await page.waitForFunction(() => document.getElementById('execution-view').style.display === 'flex');
  await page.evaluate(() => closeApp());
  await page.waitForFunction(() => document.querySelectorAll('.file-item').length === 1, null, { timeout: 5000 });
  eq(await page.textContent('.submenu-title'), "L'agenda - Fichiers", 'sous-menu rouvert');
});

await browser.close();
server.close();
console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent');
process.exit(failures ? 1 : 0);
