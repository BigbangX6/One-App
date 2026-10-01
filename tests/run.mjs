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
  // config.js de test : une clé API factice (lecture publique + Picker)
  if (req.url.split('?')[0] === '/config.js') {
    res.writeHead(200);
    return res.end('const ONEAPP_CONFIG = { GOOGLE_CLIENT_ID: "123456-test.apps.googleusercontent.com", GOOGLE_API_KEY: "testkey" };');
  }
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  // Types MIME comme sur GitHub Pages (requis pour enregistrer le service worker)
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.pdf': 'application/pdf' };
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  res.end(fs.readFileSync(p));
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

  // Accès public par clé API (sans jeton) : seulement les fichiers publics, en lecture
  if (!auth && url.searchParams.get('key')) {
    const pm = url.pathname.match(/\/drive\/v3\/files\/([^/]+)$/);
    const pf = pm && files[pm[1]];
    if (url.searchParams.get('key') !== 'testkey' || method !== 'GET' || !pf || !pf.public) return json({ error: { message: 'not found' } }, 404);
    if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, body: pf.content });
    return json({ id: pf.id, name: pf.name, description: pf.description, ownedByMe: false });
  }

  if (ctl.force401 > 0 || auth !== `Bearer ${ctl.validToken}`) {
    if (ctl.force401 > 0) ctl.force401--;
    return json({ error: { message: 'Invalid Credentials' } }, 401);
  }
  if (url.pathname.includes('/about')) return json({ user: { emailAddress: 'test@example.com' } });

  const m = url.pathname.match(/\/(upload\/)?drive\/v3\/files(?:\/([^/]+))?(\/permissions|\/revisions)?/);
  const isUpload = !!m[1]; const id = m[2]; const sub = m[3];

  if (sub === '/permissions') return json({ id: 'perm1' });
  if (sub === '/revisions') return json({ revisions: [] });

  if (!id && method === 'GET') {
    const q = url.searchParams.get('q');
    let list = Object.values(files).filter(f => !f.trashed && !f.noAccess);
    const nm = q.match(/name = '((?:\\'|[^'])*)'/);
    if (nm) { const name = nm[1].replace(/\\'/g, "'"); list = list.filter(f => f.name === name); }
    if (q.includes("contains '.oneapp'")) list = list.filter(f => f.name.includes('.oneapp'));
    if (q.includes("contains '.onefile'")) list = list.filter(f => f.name.includes('.onefile'));
    const par = q.match(/'([^']+)' in parents/); if (par) list = list.filter(f => (f.parents || []).includes(par[1]));
    if (q.includes('shortcut')) list = [];
    return json({ files: list.map(f => ({ id: f.id, name: f.name, parents: f.parents, mimeType: f.mimeType, modifiedTime: f.modifiedTime, description: f.description, shortcutDetails: f.shortcutDetails })) });
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
  // drive.file : un fichier ni créé ni ouvert par One App est introuvable
  if (!f || f.noAccess) return json({ error: { message: 'File not found: ' + id } }, 404);
  if (method === 'GET') {
    if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, body: f.content });
    // hideParents : comme Drive en drive.file quand One App n'a pas accès au dossier parent
    return json({ id: f.id, name: f.name, parents: f.hideParents ? undefined : f.parents, description: f.description, modifiedTime: f.modifiedTime, headRevisionId: f.headRevisionId, ownedByMe: f.ownedByMe, capabilities: { canEdit: true, canShare: true } });
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
let page_context = null; // contexte du test en cours (pour couper le réseau)
const browser = await chromium.launch();
let failures = 0;
async function test(name, fn, contextOptions = {}) {
  if (only && !name.includes(only)) return;
  reset();
  const context = await browser.newContext(contextOptions);
  page_context = context;
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  // DEBUG=1 node tests/run.mjs "..." : affiche la console du navigateur
  if (process.env.DEBUG) page.on('console', m => console.log('   [console]', m.text()));
  page.on('dialog', d => { page._dialogs = (page._dialogs || []).concat(d.message()); d.accept(); });
  await context.route('https://accounts.google.com/**', r => r.fulfill({ status: 200, body: '' }));
  await context.route('https://www.googleapis.com/**', handleDrive);
  await context.route('https://apis.google.com/**', r => r.fulfill({ status: 200, body: '' }));
  // Choisir un fichier dans le Picker donne l'accès à One App (drive.file)
  await context.exposeFunction('__grantAccess', (id) => { if (files[id]) delete files[id].noAccess; });
  await context.addInitScript(() => {
    if (window !== window.top) return; // pas dans l'iframe de l'app (sandbox)
    if (location.search.includes('notoken')) { localStorage.clear(); }
    else {
      localStorage.setItem('oneapp_gdrive_token', 'tok1');
      // sessionStorage.__expired : simule un jeton expiré (survit au rechargement)
      localStorage.setItem('oneapp_gdrive_expire', sessionStorage.getItem('__expired') ? '0' : String(Date.now() + 3600e3));
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
    // Faux Google Picker, piloté par window.__pickerMode ('pick' ou 'cancel')
    window.__pickerMode = 'pick'; window.__pickerFileIds = null;
    window.gapi = { load: (name, cfg) => setTimeout(cfg.callback, 10) };
    const P = { Response: { ACTION: 'action', DOCUMENTS: 'docs' }, Action: { PICKED: 'picked', CANCEL: 'cancel' }, Document: { ID: 'id' },
      ViewId: { DOCS: 'all' }, DocsViewMode: { LIST: 'list' } };
    P.DocsView = function () { this.setFileIds = (ids) => { window.__pickerFileIds = ids; return this; }; this.setMode = () => this; };
    P.PickerBuilder = function () {
      let cb; const b = this;
      ['setAppId', 'setOAuthToken', 'setDeveloperKey', 'setLocale', 'addView'].forEach(m => { b[m] = () => b; });
      b.setCallback = (f) => { cb = f; return b; };
      // Comme le vrai Picker : action 'loaded' d'abord. Options pour reproduire les cas réels :
      // __pickerDelay (temps passé dans le Picker), __grantDelay (accès effectif après un délai),
      // __pickedId (identifiant renvoyé différent de celui demandé)
      b.build = () => ({ setVisible: () => {
        window.__pickerOpen = true;
        cb({ action: 'loaded' });
        setTimeout(async () => {
          window.__pickerOpen = false;
          if (window.__pickerMode !== 'pick') return cb({ action: 'cancel' });
          const ids = window.__pickerFileIds;
          if (window.__grantDelay) setTimeout(() => window.__grantAccess(ids), window.__grantDelay);
          else await window.__grantAccess(ids);
          cb({ action: 'picked', docs: [{ id: window.__pickedId || ids }] });
        }, window.__pickerDelay || 50);
      } });
    };
    window.google.picker = P;
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
  // le clic est transmis à One App par message : on attend qu'il soit reçu
  await page.waitForFunction(() => appDataHistory.length === 3);
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

await test("Icône d'une app partagée (raccourci) : lue sur l'app d'origine", async (page) => {
  add({ id: 'sharedapp', name: 'Partagée.oneapp', mimeType: 'text/html', parents: ['autre'], content: APP_HTML, description: '🎲' });
  add({ id: 'sc1', name: 'Partagée.oneapp', mimeType: 'application/vnd.google-apps.shortcut', parents: ['fold1'],
        shortcutDetails: { targetId: 'sharedapp' } });
  await page.evaluate(() => listInstalledApps());
  await page.waitForFunction(() => document.querySelectorAll('.app-card').length === 3);
  const card = page.locator('.app-card', { hasText: 'Partagée' }).first();
  eq(await card.locator('div').first().textContent(), '🎲', 'icône affichée');
});

await test("Icône SVG avec currentColor : affichée dans la couleur d'accent", async (page) => {
  files.app1.description = "&lt;svg viewBox='0 0 24 24' width='32' height='32'&gt;&lt;path fill='currentColor' d='M4 6H2v14h14v-2H4V6z'/&gt;&lt;/svg&gt;";
  await page.evaluate(() => listInstalledApps());
  await page.waitForFunction(() => document.querySelector('.app-card img'));
  const src = decodeURIComponent(await page.getAttribute('.app-card img', 'src'));
  if (src.includes('currentColor') || !src.includes('#8b5cf6')) throw new Error('couleur non appliquée : ' + src);
});

// --- Local d'abord (IndexedDB) ---
const idb = (page, store) => page.evaluate(s => localStore.getAll(s), store);
const waitFor = async (cond, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cond()) return; await wait(100); }
  throw new Error('condition non atteinte en ' + ms + ' ms');
};

await test("Local d'abord : Drive en panne à la fermeture → gardé sur l'appareil puis envoyé", async (page) => {
  const frame = await openDoc(page);
  ctl.failPatch = 100;
  await save(frame, ['hors-ligne']);
  await wait(200);
  await page.evaluate(() => closeApp());
  if (!(page._dialogs || []).some(d => d.includes('conservées sur cet appareil'))) throw new Error('pas de message de conservation locale');
  eq(saved(), ['initial'], 'Drive pas encore modifié');
  eq((await idb(page, 'docs')).find(d => d.fileId === 'doc1').dirty, true, 'en attente sur l\'appareil');
  await page.evaluate(() => syncPendingDocs()); // attend l'envoi (en échec) lancé à la fermeture
  ctl.failPatch = 0;
  await page.evaluate(() => syncPendingDocs());
  eq(saved(), ['hors-ligne'], 'envoyé à Drive');
  eq((await idb(page, 'docs')).find(d => d.fileId === 'doc1').dirty, false, 'plus en attente');
});

await test("Local d'abord : onglet fermé/planté avant l'envoi → repris au redémarrage", async (page) => {
  const frame = await openDoc(page);
  await save(frame, ['avant-plantage']);
  await wait(300);              // bien avant les 3 s de délai d'envoi
  await page.reload();          // simule un plantage / une fermeture d'onglet
  await waitFor(async () => JSON.stringify(saved()) === '["avant-plantage"]');
});

await test("Local d'abord : réouverture → modifications locales affichées puis envoyées", async (page) => {
  let frame = await openDoc(page);
  ctl.failPatch = 100;
  await save(frame, ['local']);
  await wait(200);
  await page.evaluate(() => closeApp());
  await page.evaluate(() => syncPendingDocs()); // attend l'envoi (en échec) lancé à la fermeture
  ctl.failPatch = 0;
  frame = await openDoc(page);
  eq(await frame.evaluate(() => window.shown), ['local'], 'affiché dans l\'app');
  await waitFor(async () => JSON.stringify(saved()) === '["local"]');
});

await test("Local d'abord : document modifié ailleurs entre-temps → copie de secours, rien d'écrasé", async (page) => {
  const frame = await openDoc(page);
  ctl.failPatch = 100;
  await save(frame, ['mes-modifs']);
  await wait(200);
  await page.evaluate(() => closeApp());
  await page.evaluate(() => syncPendingDocs()); // attend l'envoi (en échec) lancé à la fermeture
  touchContent(files.doc1, JSON.stringify({ oneapp_metadata: { app_name: "L'agenda", source_app_drive_id: 'app1' }, app_data: ['autre-appareil'] }));
  ctl.failPatch = 0;
  await page.evaluate(() => syncPendingDocs());
  const backup = Object.values(files).find(f => f.name === 'Doc - Copie de secours.onefile');
  if (!backup) throw new Error('pas de copie de secours');
  eq(JSON.parse(backup.content).app_data, ['mes-modifs'], 'copie de secours');
  eq(saved(), ['autre-appareil'], 'Drive non écrasé');
  eq((await idb(page, 'docs')).length, 0, 'retiré de l\'appareil');
});

await test("Local d'abord : l'app est mise en cache à l'ouverture", async (page) => {
  await openDoc(page);
  await wait(200);
  const apps = await idb(page, 'apps');
  eq(apps.map(a => a.appFileId), ['app1'], 'apps en cache');
});

await test("Local d'abord : déconnexion → stockage local effacé", async (page) => {
  await openDoc(page);
  await page.evaluate(() => closeApp());
  eq((await idb(page, 'docs')).length, 1, 'document en cache avant');
  await Promise.all([page.waitForNavigation(), page.evaluate(() => logout())]);
  await page.waitForFunction(() => document.querySelector('.app-card'));
  eq((await idb(page, 'docs')).length, 0, 'documents après');
  eq((await idb(page, 'apps')).length, 0, 'apps après');
});

await test("Local d'abord : autre compte sur l'appareil → ses données effacées, jamais envoyées", async (page) => {
  await page.evaluate(async () => {
    await localStore.put('meta', { key: 'account', value: 'autre@example.com' });
    await localStore.put('docs', { fileId: 'doc1', fileName: 'Doc', dirty: true, data: ['autre-compte'],
      metadata: { app_name: "L'agenda", source_app_drive_id: 'app1' }, base: null });
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.app-card'));
  await wait(500);
  eq((await idb(page, 'docs')).length, 0, 'documents de l\'autre compte');
  eq(saved(), ['initial'], 'Drive non modifié');
});

// --- Scope drive.file : partage ---
function addSharedFromOther() {
  const app = add({ id: 'otherapp', name: 'Budget.oneapp', mimeType: 'text/html', parents: ['autre'], content: APP_HTML, description: '💰' });
  const doc = add({ id: 'otherdoc', name: 'Budget 2026.onefile', mimeType: 'application/json', parents: ['autre'],
    content: JSON.stringify({ oneapp_metadata: { app_name: 'Budget', source_app_drive_id: 'otherapp' }, app_data: ['partagé'] }) });
  for (const f of [app, doc]) { f.ownedByMe = false; f.noAccess = true; f.public = true; }
}

await test("drive.file : seul le scope drive.file est demandé", async (page) => {
  eq(await page.evaluate(() => SCOPES), 'https://www.googleapis.com/auth/drive.file', 'scope');
});

await test("drive.file : lien partagé → « Ajouter à One App » → Picker → document ouvert", async (page) => {
  addSharedFromOther();
  await page.goto(`http://localhost:${PORT}/index.html?file=otherdoc`);
  await page.waitForFunction(() => document.getElementById('access-modal-overlay').style.display === 'flex');
  eq(await page.textContent('#access-modal-title'), '« Budget 2026 »', 'nom du document');
  await page.click('#access-modal-add');
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'));
  eq(await page.evaluate(() => window.__pickerFileIds), 'otherdoc', 'Picker positionné sur le document');
  const frame = page.frames().find(f => f !== page.mainFrame());
  await frame.waitForFunction(() => window.shown !== null);
  eq(await frame.evaluate(() => window.shown), ['partagé'], "affiché dans l'app");
  if (!log.some(l => l.includes('/files/otherapp?alt=media') && l.includes('key=testkey'))) throw new Error("app non lue par la clé API");
  const shortcuts = Object.values(files).filter(f => f.mimeType === 'application/vnd.google-apps.shortcut').map(f => f.shortcutDetails.targetId).sort();
  eq(shortcuts, ['otherapp', 'otherdoc'], 'raccourcis créés');
  await save(frame, ['modifié']);
  await page.evaluate(() => closeApp());
  eq(JSON.parse(files.otherdoc.content).app_data, ['modifié'], 'modification enregistrée sur le document partagé');
});

await test("drive.file : refus dans l'écran d'ajout → retour à l'accueil, rien de créé", async (page) => {
  addSharedFromOther();
  await page.goto(`http://localhost:${PORT}/index.html?file=otherdoc`);
  await page.waitForFunction(() => document.getElementById('access-modal-overlay').style.display === 'flex');
  await page.click('#access-modal-cancel');
  await wait(300);
  eq(await page.isVisible('#access-modal-overlay'), false, 'écran fermé');
  eq(await page.isVisible('#execution-view'), false, 'pas de document ouvert');
  eq(Object.values(files).filter(f => f.mimeType === 'application/vnd.google-apps.shortcut').length, 0, 'raccourcis');
  eq(await page.evaluate(() => location.search), '', 'lien nettoyé');
});

await test("drive.file : Picker fermé sans choisir → l'écran d'ajout reste proposé", async (page) => {
  addSharedFromOther();
  await page.goto(`http://localhost:${PORT}/index.html?file=otherdoc`);
  await page.waitForFunction(() => document.getElementById('access-modal-overlay').style.display === 'flex');
  await page.evaluate(() => { window.__pickerMode = 'cancel'; });
  await page.click('#access-modal-add');
  await wait(300);
  eq(await page.isVisible('#access-modal-overlay'), true, 'écran toujours affiché');
  await page.evaluate(() => { window.__pickerMode = 'pick'; });
  await page.click('#access-modal-add');
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'));
});

await test("drive.file : ancien raccourci vers un document non autorisé → proposé à l'ouverture", async (page) => {
  addSharedFromOther();
  await page.evaluate(() => { openAppEnvironment('otherapp', 'Budget', 'otherdoc', 'Budget 2026'); }); // attend l'écran d'ajout
  await page.waitForFunction(() => document.getElementById('access-modal-overlay').style.display === 'flex');
  await page.click('#access-modal-add');
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'));
});

await test("drive.file : icône d'une app partagée lue en public", async (page) => {
  addSharedFromOther();
  add({ id: 'sc2', name: 'Budget.oneapp', mimeType: 'application/vnd.google-apps.shortcut', parents: ['fold1'], shortcutDetails: { targetId: 'otherapp' } });
  await page.evaluate(() => listInstalledApps());
  await page.waitForFunction(() => document.querySelectorAll('.app-card').length === 2);
  const card = page.locator('.app-card', { hasText: 'Budget' }).first();
  eq(await card.locator('div').first().textContent(), '💰', 'icône affichée');
});

await test("drive.file : app partagée illisible (clé API refusée) → copie de l'appareil, raison affichée", async (page) => {
  addSharedFromOther();
  delete files.otherdoc.noAccess;           // document déjà autorisé
  files.otherapp.public = false;            // la clé API ne peut pas lire l'app
  await page.evaluate(async (html) => { await localStore.put('apps', { appFileId: 'otherapp', html, cachedAt: Date.now() }); }, APP_HTML);
  await page.goto(`http://localhost:${PORT}/index.html?file=otherdoc`);
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'));
  const frame = page.frames().find(f => f !== page.mainFrame());
  await frame.waitForFunction(() => window.shown !== null);
  eq(await frame.evaluate(() => window.shown), ['partagé'], "affiché dans l'app");
});

await test("drive.file : app partagée illisible et absente de l'appareil → message avec la raison", async (page) => {
  addSharedFromOther();
  delete files.otherdoc.noAccess;
  files.otherapp.public = false;
  await page.goto(`http://localhost:${PORT}/index.html?file=otherdoc`);
  await waitFor(async () => (page._dialogs || []).some(d => d.includes('accès public')));
});

// --- PWA et hors-ligne ---
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

// Ouvre puis ferme doc1 en ligne (app et document gardés sur l'appareil), attend le service worker
async function prepareOffline(page) {
  await openDoc(page);
  await page.evaluate(() => closeApp());
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 5000 });
}

await test("Hors-ligne : One App s'ouvre sans réseau, document modifié puis envoyé au retour", async (page) => {
  await prepareOffline(page);
  await page_context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.app-card'));
  if (!(await page.textContent('#user-email')).includes('hors-ligne')) throw new Error('mode hors-ligne non indiqué');
  eq(await page.isVisible('#network-banner'), true, 'bandeau hors-ligne');
  await page.locator('.app-card').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.file-item').length === 1);
  await page.locator('.file-item-name').first().click();
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'));
  const frame = page.frames().find(f => f !== page.mainFrame());
  await frame.waitForFunction(() => window.shown !== null);
  eq(await frame.evaluate(() => window.shown), ['initial'], 'document affiché depuis l\'appareil');
  await save(frame, ['modifié hors-ligne']);
  await wait(4000);
  eq(saved(), ['initial'], 'rien envoyé hors-ligne');
  eq((await idb(page, 'docs')).find(d => d.fileId === 'doc1').dirty, true, 'gardé sur l\'appareil');
  await page_context.setOffline(false);
  await waitFor(async () => JSON.stringify(saved()) === '["modifié hors-ligne"]', 10000);
  await wait(600); // fondu de disparition
  eq(await page.isVisible('#network-banner'), false, 'bandeau masqué');
});

await test("Hors-ligne : démarrage avec jeton expiré → accueil depuis l'appareil", async (page) => {
  await prepareOffline(page);
  await page.evaluate(() => sessionStorage.setItem('__expired', '1'));
  await page_context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.app-card'));
  eq(await page.isVisible('#unauthenticated-view'), false, 'écran de connexion masqué');
});

await test("Hors-ligne : document jamais ouvert ici → message clair ; actions réseau bloquées", async (page) => {
  add({ id: 'doc2', name: 'Autre.onefile', mimeType: 'application/json', parents: ['fold1'],
        content: JSON.stringify({ oneapp_metadata: { app_name: "L'agenda", source_app_drive_id: 'app1' }, app_data: [] }) });
  await prepareOffline(page);
  await page_context.setOffline(true);
  await page.evaluate(() => openAppEnvironment('app1', "L'agenda", 'doc2', 'Autre'));
  if (!(page._dialogs || []).some(d => d.includes("pas encore été ouvert sur cet appareil"))) throw new Error('pas de message');
  await page.evaluate(() => createNewFile('app1', "L'agenda", 'fold1'));
  if (!(page._dialogs || []).some(d => d.includes('nécessite une connexion Internet'))) throw new Error('création non bloquée');
});

await test("Installation : ordinateur → bouton Installer, puis étapes si rien ne se passe", async (page) => {
  await page.evaluate(() => openInstallSheet());
  eq(await page.isVisible('#install-overlay .big-btn'), true, 'bouton Installer');
  await page.click('#install-overlay .big-btn');
  eq(await page.isVisible('#install-fallback'), true, 'étapes de secours');
  await page.keyboard.press('Escape');
  eq(await page.isVisible('#install-overlay'), false, 'fermée avec Échap');
});

await test("Installation : iPhone → étapes Safari, variante iOS 26", async (page) => {
  await page.evaluate(() => openInstallSheet());
  if (!(await page.textContent('#install-body')).includes('Partager')) throw new Error('étapes iPhone absentes');
  eq(await page.isVisible('#install-pointer-bottom .pointer'), true, 'flèche vers le bouton Partager');
  await page.click('#install-overlay [data-alt="ios26"]');
  if (!(await page.textContent('#install-body')).includes('•••')) throw new Error('variante iOS 26 absente');
  await page.click('#install-overlay [data-action="close"]');
  eq(await page.isVisible('#install-overlay'), false, 'fermée');
}, { userAgent: IPHONE_UA, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

await test("Installation : Android → bouton Installer ; lien depuis l'écran de connexion", async (page) => {
  await page.goto(`http://localhost:${PORT}/index.html?notoken=1`);
  await page.click('#unauthenticated-view .install-link');
  eq(await page.isVisible('#install-overlay .big-btn'), true, 'bouton Installer');
  if (!(await page.textContent('#install-overlay .help-txt')).includes('touchez')) throw new Error('texte mobile attendu');
}, { userAgent: ANDROID_UA, viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

await test("Cache vérifié : app et document inchangés ne sont pas retéléchargés", async (page) => {
  const downloads = (id) => log.filter(l => l.startsWith(`GET /drive/v3/files/${id}?alt=media`)).length;
  await openDoc(page);
  await page.evaluate(() => closeApp());
  await openDoc(page);
  eq(downloads('app1'), 1, 'téléchargements de l\'app (inchangée)');
  eq(downloads('doc1'), 1, 'téléchargements du document (inchangé)');
  await page.evaluate(() => closeApp());
  // L'auteur modifie l'app, un autre appareil modifie le document
  touchContent(files.app1, APP_HTML.replace('<title>', '<title>v2 '));
  touchContent(files.doc1, JSON.stringify({ oneapp_metadata: { app_name: "L'agenda", source_app_drive_id: 'app1' }, app_data: ['nouveau'] }));
  const frame = await openDoc(page);
  eq(downloads('app1'), 2, 'nouvelle version de l\'app téléchargée');
  eq(downloads('doc1'), 2, 'nouvelle version du document téléchargée');
  eq(await frame.evaluate(() => window.shown), ['nouveau'], 'document à jour affiché');
  eq(await frame.evaluate(() => document.title), "v2 L'agenda", 'app à jour affichée');
});

await test("Hors-ligne : bandeau temporaire, icône hors-ligne qui le réaffiche au clic", async (page) => {
  await prepareOffline(page);
  await openDoc(page);
  await page_context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await wait(300);
  eq(await page.isVisible('#network-banner'), true, 'bandeau affiché');
  if (!(await page.getAttribute('#sync-status-btn', 'title')).includes('Hors-ligne')) throw new Error('icône hors-ligne absente');
  if (!(await page.innerHTML('#sync-status-btn')).includes('#i-wifi-off')) throw new Error('mauvaise icône');
  await wait(6700);
  eq(await page.isVisible('#network-banner'), false, 'bandeau masqué après quelques secondes');
  await page.click('#sync-status-btn');
  await wait(500);
  eq(await page.isVisible('#network-banner'), true, 'bandeau réaffiché au clic');
  await page_context.setOffline(false);
  await wait(500);
  if ((await page.innerHTML('#sync-status-btn')).includes('#i-wifi-off')) throw new Error('icône hors-ligne restée après retour du réseau');
});

await test("drive.file : écran d'ajout masqué pendant le Picker, accès effectif en différé → document ouvert", async (page) => {
  addSharedFromOther();
  await page.goto(`http://localhost:${PORT}/index.html?file=otherdoc`);
  await page.waitForFunction(() => document.getElementById('access-modal-overlay').style.display === 'flex');
  await page.evaluate(() => { window.__pickerDelay = 800; window.__grantDelay = 1500; });
  await page.click('#access-modal-add');
  await page.waitForFunction(() => window.__pickerOpen === true);
  eq(await page.isVisible('#access-modal-overlay'), false, 'écran d\'ajout masqué pendant le Picker');
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'), null, { timeout: 15000 });
  const shortcuts = Object.values(files).filter(f => f.mimeType === 'application/vnd.google-apps.shortcut').map(f => f.shortcutDetails.targetId).sort();
  eq(shortcuts, ['otherapp', 'otherdoc'], 'raccourcis créés');
});

await test("drive.file : Picker qui renvoie un autre identifiant → l'accès réel est vérifié, document ouvert", async (page) => {
  addSharedFromOther();
  await page.goto(`http://localhost:${PORT}/index.html?file=otherdoc`);
  await page.waitForFunction(() => document.getElementById('access-modal-overlay').style.display === 'flex');
  await page.evaluate(() => { window.__pickedId = 'autre-identifiant'; });
  await page.click('#access-modal-add');
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'), null, { timeout: 15000 });
  eq(await page.isVisible('#access-modal-overlay'), false, 'écran d\'ajout fermé');
});

// --- Lien ?download et dossier des copies ---
await test("Lien ?download (PDF) : la fenêtre d'installation s'ouvre", async (page) => {
  await page.goto(`http://localhost:${PORT}/index.html?download`);
  await page.waitForFunction(() => !document.getElementById('install-overlay').hidden);
  eq(await page.evaluate(() => location.search), '', 'lien nettoyé');
});

await test("Lien ?download sans être connecté : la fenêtre d'installation s'ouvre", async (page) => {
  await page.goto(`http://localhost:${PORT}/index.html?notoken=1&download`);
  await page.waitForFunction(() => !document.getElementById('install-overlay').hidden);
  eq(await page.evaluate(() => location.search), '?notoken=1', 'seul download est retiré');
});

const backupOf = (name) => Object.values(files).find(f => f.name === name);

await test("Copie de secours : rangée dans le dossier de l'app même si Drive cache le dossier parent", async (page) => {
  files.doc1.hideParents = true;
  await page.locator('.app-card').first().click();          // ouverture depuis le sous-menu de l'app
  await page.waitForFunction(() => document.querySelectorAll('.file-item').length === 1);
  await page.locator('.file-item-name').first().click();
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'));
  const frame = page.frames().find(f => f !== page.mainFrame());
  await frame.waitForFunction(() => window.shown !== null);
  touchContent(files.doc1, JSON.stringify({ oneapp_metadata: { app_name: "L'agenda", source_app_drive_id: 'app1' }, app_data: ['ailleurs'] }));
  await save(frame, ['ici']);
  await waitFor(async () => !!backupOf('Doc - Copie de secours.onefile'), 10000);
  eq(backupOf('Doc - Copie de secours.onefile').parents, ['fold1'], 'dossier de la copie de secours');
});

await test("Créer une copie / copie de secours en arrière-plan : dossier de l'app retrouvé par son nom", async (page) => {
  files.doc1.hideParents = true;
  // « Créer une copie » sans passer par le sous-menu (dossier inconnu)
  await openDoc(page);
  page.removeAllListeners('dialog');
  page.on('dialog', d => d.accept('Ma copie'));
  await page.evaluate(() => duplicateActiveFile());
  await waitFor(async () => !!backupOf('Ma copie.onefile'));
  eq(backupOf('Ma copie.onefile').parents, ['fold1'], 'dossier de la copie');
  await page.evaluate(() => closeApp());
  // Modification restée sur l'appareil + document modifié ailleurs → copie de secours en arrière-plan
  const frame = await openDoc(page);
  ctl.failPatch = 100;
  await save(frame, ['en-attente']);
  await wait(200);
  await page.evaluate(() => closeApp());
  await page.evaluate(() => syncPendingDocs());
  touchContent(files.doc1, JSON.stringify({ oneapp_metadata: { app_name: "L'agenda", source_app_drive_id: 'app1' }, app_data: ['ailleurs'] }));
  ctl.failPatch = 0;
  await page.evaluate(() => syncPendingDocs());
  eq(backupOf('Doc - Copie de secours.onefile').parents, ['fold1'], 'dossier de la copie de secours');
});

await browser.close();
server.close();
console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent');
process.exit(failures ? 1 : 0);
