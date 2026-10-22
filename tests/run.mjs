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
  ctl = { patchDelay: 0, failPatch: 0, force401: 0, validToken: 'tok1', github: {}, githubDown: false, githubHits: 0 };
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
    if (q.includes('shortcut')) list = list.filter(f => f.shortcutDetails && q.includes(`'${f.shortcutDetails.targetId}'`));
    const ap = q.match(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/);
    if (ap) list = list.filter(f => f.appProperties && f.appProperties[ap[1]] === ap[2]);
    return json({ files: list.map(f => ({ id: f.id, name: f.name, parents: f.hideParents ? undefined : f.parents, mimeType: f.mimeType, modifiedTime: f.modifiedTime, description: f.description, shortcutDetails: f.shortcutDetails, appProperties: f.appProperties })) });
  }
  if (!id && method === 'POST') {
    let meta, content = '';
    if (isUpload) {
      const body = req.postData(); const parts = body.split(/\r\n--[^\r\n]+(?:\r\n|--)/).filter(p => p.includes('Content-Type'));
      meta = JSON.parse(parts[0].split('\r\n\r\n').slice(1).join('\r\n\r\n'));
      content = parts[1].split('\r\n\r\n').slice(1).join('\r\n\r\n');
    } else meta = JSON.parse(req.postData());
    // Comme Drive en drive.file : raccourci refusé vers un fichier inaccessible à One App
    if (meta.shortcutDetails && (!files[meta.shortcutDetails.targetId] || files[meta.shortcutDetails.targetId].noAccess)) return json({ error: { message: 'File not found' } }, 404);
    const f = add({ id: 'new' + (++seq), ...meta, content });
    return json({ id: f.id, name: f.name });
  }
  const f = files[id];
  // drive.file : un fichier ni créé ni ouvert par One App est introuvable
  if (!f || f.noAccess) return json({ error: { message: 'File not found: ' + id } }, 404);
  if (method === 'GET') {
    if (url.searchParams.get('alt') === 'media') return route.fulfill({ status: 200, body: f.content });
    // hideParents : comme Drive en drive.file quand One App n'a pas accès au dossier parent
    return json({ id: f.id, name: f.name, mimeType: f.mimeType, size: String(f.content ? f.content.length : 0), thumbnailLink: f.thumbnailLink, parents: f.hideParents ? undefined : f.parents, description: f.description, modifiedTime: f.modifiedTime, headRevisionId: f.headRevisionId, ownedByMe: f.ownedByMe, capabilities: { canEdit: !f.readOnly, canShare: true } });
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
  // Miniatures Drive (thumbnailLink) : comme chez Google, pas d'en-tête CORS (illisibles par une page web)
  await context.route('https://lh3.googleusercontent.com/**', r => r.fulfill({ status: 200, contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGNQaDgARwzEcQAyUhYB52C8wAAAAABJRU5ErkJggg==', 'base64') }));
  // Faux GitHub (fichiers bruts) : ctl.github['compte/dépôt/branche/chemin'] = contenu
  await context.route('https://raw.githubusercontent.com/**', r => {
    ctl.githubHits++;
    if (ctl.githubDown) return r.abort();
    const key = new URL(r.request().url()).pathname.slice(1);
    return key in ctl.github ? r.fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: ctl.github[key] })
      : r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '404: Not Found' });
  });
  // Choisir un fichier dans le Picker donne l'accès à One App (drive.file)
  await context.exposeFunction('__grantAccess', (id) => { if (files[id]) delete files[id].noAccess; });
  await context.addInitScript(() => {
    if (window !== window.top) return; // pas dans l'iframe de l'app (sandbox)
    if (location.search.includes('notoken')) {
      localStorage.clear();
      if (location.search.includes('known')) localStorage.setItem('oneapp_known_user', '1');
    } else if (location.search.includes('expired')) {
      localStorage.setItem('oneapp_gdrive_token', 'old');
      localStorage.setItem('oneapp_gdrive_expire', String(Date.now() - 60e3));
    }
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
    const P = { Response: { ACTION: 'action', DOCUMENTS: 'docs' }, Action: { PICKED: 'picked', CANCEL: 'cancel' }, Document: { ID: 'id', NAME: 'name', MIME_TYPE: 'mimeType' },
      ViewId: { DOCS: 'all', DOCS_VIDEOS: 'videos' }, DocsViewMode: { LIST: 'list', GRID: 'grid' } };
    P.Feature = { SUPPORT_DRIVES: 'sd' };
    P.DocsView = function (viewId) {
      this.setFileIds = (ids) => { window.__pickerFileIds = ids; return this; };
      this.setMimeTypes = (m) => { if (/video/.test(m)) window.__pickerForVideo = true; return this; };
      ['setMode', 'setIncludeFolders', 'setParent', 'setOwnedByMe'].forEach(m => { this[m] = () => this; });
      if (viewId === 'videos') window.__pickerForVideo = true;
    };
    P.PickerBuilder = function () {
      let cb; const b = this;
      ['setAppId', 'setOAuthToken', 'setDeveloperKey', 'setLocale', 'addView', 'setTitle', 'enableFeature'].forEach(m => { b[m] = () => b; });
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
          // Choix libre (ex. vidéo de référence) : window.__pickVideo = { id, name, mimeType }
          const free = window.__pickFile || (window.__pickerForVideo && window.__pickVideo);
          if (free) {
            await window.__grantAccess(free.id);
            return cb({ action: 'picked', docs: [free] });
          }
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
  await page.waitForFunction(() => document.querySelector('.app-tile'));
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
const idb = (page, store) => page.evaluate(s => localStore.getAll(s), store);
const waitFor = async (cond, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await cond()) return; await wait(100); }
  throw new Error('condition non atteinte en ' + ms + ' ms');
};
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

// Deuxième onglet One App dans le même navigateur (même stockage, même compte)
async function secondTab(page) {
  const p2 = await page.context().newPage();
  p2._errors = [];
  p2.on('pageerror', e => p2._errors.push(e.message));
  p2.on('dialog', d => { p2._dialogs = (p2._dialogs || []).concat(d.message()); d.accept(); });
  await p2.goto(`http://localhost:${PORT}/index.html`);
  await p2.waitForFunction(() => document.querySelector('.app-tile'));
  return p2;
}
const backups = () => Object.values(files).filter(f => f.name.includes('secours'));

await test("Conflit après une longue attente (reconnexion Google) : la copie de secours a TOUTES les modifications", async (page) => {
  const frame = await openDoc(page);
  ctl.validToken = 'tok2';
  await page.evaluate(() => { window.__gisMode = 'fail'; });
  await save(frame, ['a']);
  await wait(4500);                       // envoi bloqué : bandeau de reconnexion
  eq(await page.isVisible('#session-banner'), true, 'bandeau visible');
  await save(frame, ['a', 'b']);          // on continue à travailler
  await wait(300);
  touchContent(files.doc1, JSON.stringify({ oneapp_metadata: { app_name: "L'agenda", source_app_drive_id: 'app1' }, app_data: ['autre-appareil'] }));
  await page.evaluate(() => { window.__gisMode = 'ok'; });
  await page.click('#session-banner button');
  await waitFor(async () => backups().length === 1 && !(await page.evaluate(() => isSyncing)));
  eq(JSON.parse(backups()[0].content).app_data, ['a', 'b'], 'contenu de la copie de secours');
  eq(saved(), ['autre-appareil'], 'Drive non écrasé');
});

await test("Deux onglets : l'accueil du 2e onglet n'envoie pas le document ouvert dans le 1er (pas de faux conflit)", async (page) => {
  const frame = await openDoc(page);
  await save(frame, ['onglet1-v1']);
  await page.evaluate(() => persistOpenDoc());
  const p2 = await secondTab(page);       // démarrage : reprise des envois en attente
  await p2.evaluate(() => syncPendingDocs());
  await save(frame, ['onglet1-v1', 'v2']);
  await wait(4500);
  eq(backups().length, 0, 'copies de secours');
  eq((page._dialogs || []).filter(d => d.includes('Conflit')).length, 0, 'alertes de conflit');
  eq(saved(), ['onglet1-v1', 'v2'], 'contenu Drive');
  eq(await page.evaluate(() => isDirty), false, 'isDirty');
  if (p2._errors.length) throw new Error('2e onglet : ' + p2._errors.join(' | '));
});

await test("Deux onglets + jeton expiré : on se reconnecte dans un nouvel onglet, le 1er reprend ses envois sans rien perdre", async (page) => {
  const frame = await openDoc(page);
  ctl.validToken = 'tok2';
  await page.evaluate(() => { window.__gisMode = 'fail'; });
  await save(frame, ['v1']);
  await wait(4500);
  eq(await page.isVisible('#session-banner'), true, 'bandeau visible');
  await save(frame, ['v1', 'v2']);
  await wait(300);
  const p2 = await secondTab(page);       // nouvel onglet : connexion renouvelée (tok2)
  await p2.evaluate(() => syncPendingDocs());
  await save(frame, ['v1', 'v2', 'v3']);  // on reprend dans le 1er onglet
  await waitFor(async () => !(await page.evaluate(() => isDirty || isSyncing)) || backups().length > 0, 15000);
  eq(await page.isVisible('#session-banner'), false, 'reprise sans clic sur le bandeau');
  const everywhere = [saved(), ...backups().map(b => JSON.parse(b.content).app_data)];
  if (!everywhere.some(d => JSON.stringify(d) === JSON.stringify(['v1', 'v2', 'v3']))) throw new Error('v3 perdu : ' + JSON.stringify(everywhere));
  eq(backups().length, 0, 'copies de secours (aucun vrai conflit)');
  eq(saved(), ['v1', 'v2', 'v3'], 'contenu Drive');
});

await test("Vieil onglet (ancienne version) qui efface l'expiration du jeton : cet onglet continue sans bandeau", async (page) => {
  const frame = await openDoc(page);
  const p2 = await secondTab(page);
  await p2.evaluate(() => localStorage.setItem('oneapp_gdrive_expire', '0'));   // ce que faisait l'ancien code après un 401
  await page.evaluate(() => { window.__gisMode = 'fail'; });
  await save(frame, ['toujours connecté']);
  await wait(4500);
  eq(saved(), ['toujours connecté'], 'contenu Drive');
  eq(await page.isVisible('#session-banner'), false, 'pas de bandeau de reconnexion');
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
  await page.waitForFunction(() => document.querySelectorAll('.app-tile:not(.tool)').length === 2);
  const cards = await page.$$eval('.app-tile:not(.tool) .app-label', els => els.map(e => e.textContent));
  if (!cards.some(c => c.includes('<img src=x'))) throw new Error('nom piégé non affiché en texte : ' + cards);
  await page.locator('.app-tile:not(.tool)', { hasText: "L'agenda" }).click();
  await page.waitForFunction(() => document.querySelectorAll('.doc-row').length === 2);
  await page.locator('.doc-more').last().click();
  await wait(500);
  eq(await page.evaluate(() => window.__pwned), undefined, 'code injecté exécuté');
  const names = await page.$$eval('.doc-name', els => els.map(e => e.textContent));
  if (!names.some(n => n.includes('window.__pwned=4'))) throw new Error('nom de fichier altéré : ' + names);
});

await test("Accueil : choisir une app filtre les documents ; « Nouveau document » crée « Sans titre » et l'ouvre", async (page) => {
  await page.locator('.app-tile:not(.tool)').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.doc-row').length === 1);
  eq(await page.textContent('#rec-title'), "L'agenda", "titre de l'app choisie");
  await page.click('#new-doc-btn');
  await page.waitForFunction(() => document.getElementById('execution-view').style.display === 'flex');
  const created = Object.values(files).find(f => f.name === 'Sans titre.onefile');
  if (!created) throw new Error('fichier non créé');
  eq(JSON.parse(created.content).oneapp_metadata.app_name, "L'agenda", 'app_name');
  eq(created.parents, ['fold1'], "dossier de l'app");
  eq(await page.inputValue('#running-file-title'), 'Sans titre', 'titre ouvert');
  eq(await page.evaluate(() => document.activeElement.id), 'running-file-title', 'titre prêt à être renommé');
  await page.keyboard.type('Mon document');
  await page.keyboard.press('Enter');
  await waitFor(async () => created.name === 'Mon document.onefile');
});

await test("Accueil : menu ⋯ (ouvert/fermé), renommer en place, recherche", async (page) => {
  add({ id: 'doc2', name: 'Courses.onefile', mimeType: 'application/json', parents: ['fold1'],
        content: JSON.stringify({ oneapp_metadata: { app_name: "L'agenda", source_app_drive_id: 'app1' }, app_data: ['x'] }) });
  await page.evaluate(() => listInstalledApps());
  await page.waitForFunction(() => document.querySelectorAll('.doc-row').length === 2);
  await page.locator('.doc-row', { hasText: 'Courses' }).locator('.doc-more').click();
  eq(await page.isVisible('.menu'), true, 'menu ouvert');
  await page.click('.brand');
  eq(await page.isVisible('.menu'), false, 'menu fermé par clic ailleurs');
  await page.locator('.doc-row', { hasText: 'Courses' }).locator('.doc-more').click();
  await page.click('.menu >> text=Renommer');
  await page.fill('#rename-input', 'Courses de la semaine');
  await page.keyboard.press('Enter');
  await waitFor(async () => files.doc2.name === 'Courses de la semaine.onefile');
  await page.fill('#doc-search', 'semaine');
  await page.waitForFunction(() => document.querySelectorAll('.doc-row').length === 1);
  eq(await page.textContent('.doc-row .doc-name'), 'Courses de la semaine', 'résultat de recherche');
});

await test("Accueil : créer une copie, supprimer puis annuler", async (page) => {
  await page.locator('.doc-row .doc-more').first().click();
  await page.click('.menu >> text=Créer une copie');
  await waitFor(async () => !!Object.values(files).find(f => f.name === 'Copie de Doc.onefile'));
  const copy = Object.values(files).find(f => f.name === 'Copie de Doc.onefile');
  eq(copy.parents, ['fold1'], 'dossier de la copie');
  eq(JSON.parse(copy.content).app_data, ['initial'], 'contenu copié');
  await page.waitForFunction(() => document.querySelectorAll('.doc-row').length === 2);
  await page.locator('.doc-row', { hasText: 'Copie de Doc' }).locator('.doc-more').click();
  await page.click('.menu >> text=Supprimer');
  await waitFor(async () => copy.trashed === true);
  await page.waitForFunction(() => document.querySelectorAll('.doc-row').length === 1);
  await page.click('.toast button');
  await waitFor(async () => copy.trashed === false);
  await page.waitForFunction(() => document.querySelectorAll('.doc-row').length === 2);
});

await test("Accueil : fenêtre « Créer une app » (analyse du collage, création, sélection)", async (page) => {
  await page.click('#create-app-tile');
  await page.fill('#paste-app', 'Voici votre app :\n```html\n<!DOCTYPE html><html><head><title>Films vus</title><meta name="oneapp-icon" content="🎬"></head><body><script>window.OneAppAPI.loadData()<\/script></body></html>\n```');
  await page.waitForSelector('.found');
  eq(await page.textContent('.found b'), 'Films vus', 'app trouvée');
  eq(await page.isVisible('.warn'), false, 'pas d\'avertissement');
  await page.click('#create-app-go');
  await waitFor(async () => !!Object.values(files).find(f => f.name === 'Films vus.oneapp'));
  const app = Object.values(files).find(f => f.name === 'Films vus.oneapp');
  eq(app.description, '🎬', 'icône');
  if (!app.content.startsWith('<!DOCTYPE html>')) throw new Error('texte autour du code non retiré');
  await page.waitForFunction(() => document.getElementById('rec-title') && document.getElementById('rec-title').textContent === 'Films vus');
  eq(await page.isVisible('.scrim'), false, 'fenêtre fermée');
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

await test("Éditeur : « Modifier l'app » ouvre le code ; « Supprimer l'app » la met à la corbeille", async (page) => {
  await page.locator('.app-tile:not(.tool)').first().click();
  await page.click('#edit-app-btn');
  await page.waitForFunction(() => document.getElementById('edit-app-view').style.display === 'flex');
  if (!(await page.inputValue('#editor-full-code')).includes('<title>')) throw new Error("code de l'app non chargé");
  await page.click('#edit-app-view .header-menu-container .icon-btn');
  await page.click("#edit-header-menu >> text=Supprimer l'app");
  await waitFor(async () => files.app1.trashed === true);
  await page.waitForFunction(() => document.getElementById('authenticated-view').style.display === 'block');
  await page.waitForFunction(() => document.querySelectorAll('.app-tile:not(.tool)').length === 0);
});

await test("Fermer une app : retour à l'accueil, app toujours choisie", async (page) => {
  await page.locator('.app-tile:not(.tool)').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.doc-row').length === 1);
  await page.locator('.doc-row').first().click();
  await page.waitForFunction(() => document.getElementById('execution-view').style.display === 'flex');
  await page.evaluate(() => closeApp());
  await page.waitForFunction(() => document.querySelectorAll('.doc-row').length === 1, null, { timeout: 5000 });
  eq(await page.textContent('#rec-title'), "L'agenda", 'app toujours choisie');
});

await test("Bandeau lecture seule : seulement pour un document vraiment non modifiable, et refermable", async (page) => {
  await openDoc(page);
  await page.click('#toggle-readonly-btn');                 // mode lecture choisi par l'utilisateur
  eq(await page.isVisible('#readonly-banner'), false, 'pas de bandeau en mode lecture choisi');
  await page.evaluate(() => closeApp());
  files.doc1.readOnly = true;                                // partagé sans droit de modification
  await openDoc(page);
  eq(await page.isVisible('#readonly-banner'), true, 'bandeau pour un document non modifiable');
  await page.click('#readonly-banner .x-btn');
  eq(await page.isVisible('#readonly-banner'), false, 'bandeau refermé');
});

await test("Icône d'une app partagée (raccourci) : lue sur l'app d'origine", async (page) => {
  add({ id: 'sharedapp', name: 'Partagée.oneapp', mimeType: 'text/html', parents: ['autre'], content: APP_HTML, description: '🎲' });
  add({ id: 'sc1', name: 'Partagée.oneapp', mimeType: 'application/vnd.google-apps.shortcut', parents: ['fold1'],
        shortcutDetails: { targetId: 'sharedapp' } });
  await page.evaluate(() => listInstalledApps());
  await page.waitForFunction(() => document.querySelectorAll('.app-tile:not(.tool)').length === 3);
  const card = page.locator('.app-tile:not(.tool)', { hasText: 'Partagée' }).first();
  eq(await card.locator('.app-icon').first().textContent(), '🎲', 'icône affichée');
});

await test("Icône SVG avec currentColor : affichée dans la couleur d'accent", async (page) => {
  files.app1.description = "&lt;svg viewBox='0 0 24 24' width='32' height='32'&gt;&lt;path fill='currentColor' d='M4 6H2v14h14v-2H4V6z'/&gt;&lt;/svg&gt;";
  await page.evaluate(() => listInstalledApps());
  await page.waitForFunction(() => document.querySelector('.app-tile img'));
  const src = decodeURIComponent(await page.getAttribute('.app-tile img', 'src'));
  if (src.includes('currentColor') || !src.includes('#8b5cf6')) throw new Error('couleur non appliquée : ' + src);
});

// --- Local d'abord (IndexedDB) ---

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
  await page.waitForFunction(() => document.querySelector('.app-tile'));
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
  await page.waitForFunction(() => document.querySelector('.app-tile'));
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
  eq(shortcuts, ['otherdoc'], 'raccourci du document');
  const pointer = Object.values(files).find(f => f.appProperties && f.appProperties.oneapp_target === 'otherapp');
  if (!pointer) throw new Error("pas de pointeur vers l'app partagée");
  eq([pointer.name, pointer.description], ['Budget.oneapp', '💰'], 'pointeur (nom, icône)');
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
  await page.waitForFunction(() => document.querySelectorAll('.app-tile:not(.tool)').length === 2);
  const card = page.locator('.app-tile:not(.tool)', { hasText: 'Budget' }).first();
  eq(await card.locator('.app-icon').first().textContent(), '💰', 'icône affichée');
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
  await page.waitForFunction(() => document.querySelector('.app-tile'));
  if (!(await page.textContent('#drive-status')).includes('Hors-ligne')) throw new Error('mode hors-ligne non indiqué');
  eq(await page.isVisible('#network-banner'), true, 'bandeau hors-ligne');
  await page.locator('.app-tile:not(.tool)').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.doc-row').length === 1);
  await page.locator('.doc-row').first().click();
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
  await page.waitForFunction(() => document.querySelector('.app-tile'));
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
  eq(shortcuts, ['otherdoc'], 'raccourci du document');
  const pointer = Object.values(files).find(f => f.appProperties && f.appProperties.oneapp_target === 'otherapp');
  if (!pointer) throw new Error("pas de pointeur vers l'app partagée");
  eq([pointer.name, pointer.description], ['Budget.oneapp', '💰'], 'pointeur (nom, icône)');
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
  await page.locator('.app-tile:not(.tool)').first().click();          // ouverture depuis le sous-menu de l'app
  await page.waitForFunction(() => document.querySelectorAll('.doc-row').length === 1);
  await page.locator('.doc-row').first().click();
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

await test("QR code du partage : généré sur l'appareil, sans service extérieur", async (page) => {
  const outside = [];
  page.on('request', r => { if (!/localhost|googleapis|google\.com/.test(r.url())) outside.push(r.url()); });
  await page.evaluate(() => {
    document.getElementById('share-link-input').value = location.origin + '/index.html?file=1AbCdEfGhIjKlMnOp';
    showQRCode();
  });
  const src = await page.getAttribute('#qr-code-img', 'src');
  if (!src.startsWith('data:image/svg+xml')) throw new Error('image du QR code : ' + src.slice(0, 60));
  // Structure : taille 17 + 4 × version, trois motifs de repérage aux coins
  const r = await page.evaluate(() => {
    const m = qrMatrix('a'), big = qrMatrix('x'.repeat(300));
    const finder = (x, y) => m[y][x] && m[y][x + 6] && m[y + 6][x] && !m[y + 1][x + 1] && m[y + 3][x + 3];
    return [m.length, big.length, finder(0, 0), finder(14, 0), finder(0, 14)];
  });
  eq(r, [21, 69, true, true, true], 'matrice du QR code');
  eq(outside, [], 'aucune requête vers un service extérieur');
});

// --- Écrans de connexion et bouton officiel Google ---
const gsiLabels = (page, sel) => page.$$eval(sel + ' .gsi-btn', els => els.filter(e => e.offsetParent).map(e => ({
  text: e.textContent.trim(), logo: !!e.querySelector('svg use[href="#g-logo"]'), type: e.type })));

await test("Connexion : première visite → vitrine, bouton officiel « Se connecter avec Google »", async (page) => {
  await page.goto(`http://localhost:${PORT}/index.html?notoken=1`);
  eq(await page.isVisible('#lp-showcase'), true, 'vitrine visible');
  eq(await page.isVisible('#lp-ended'), false, 'écran heure terminée');
  const btns = await gsiLabels(page, '#lp-showcase');
  eq(btns.length, 2, 'boutons Google');
  for (const b of btns) eq(b, { text: 'Se connecter avec Google', logo: true, type: 'button' }, 'bouton');
  if (!(await page.textContent('#lp-showcase')).includes('chaque connexion dure')) throw new Error('mention de la durée de connexion absente');
});

await test("Connexion : déjà venu puis déconnecté → carte simple, retour possible à la vitrine", async (page) => {
  await page.goto(`http://localhost:${PORT}/index.html?notoken=1&known=1`);
  eq(await page.isVisible('#lp-return'), true, 'carte simple');
  eq(await page.isVisible('#lp-showcase'), false, 'vitrine masquée');
  eq((await gsiLabels(page, '#lp-return')).map(b => b.text), ['Se connecter avec Google'], 'bouton');
  await page.click('#lp-return .lp-link');
  eq(await page.isVisible('#lp-showcase'), true, 'vitrine après « Qu\'est-ce que One App ? »');
});

await test("Connexion : jeton expiré → « Votre heure de connexion est terminée » puis renouvellement", async (page) => {
  await page.goto(`http://localhost:${PORT}/index.html?expired=1`);
  await page.waitForLoadState('load');
  eq(await page.isVisible('#lp-ended'), true, 'écran heure terminée');
  eq(await page.textContent('#lp-ended h1'), 'Votre heure de connexion est terminée', 'titre');
  eq((await gsiLabels(page, '#lp-ended')).map(b => b.text), ['Continuer avec Google'], 'bouton');
  await page.click('#lp-ended .why summary');
  if (!(await page.isVisible('#lp-ended .why p'))) throw new Error('volet « Pourquoi » fermé');
  ctl.validToken = 'tok2';                 // jeton renvoyé par la fausse fenêtre Google
  await page.click('#lp-ended .gsi-btn');
  await page.waitForFunction(() => document.querySelector('.app-tile'));
  eq(await page.isVisible('#unauthenticated-view'), false, 'écran de connexion masqué');
  if (!(await page.textContent('.toast')).includes('Connexion renouvelée')) throw new Error('pas de message de renouvellement');
});

await test("Connexion : lien partagé sans être connecté → « Continuer avec Google »", async (page) => {
  await page.goto(`http://localhost:${PORT}/index.html?file=doc1&notoken=1`);
  await page.waitForLoadState('load');
  eq((await gsiLabels(page, '#shared-invite-view')).map(b => b.text), ['Continuer avec Google'], 'bouton');
});

await test("Bandeau de reconnexion : bouton officiel, puis message « Connexion renouvelée »", async (page) => {
  const frame = await openDoc(page);
  ctl.validToken = 'tok2';
  await page.evaluate(() => { window.__gisMode = 'fail'; });
  await save(frame, ['attente']);
  await page.waitForFunction(() => document.getElementById('session-banner').style.display === 'flex', null, { timeout: 8000 });
  eq((await gsiLabels(page, '#session-banner')).map(b => b.text), ['Continuer avec Google'], 'bouton');
  eq(await page.textContent('#session-banner .sb-txt b'), 'Votre heure de connexion Google est terminée.', 'titre');
  await page.evaluate(() => { window.__gisMode = 'ok'; });
  await page.click('#session-banner .gsi-btn');
  await page.waitForFunction(() => document.querySelector('.toast'));
  if (!(await page.textContent('.toast')).includes('Connexion renouvelée')) throw new Error('pas de message de renouvellement');
});

// --- Droits d'une app dans son iframe ---
await test("App : téléchargement d'un export et fenêtre d'impression autorisés, stockage du navigateur bloqué", async (page) => {
  const frame = await openDoc(page);
  const dl = page.waitForEvent('download', { timeout: 3000 });
  await frame.evaluate(() => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['nom;score'], { type: 'text/csv' }));
    a.download = 'export.csv'; document.body.append(a); a.click();
  });
  eq((await dl).suggestedFilename(), 'export.csv', 'fichier téléchargé');
  const popup = page.context().waitForEvent('page', { timeout: 3000 });
  eq(await frame.evaluate(() => {
    const w = window.open('', '_blank'); w.document.write('<p>Récapitulatif</p>'); w.document.close();
    return w.document.body.textContent;
  }), 'Récapitulatif', "fenêtre d'impression remplie");
  await (await popup).close();
  eq(await frame.evaluate(() => { try { localStorage.setItem('a', '1'); return 'ok'; } catch (e) { return 'bloqué'; } }), 'bloqué', 'localStorage');
  eq(await frame.evaluate(() => { try { return String(parent.document.title); } catch (e) { return 'bloqué'; } }), 'bloqué', 'accès à One App');
});

// --- Nom du document, copie téléchargée, lecture après conflit ---
await test("API : nom du document disponible dans l'app et mis à jour au renommage", async (page) => {
  const frame = await openDoc(page);
  eq(await frame.evaluate(() => OneAppAPI.getFileName()), 'Doc', 'nom au chargement');
  await frame.evaluate(() => { window.__names = []; OneAppAPI.onNameChange(n => window.__names.push(n)); });
  await page.fill('#running-file-title', 'Tournage Lundi');
  await page.evaluate(() => renameActiveFile());
  await frame.waitForFunction(() => window.__names.length === 1);
  eq(await frame.evaluate(() => [OneAppAPI.getFileName(), window.__names]), ['Tournage Lundi', ['Tournage Lundi']], 'après renommage');
});

await test("Télécharger une copie : .onefile complet, même hors-ligne", async (page) => {
  const frame = await openDoc(page);
  await save(frame, ['non-envoyé']);
  await page.context().setOffline(true);
  const dl = page.waitForEvent('download', { timeout: 3000 });
  await page.evaluate(() => downloadDocCopy());
  const d = await dl;
  eq(d.suggestedFilename(), 'Doc.onefile', 'nom du fichier');
  const json = JSON.parse(fs.readFileSync(await d.path(), 'utf8'));
  eq(json.app_data, ['non-envoyé'], 'données (modifications locales comprises)');
  eq(json.oneapp_metadata.source_app_drive_id, 'app1', 'métadonnées');
  await page.context().setOffline(false);
});

await test("Conflit : copie de secours puis mode lecture ; le crayon permet de réécrire", async (page) => {
  const frame = await openSkeleton(page);
  touchContent(files.doc1, JSON.stringify({ oneapp_metadata: { app_name: "L'agenda", source_app_drive_id: 'app1' }, app_data: { count: 7 } }));
  await frame.click('#b');
  await page.waitForFunction(() => isAppReadOnly === true, null, { timeout: 8000 });
  if (!Object.values(files).some(f => f.name.includes('secours'))) throw new Error('pas de copie de secours');
  eq(await frame.evaluate(() => [document.body.dataset.count, document.body.dataset.ro]), ['7', 'true'], 'version du Cloud, en lecture');
  await frame.click('#b');                // ignoré en lecture
  await wait(300);
  eq(JSON.parse(files.doc1.content).app_data, { count: 7 }, 'rien écrit en lecture');
  await page.click('#toggle-readonly-btn');
  await frame.waitForFunction(() => document.body.dataset.ro === 'false', null, { timeout: 2000 }).catch(() => {});
  eq(await frame.evaluate(() => document.body.dataset.ro), 'false', 'édition après le crayon');
  await frame.click('#b');
  await page.waitForFunction(() => isDirty === true);
  await page.evaluate(() => closeApp());
  // (l'app de test incrémente son état local même en lecture, sans l'envoyer : 7 → 8 → 9)
  eq(JSON.parse(files.doc1.content).app_data, { count: 9 }, 'écriture reprise');
  await openSkeleton(page);
  eq(await page.evaluate(() => isAppReadOnly), false, 'réouverture en édition');
});

// --- Cinema Script (apps/cinema-script) ---
const CINEMA = fs.readFileSync(path.join(ROOT, 'apps', 'cinema-script', 'cinema-script.html'), 'utf8');
const cinemaData = () => JSON.parse(files.doc1.content).app_data;
async function openCinema(page, data) {
  files.app1.content = CINEMA;
  if (data !== undefined) files.doc1.content = JSON.stringify({ oneapp_metadata: { app_name: 'Cinema Script', source_app_drive_id: 'app1' }, app_data: data });
  await page.evaluate(() => openAppEnvironment('app1', 'Cinema Script', 'doc1', 'Doc'));
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'));
  const frame = page.frames().find(f => f !== page.mainFrame());
  await frame.waitForSelector('.seq-head');
  return frame;
}
const SHOOT = { v: 1, sequences: [{ id: 1, info: 'INT. CUISINE – JOUR' }, { id: 2, info: 'EXT. RUE – NUIT' }],
  plans: [{ seqId: 1, id: 1, impro: 0, info: 'Plan large', temps: '20 min', video: null }, { seqId: 2, id: 1, impro: 0, info: 'Travelling', temps: '', video: null }],
  takes: [{ uid: 'a', seqId: 1, planId: 1, prise: 1, avis: '✅ OK (Bonne)', com: '', timestamp: '2026-10-14T08:00:00Z' },
          { uid: 'b', seqId: 1, planId: 1, prise: 3, avis: '😕 Bof (Ratée)', com: '', timestamp: '2026-10-14T08:10:00Z' }],
  tournageList: [{ type: 'sep', text: 'Lundi' }, { type: 'plan', seqId: 2, planId: 1 }, { type: 'plan', seqId: 1, planId: 1 }] };

await test("Cinema Script : signal du clap identique à l'original, puis pause et claquement", async (page) => {
  const ref = fs.readFileSync(path.join(TESTS_DIR, 'fixtures', 'cinema-clap-original.js'), 'utf8').split('\n').slice(3).join('\n').trim();
  const mine = CINEMA.slice(CINEMA.indexOf('class DigitalClapper'), CINEMA.indexOf('CS.clapper = new DigitalClapper();')).trim();
  eq(mine === ref, true, 'code de la classe identique');
  const frame = await openCinema(page, SHOOT);
  const r = await frame.evaluate(async (refSrc) => {
    window.addEventListener('unhandledrejection', e => e.preventDefault());
    const RATE = 48000, LEN = RATE * 6;
    // Original : la classe d'origine seule
    const C = new Function(refSrc + '; return DigitalClapper;')();
    const o = new C(); o.audioCtx = new OfflineAudioContext(1, LEN, RATE); o.play(2, 1, 1);
    const orig = (await o.audioCtx.startRendering()).getChannelData(0);
    // App : CS.clap() sur le plan 2.1 (prise 1)
    CS.active = { seqId: 2, planId: 1 };
    CS.clapper.audioCtx = new OfflineAudioContext(1, LEN, RATE);
    CS.clap();
    const mine = (await CS.clapper.audioCtx.startRendering()).getChannelData(0);
    const end = Math.floor(CS.signalEnd(0, 2, 1, 1) * RATE), slate = end + Math.floor(CS.SLATE_PAUSE * RATE);
    for (let i = 0; i < slate; i++) if (orig[i] !== mine[i]) return 'signal différent à ' + i;
    let pause = 0; for (let i = end; i < slate; i++) pause += mine[i] * mine[i];
    let clap = 0; for (let i = slate; i < slate + RATE * 0.3; i++) clap += mine[i] * mine[i];
    // Énergie du claquement dans la bande du signal (10,6–12,6 kHz), par Goertzel
    const band = (f) => { const k = 2 * Math.cos(2 * Math.PI * f / RATE); let s1 = 0, s2 = 0;
      for (let i = slate; i < slate + RATE * 0.3; i++) { const s0 = mine[i] + k * s1 - s2; s2 = s1; s1 = s0; }
      return (s1 * s1 + s2 * s2 - k * s1 * s2) / (RATE * 0.3); };
    const inBand = [10697, 10941, 12209, 12477].reduce((a, f) => a + band(f), 0);
    const ref1k = band(2200);
    return { pause, clap, ratio: inBand / ref1k };
  }, ref);
  if (typeof r === 'string') throw new Error(r);
  eq(r.pause, 0, 'silence entre le signal et le claquement');
  if (!(r.clap > 50)) throw new Error('claquement trop faible : ' + r.clap);
  if (!(r.ratio < 0.02)) throw new Error('claquement présent dans la bande du signal : ' + r.ratio);
});

await test("Cinema Script : nouveau document, texte enregistré ; nom du projet = nom du fichier", async (page) => {
  const frame = await openCinema(page);
  eq(await frame.textContent('#proj'), 'Doc', 'nom du projet');
  await frame.fill('.seq-head textarea', 'INT. JOUR');
  await frame.fill('.plan textarea', 'Gros plan');
  await page.waitForFunction(() => isDirty === true);
  await page.evaluate(() => closeApp());
  const d = cinemaData();
  eq([d.sequences[0].info, d.plans[0].info], ['INT. JOUR', 'Gros plan'], 'textes');
  if ('projectName' in d) throw new Error('le nom du projet ne doit pas être dans les données');
});

await test("Cinema Script : claquette sur le plan de travail, avis = prise enregistrée, sans renumérotation", async (page) => {
  const frame = await openCinema(page, SHOOT);
  await frame.evaluate(() => { window.__claps = []; CS.clapper.play = (...a) => window.__claps.push(a); });
  await frame.click('[data-view="tournage"]');
  await frame.click('#bClap');
  await frame.click('.row[data-key="1.1"]');
  eq(await frame.textContent('.cl-nums .take b'), '4', 'prise suivante après 1 et 3');
  await frame.click('.cl-clap');
  await frame.fill('#com', 'raccord verre');
  await frame.click('.av.k-master');
  await frame.click('.row[data-key="2.1"]');
  await frame.click('.av.k-ok');
  eq(await frame.evaluate(() => window.__claps), [[1, 1, 4]], 'clap joué (séq, plan, prise)');
  await page.waitForFunction(() => isDirty === true);
  await page.evaluate(() => closeApp());
  const t = cinemaData().takes;
  eq(t.map(x => [x.seqId, x.planId, x.prise, x.avis, x.com]), [[1, 1, 1, '✅ OK (Bonne)', ''], [1, 1, 3, '😕 Bof (Ratée)', ''],
    [1, 1, 4, '⭐ MASTER (Parfaite)', 'raccord verre'], [2, 1, 1, '✅ OK (Bonne)', '']], 'prises');
  if (!t.every(x => x.uid && x.timestamp)) throw new Error('uid/heure manquants');
});

await test("Cinema Script : lecture seule (claquette consultable, rien de modifiable) ; textes piégés affichés en texte", async (page) => {
  const data = structuredClone(SHOOT);
  data.sequences[0].info = '<img src=x onerror="parent.__pwned=1">';
  data.takes[0].com = '<b onclick=x>gras</b>';
  const frame = await openCinema(page, data);
  await page.evaluate(() => toggleAppMode());
  await frame.waitForFunction(() => CS.readOnly === true);
  eq(await frame.$$eval('.adder, textarea', e => e.length), 0, 'pas de création ni de saisie');
  eq(await frame.textContent('.seq-head .ro'), '<img src=x onerror="parent.__pwned=1">', 'info en texte');
  await frame.click('#bClap');
  await frame.click('.plan[data-seq="1"][data-plan="1"]');
  eq(await frame.$$eval('.av', e => e.every(b => b.disabled)), true, 'avis désactivés');
  eq(await frame.$$eval('img, b[onclick]', e => e.length), 0, 'aucune balise injectée');
});

await test("Cinema Script : une mise à jour reçue pendant la saisie n'écrase pas le champ", async (page) => {
  const frame = await openCinema(page, SHOOT);
  await frame.click('.seq-head textarea');
  await page.keyboard.press('End');
  await page.keyboard.type(' (nuit)');
  const remote = structuredClone(SHOOT); remote.sequences[1].info = 'EXT. RUE – AUBE';
  await page.evaluate((d) => postToApp('RESTORE_DATA', d), remote);
  await wait(200);
  eq(await frame.inputValue('.seq-head textarea'), 'INT. CUISINE – JOUR (nuit)', 'saisie conservée');
  await page.keyboard.type(' ext');      // on continue à taper après la mise à jour
  await frame.click('#proj');
  await frame.waitForFunction(() => CS.state.sequences[1].info === 'EXT. RUE – AUBE');
  eq(await frame.evaluate(() => CS.state.sequences[0].info), 'INT. CUISINE – JOUR (nuit) ext', 'texte tapé gardé après la sortie du champ');
  await page.waitForFunction(() => isDirty === true);
  await page.evaluate(() => closeApp());
  eq(cinemaData().sequences.map(s => s.info), ['INT. CUISINE – JOUR (nuit) ext', 'EXT. RUE – AUBE'], 'Drive : saisie + mise à jour reçue');
});

await test("Cinema Script : mise à jour reçue juste après la frappe (avant l'envoi) : la saisie est envoyée quand même", async (page) => {
  const frame = await openCinema(page, SHOOT);
  await frame.click('.plan textarea');
  await page.keyboard.press('End');
  await page.keyboard.type(' serré');
  const remote = structuredClone(SHOOT); remote.plans[1].temps = '45 min';
  await page.evaluate((d) => postToApp('RESTORE_DATA', d), remote);   // avant les 0,8 s
  await wait(1500);                                                   // le champ garde le focus
  await page.evaluate(() => closeApp());
  const d = cinemaData();
  eq([d.plans[0].info, d.plans[1].temps], ['Plan large serré', '45 min'], 'Drive : saisie + mise à jour reçue');
});

await test("Cinema Script : PDF avec le nom du projet, dans l'ordre de tournage", async (page) => {
  const frame = await openCinema(page, SHOOT);
  await frame.evaluate(() => { window.print = () => { window.__printed = document.getElementById('cs-print').textContent; }; });
  await frame.click('#bPdfF');
  const txt = await frame.evaluate(() => window.__printed);
  if (!txt.includes('PROJET : Doc') || !txt.includes('--- Lundi ---') || txt.indexOf('S2 - P1') > txt.indexOf('S1 - P1')) throw new Error('PDF : ' + txt);
});

await test("Cinema Script : vidéo de référence choisie dans Drive (miniature tirée de la vidéo, lien Drive)", async (page) => {
  // Vidéo : noir au début puis vert ; la miniature de Google (lh3) n'est pas lisible (CORS)
  add({ id: 'vid1', name: 'repet_cuisine.webm', mimeType: 'video/webm', parents: ['autre'], thumbnailLink: 'https://lh3.googleusercontent.com/drive-thumb/vid1=s220',
        content: fs.readFileSync(path.join(TESTS_DIR, 'fixtures', 'repetition.webm')) });
  files.vid1.noAccess = true;
  const frame = await openCinema(page, SHOOT);
  await page.evaluate(() => { window.__pickVideo = { id: 'vid1', name: 'repet_cuisine.webm', mimeType: 'video/webm' }; });
  await frame.click('.plan[data-seq="1"] textarea');
  await frame.click('.plan[data-seq="1"] .tool:has-text("Vidéo de référence")');
  await frame.waitForFunction(() => (CS.plan(1, 1).video && CS.plan(1, 1).video.thumb) || document.querySelector('.cs-toast'), null, { timeout: 10000 });
  const toast = await frame.evaluate(() => { const t = document.querySelector('.cs-toast'); return t && !CS.plan(1, 1).video ? t.textContent : null; });
  if (toast) throw new Error('message : ' + toast);
  const v = await frame.evaluate(() => CS.plan(1, 1).video);
  eq([v.id, v.name, v.thumb.startsWith('data:image/jpeg')], ['vid1', 'repet_cuisine.webm', true], 'vidéo enregistrée');
  const px = await frame.evaluate(async (src) => { const i = new Image(); i.src = src; await i.decode();
    const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0);
    return Array.from(g.getImageData(i.width >> 1, i.height >> 1, 1, 1).data.slice(0, 3)); }, v.thumb);
  if (!(px[1] > 120 && px[0] < 100 && px[2] < 120)) throw new Error('miniature pas tirée de la vidéo (attendu vert) : ' + px);
  eq(log.some(l => l.includes('/files/vid1?alt=media')), true, "vidéo lue par l'API Drive");
  eq(await frame.$$eval('.plan[data-seq="1"] .vid img, .plan[data-seq="1"] .vid i', e => e.length), 0, 'plan : pas de miniature');
  eq(await frame.textContent('.plan[data-seq="1"] .vid'), 'repet_cuisine.webm', 'plan : nom seul');
  await frame.click('.plan[data-seq="1"] .vid');
  eq((await frame.getAttribute('.cs-modal a.cs-video', 'style') || '').includes('data:image/jpeg'), true, 'fenêtre : miniature');
  eq(await frame.getAttribute('.cs-modal a.cs-video', 'href'), 'https://drive.google.com/file/d/vid1/view', 'lecture : lien Drive');
  eq(await frame.textContent('.cs-modal .cs-vname'), 'repet_cuisine.webm', 'nom dans la fenêtre');
  await frame.click('.cs-modal .cs-btn.primary');
  await page.waitForFunction(() => isDirty === true);
  await page.evaluate(() => closeApp());
  eq(cinemaData().plans.find(p => p.seqId === 1).video.id, 'vid1', 'dans le document');
});

await test("Cinema Script : prises d'un plan (liste, suppression avec avertissement) ; l'affichage ne s'enregistre pas", async (page) => {
  const frame = await openCinema(page, SHOOT);
  const before = log.filter(l => l.startsWith('PATCH')).length;
  await frame.click('[data-view="tournage"]');
  await frame.click('#bClap');
  await frame.click('.row[data-key="2.1"]');
  await frame.click('.cl-x');
  await frame.click('[data-view="scenario"]');
  await wait(4000);
  eq(await page.evaluate(() => isDirty), false, 'rien en attente');
  eq(log.filter(l => l.startsWith('PATCH')).length, before, "aucun envoi à Drive pour l'affichage");
  eq(await frame.$$eval('.plan[data-seq="1"][data-plan="1"] .dots i', e => e.length), 2, 'pastilles');
  await frame.click('.plan[data-seq="1"][data-plan="1"] textarea');
  await frame.click('.plan[data-seq="1"][data-plan="1"] .tool:has-text("Prises (2)")');
  eq(await frame.$$eval('.cs-take', e => e.length), 2, 'deux prises listées');
  await frame.click('.cs-take:first-child .cs-del');
  await frame.waitForSelector('.cs-modal-back:last-child .cs-btn.danger');
  await frame.click('.cs-modal-back:last-child .cs-btn.danger');
  await frame.waitForFunction(() => document.querySelectorAll('.cs-take').length === 1);
  eq(await frame.textContent('.cs-take b'), 'Prise 3', 'la prise 3 garde son numéro');
  await page.waitForFunction(() => isDirty === true);
  await page.evaluate(() => closeApp());
  eq(cinemaData().takes.map(t => t.prise), [3], 'prise supprimée dans le document');
});

await test("Cinema Script : beaucoup de prises → « … » puis les 8 dernières pastilles", async (page) => {
  const data = structuredClone(SHOOT);
  for (let n = 4; n <= 20; n++) data.takes.push({ uid: 'x' + n, seqId: 1, planId: 1, prise: n, avis: '⭐ MASTER (Parfaite)', com: '', timestamp: '' });
  const frame = await openCinema(page, data);
  eq(await frame.$$eval('.plan[data-seq="1"][data-plan="1"] .dots i', e => e.length), 8, '8 pastilles');
  eq(await frame.$$eval('.plan[data-seq="1"][data-plan="1"] .dots .more', e => e.length), 1, '« … » devant');
  eq(await frame.$$eval('.plan[data-seq="2"] .dots .more', e => e.length), 0, 'pas de « … » sans prises en trop');
});

await test("Cinema Script : PDF, colonnes étroites pour les numéros et le temps", async (page) => {
  const frame = await openCinema(page, SHOOT);
  await frame.evaluate(() => { window.print = () => {}; });
  await frame.click('#bPdfF');
  await page.emulateMedia({ media: 'print' });              // mise en page d'impression réelle
  const w = await frame.evaluate(() => [...document.querySelectorAll('#cs-print th')].map(th => Math.round(th.getBoundingClientRect().width)));
  await page.emulateMedia({ media: 'screen' });
  if (!(w[1] > w[0] * 3 && w[1] > w[2] * 3)) throw new Error('largeurs : ' + w);
});

await test("API : une app choisit un fichier Drive (Picker) et reçoit son contenu ; hors-ligne → message", async (page) => {
  add({ id: 'csv1', name: 'liste.csv', mimeType: 'text/csv', parents: ['autre'], content: 'nom;rôle\nMarie;scripte' });
  files.csv1.noAccess = true;
  const frame = await openDoc(page);
  await page.evaluate(() => { window.__pickFile = { id: 'csv1', name: 'liste.csv', mimeType: 'text/csv' }; });
  const f = await frame.evaluate(() => OneAppAPI.pickDriveFile({ content: 'text', thumbnail: false }));
  eq([f.id, f.name, f.content], ['csv1', 'liste.csv', 'nom;rôle\nMarie;scripte'], 'fichier et contenu');
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  const err = await frame.evaluate(() => OneAppAPI.pickDriveFile({}).then(() => 'ok', e => e.message));
  await page.context().setOffline(false);
  if (!/Internet/.test(err)) throw new Error('message attendu, obtenu : ' + err);
});

await test("App : fichier de l'appareil (<input type=file>) lisible dans l'iframe", async (page) => {
  const frame = await openDoc(page);
  await frame.evaluate(() => { const i = document.createElement('input'); i.type = 'file'; i.id = 'f'; document.body.append(i); });
  await frame.setInputFiles('#f', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('bonjour') });
  eq(await frame.evaluate(() => document.getElementById('f').files[0].text()), 'bonjour', 'contenu lu');
});

await test("Accueil : couleurs d'apps toutes différentes jusqu'à 12 apps, stables", async (page) => {
  const r = await page.evaluate(() => {
    const ids = ['1Wh0TQqgNYSp7NMC6s2ErJKQYVt48468n', '1UKLJ1yY298wySyeM8JJlDYHTBDexP2lg', '17WPAZkLvrfMH2ZlqsD_5i1LA1HH5rSh8',
      '1hido4uqHExAUkWdAjeG0_9Ejyp-an0u6', '1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab', '1zzzzz', '1zzzzy'];
    assignAppHues(ids.map(id => ({ id })));
    const a = ids.map(id => appHue({ id }));
    assignAppHues(ids.map(id => ({ id })).reverse());
    const b = ids.map(id => appHue({ id }));
    return { distinct: new Set(a).size, same: JSON.stringify(a) === JSON.stringify(b) };
  });
  eq(r, { distinct: 8, same: true }, 'teintes');
});

await test("API : lien Drive spécial sur iPhone (googledrive://)", async (page) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' }); });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.app-tile'));
  const frame = await openDoc(page);
  eq(await frame.evaluate(() => OneAppAPI.driveFileLink('vid1')), 'googledrive://https://drive.google.com/file/d/vid1/view', 'lien iOS');
});

// --- Apps publiées sur GitHub, apps partagées, copie avant modification, import ---
const GH_KEY = 'BigbangX6/demo/main/apps/demo.html';
const GH_URL = 'https://github.com/BigbangX6/demo/blob/main/apps/demo.html';
const ghApp = (v) => `<!DOCTYPE html><html><head><title>Appli GitHub</title><meta name="oneapp-icon" content="🐙"></head><body><script>
window.ver = ${v}; window.shown = null;
OneAppAPI.loadData().then(r => { window.shown = r.app_data; });
<\/script></body></html>`;
async function installFromGithub(page) {
  ctl.github[GH_KEY] = ghApp(1);
  page.evaluate(() => openCreateDialog());
  await page.waitForSelector('#paste-app');
  await page.fill('#paste-app', GH_URL);
  await page.waitForFunction(() => !document.getElementById('create-app-go').disabled);
  await page.click('#create-app-go');
  await page.waitForFunction(() => home.apps.some(a => a.name === 'Appli GitHub'));
  return Object.values(files).find(f => f.name === 'Appli GitHub.oneapp');
}
async function openGhDoc(page, appId) {
  await page.evaluate((id) => openAppEnvironment(id, 'Appli GitHub', 'ghdoc', 'Doc GitHub'), appId);
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'));
  const frame = page.frames().find(f => f !== page.mainFrame());
  await frame.waitForFunction(() => window.shown !== null);
  return frame;
}

await test("GitHub : coller le lien installe l'app (seul le lien est dans Drive)", async (page) => {
  const app = await installFromGithub(page);
  const pointer = JSON.parse(app.content);
  eq([pointer.oneapp_pointer, pointer.source, pointer.url], [1, 'github', 'https://raw.githubusercontent.com/' + GH_KEY], 'pointeur');
  eq([app.appProperties.oneapp_source, app.description], ['github', '🐙'], 'propriétés Drive, icône');
  if (!log.some(l => l.includes(`/files/${app.id}/permissions`))) throw new Error('pointeur non rendu public');
});

await test("GitHub : une mise à jour publiée est utilisée à l'ouverture suivante ; GitHub injoignable → copie de l'appareil", async (page) => {
  const app = await installFromGithub(page);
  add({ id: 'ghdoc', name: 'Doc GitHub.onefile', mimeType: 'application/json', parents: app.parents,
        content: JSON.stringify({ oneapp_metadata: { app_name: 'Appli GitHub', source_app_drive_id: app.id }, app_data: ['gh'] }) });
  let frame = await openGhDoc(page, app.id);
  eq(await frame.evaluate(() => [window.ver, window.shown]), [1, ['gh']], 'version 1');
  await page.evaluate(() => closeApp());
  ctl.github[GH_KEY] = ghApp(2);                     // push sur GitHub
  frame = await openGhDoc(page, app.id);
  eq(await frame.evaluate(() => window.ver), 2, 'nouvelle version prise, pas la copie locale');
  await page.evaluate(() => closeApp());
  ctl.githubDown = true;
  frame = await openGhDoc(page, app.id);
  eq(await frame.evaluate(() => window.ver), 2, "copie de l'appareil quand GitHub est injoignable");
});

await test("Coller du HTML : fonctionnement habituel, l'app est enregistrée dans Drive", async (page) => {
  page.evaluate(() => openCreateDialog());
  await page.waitForSelector('#paste-app');
  await page.fill('#paste-app', 'Voici :\n```html\n' + ghApp(5).replace('Appli GitHub', 'Appli collée') + '\n```');
  await page.waitForFunction(() => !document.getElementById('create-app-go').disabled);
  await page.click('#create-app-go');
  await page.waitForFunction(() => home.apps.some(a => a.name === 'Appli collée'));
  const app = Object.values(files).find(f => f.name === 'Appli collée.oneapp');
  if (!app.content.startsWith('<!DOCTYPE html>') || app.appProperties) throw new Error('app HTML attendue');
  eq(ctl.githubHits, 0, 'aucun appel à GitHub');
});

await test("Modifier une app GitHub ou partagée : proposition de copie, puis éditeur sur la copie", async (page) => {
  await installFromGithub(page);
  const app = await page.evaluate(() => home.apps.find(a => a.name === 'Appli GitHub'));
  page.evaluate((a) => openAppEditor(a.id, a.name), app);
  await page.click('#own-copy-go');
  await page.waitForFunction(() => document.getElementById('edit-app-view').style.display === 'flex');
  const copy = Object.values(files).find(f => f.name === 'Appli GitHub (copie).oneapp');
  if (!copy || !copy.content.includes('<title>Appli GitHub (copie)</title>')) throw new Error('copie HTML attendue');
  eq(await page.inputValue('#editor-full-code') === copy.content, true, "l'éditeur montre la copie");
  eq(JSON.parse(Object.values(files).find(f => f.name === 'Appli GitHub.oneapp').content).source, 'github', "l'app GitHub est intacte");
});

await test("Lien partagé (autre compte) : l'app reste dans l'accueil après fermeture et rouvre le document", async (page) => {
  addSharedFromOther();
  await page.goto(`http://localhost:${PORT}/index.html?file=otherdoc`);
  await page.waitForFunction(() => document.getElementById('access-modal-overlay').style.display === 'flex');
  await page.click('#access-modal-add');
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'));
  await page.evaluate(() => closeApp());
  await page.waitForFunction(() => home.apps.some(a => a.name === 'Budget') && home.docs.some(d => d.id === 'otherdoc'));
  const doc = await page.evaluate(() => home.docs.find(d => d.id === 'otherdoc'));
  eq(await page.evaluate((id) => home.apps.find(a => a.id === id).source, doc.appId), 'drive', "le document est rattaché à l'app partagée");
  await page.evaluate((d) => openHomeDoc(d), doc);
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'));
  const frame = page.frames().find(f => f !== page.mainFrame());
  await frame.waitForFunction(() => window.shown !== null);
  eq(await frame.evaluate(() => window.shown), ['partagé'], 'document rouvert');
});

await test("Importer un .onefile dans une app (bouton discret)", async (page) => {
  await page.evaluate(() => selectApp('app1'));
  const chooser = page.waitForEvent('filechooser');
  await page.click('#import-doc-btn');
  await (await chooser).setFiles({ name: 'Sauvegarde.onefile', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ oneapp_metadata: { app_name: "L'agenda", source_app_drive_id: 'ancien' }, app_data: ['importé'] })) });
  await page.waitForFunction(() => home.docs.some(d => d.name === 'Sauvegarde'));
  const f = Object.values(files).find(x => x.name === 'Sauvegarde.onefile');
  const json = JSON.parse(f.content);
  eq([f.parents[0], json.oneapp_metadata.source_app_drive_id, json.app_data], ['fold1', 'app1', ['importé']], 'document créé dans l\'app');
});

const GH_POINTER = JSON.stringify({ oneapp_pointer: 1, source: 'github', url: 'https://raw.githubusercontent.com/' + GH_KEY, page: GH_URL });

await test("Partage d'une app GitHub : le destinataire enregistre le lien GitHub, pas un pointeur Drive", async (page) => {
  addSharedFromOther();
  files.otherapp.content = GH_POINTER;                 // l'app de l'auteur est un lien GitHub
  ctl.github[GH_KEY] = ghApp(3);
  await page.goto(`http://localhost:${PORT}/index.html?file=otherdoc`);
  await page.waitForFunction(() => document.getElementById('access-modal-overlay').style.display === 'flex');
  await page.click('#access-modal-add');
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'));
  const frame = page.frames().find(f => f !== page.mainFrame());
  await frame.waitForFunction(() => window.shown !== null);
  eq(await frame.evaluate(() => window.ver), 3, 'app chargée depuis GitHub');
  const mine = Object.values(files).filter(f => f.name.endsWith('.oneapp') && f.id !== 'otherapp' && f.id !== 'app1');
  eq(mine.length, 1, 'une seule app ajoutée');
  eq([JSON.parse(mine[0].content).source, mine[0].appProperties.oneapp_source], ['github', 'github'], 'lien GitHub enregistré');
});

await test("Ancien pointeur Drive vers une app GitHub : converti en lien GitHub à l'ouverture", async (page) => {
  addSharedFromOther();
  delete files.otherdoc.noAccess;
  files.otherapp.content = GH_POINTER;
  ctl.github[GH_KEY] = ghApp(4);
  add({ id: 'ptr', name: 'Budget.oneapp', mimeType: 'application/json', parents: ['fold1'], description: '💰',
        appProperties: { oneapp_source: 'drive', oneapp_target: 'otherapp' }, content: JSON.stringify({ oneapp_pointer: 1, source: 'drive', fileId: 'otherapp' }) });
  await page.evaluate(() => openAppEnvironment('ptr', 'Budget', 'otherdoc', 'Budget 2026'));
  await page.waitForFunction(() => document.querySelector('#iframe-container iframe'));
  const frame = page.frames().find(f => f !== page.mainFrame());
  await frame.waitForFunction(() => window.shown !== null);
  eq(await frame.evaluate(() => window.ver), 4, 'app chargée');
  eq(JSON.parse(files.ptr.content).source, 'github', 'pointeur converti');
  eq(files.ptr.appProperties.oneapp_source, 'github', 'propriété Drive mise à jour');
});

await test("Document créé avec une app GitHub : le lien GitHub voyage avec le document", async (page) => {
  const app = await installFromGithub(page);
  const created = await page.evaluate((a) => createOneFile('Nouveau', a.parents[0], 'Appli GitHub', a.id, []), app);
  const meta = JSON.parse(files[created.id].content).oneapp_metadata;
  eq([meta.source_app_drive_id, meta.source_app && meta.source_app.url], [app.id, 'https://raw.githubusercontent.com/' + GH_KEY], 'métadonnées');
});

await browser.close();
server.close();
console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent');
process.exit(failures ? 1 : 0);
