/**
 * Hygiene Audit sheet → dev-link dashboard (/audit), live sync.
 *
 * Every edit to the tabs the dashboard reads is pushed to /api/audit/webhook with those tabs'
 * display values, so open dashboards update within about 15 seconds. If a push fails (dashboard or
 * tunnel down), nothing breaks: the dashboard also re-reads the sheet every 30 s on its own.
 *
 * Install (once, by someone with edit access):
 *   1. Extensions → Apps Script, paste this file as Code.gs, Save.
 *   2. Reload the sheet. A menu "Audit Dashboard" appears.
 *   3. Audit Dashboard → Connect dashboard…, enter the dashboard URL and the secret
 *      (AUDIT_WEBHOOK_SECRET in dev-link's .env.local), and approve Google's permission prompt.
 *
 * Installable triggers (not a simple onEdit) are needed because a simple trigger may not call
 * UrlFetchApp. They run as the person who connected, for edits made by anyone.
 */

var TABS = [
  'Audit Summary',
  'Cloud-Audit Entry Report',
  'PO-Audit Entry Report',
  'Supporting',
  'Ratings',
  'Sheet11',
  'OP',
  'Sheet6',
];
var WEBHOOK_PATH = '/api/audit/webhook';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Audit Dashboard')
    .addItem('Connect dashboard…', 'connectDashboard')
    .addItem('Sync now', 'syncNow')
    .addItem('Connection status', 'showStatus')
    .addSeparator()
    .addItem('Turn live sync off', 'disconnectDashboard')
    .addToUi();
}

// ------------------------------------------------------------------ menu actions

function connectDashboard() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var current = props.getProperty('DASHBOARD_URL') || '';
  var urlAnswer = ui.prompt(
    'Connect dashboard (1 of 2)',
    'Dashboard address: the deployed site (https://devharleys.vercel.app) or, for a local demo, the tunnel (https://name.trycloudflare.com)' + (current ? '\n\nNow: ' + current : ''),
    ui.ButtonSet.OK_CANCEL
  );
  if (urlAnswer.getSelectedButton() !== ui.Button.OK) return;
  var url = (urlAnswer.getResponseText() || current).trim().replace(/\/+$/, '');
  if (!/^https:\/\//.test(url)) {
    ui.alert('The address must start with https:// (Google cannot reach localhost; use the tunnel address).');
    return;
  }
  if (url.indexOf(WEBHOOK_PATH) < 0) url += WEBHOOK_PATH;

  var secretAnswer = ui.prompt(
    'Connect dashboard (2 of 2)',
    'Webhook secret (AUDIT_WEBHOOK_SECRET). Leave empty to keep the saved one.',
    ui.ButtonSet.OK_CANCEL
  );
  if (secretAnswer.getSelectedButton() !== ui.Button.OK) return;
  var secret = secretAnswer.getResponseText().trim() || props.getProperty('WEBHOOK_SECRET') || '';
  if (!secret) {
    ui.alert('A secret is required.');
    return;
  }

  props.setProperties({ DASHBOARD_URL: url, WEBHOOK_SECRET: secret });
  installTriggers_();
  var result = push_({ tab: 'Audit Dashboard', range: 'Connect', value: 'connected' });
  ui.alert(result.ok
    ? 'Live sync is on. Every edit now updates the dashboard.\n\n' + url
    : 'Live sync is on, but the dashboard did not answer:\n' + result.message + '\n\nCheck the address, the secret and that the tunnel is running.');
}

function syncNow() {
  var result = push_({ tab: 'Audit Dashboard', range: 'Sync now', value: 'manual sync' });
  SpreadsheetApp.getActive().toast(result.ok ? 'Dashboard updated.' : 'Dashboard did not answer: ' + result.message, 'Audit Dashboard', 6);
}

function showStatus() {
  var props = PropertiesService.getScriptProperties();
  var triggers = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'handleEdit' || t.getHandlerFunction() === 'handleChange';
  });
  SpreadsheetApp.getUi().alert(
    'Audit Dashboard',
    'Live sync: ' + (triggers.length ? 'on' : 'off') +
      '\nDashboard: ' + (props.getProperty('DASHBOARD_URL') || 'not set') +
      '\nLast push: ' + (props.getProperty('LAST_PUSH') || 'never'),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function disconnectDashboard() {
  removeTriggers_();
  SpreadsheetApp.getActive().toast('Live sync is off. The dashboard still re-reads the sheet every 30 s.', 'Audit Dashboard', 6);
}

// ------------------------------------------------------------------ triggers

function handleEdit(e) {
  var sheet = e && e.range ? e.range.getSheet() : null;
  if (!sheet || TABS.indexOf(sheet.getName()) < 0) return; // OR, HBD-MSG, …: not on the dashboard
  push_({
    tab: sheet.getName(),
    range: e.range.getA1Notation(),
    value: e.value === undefined ? '' : String(e.value),
    oldValue: e.oldValue === undefined ? '' : String(e.oldValue),
    user: (e.user && e.user.getEmail && e.user.getEmail()) || '',
  });
}

// Row/column inserts and deletes, tab changes: onEdit does not fire for those.
function handleChange(e) {
  var type = e && e.changeType;
  if (type === 'EDIT' || type === 'FORMAT') return; // edits already came through handleEdit
  push_({ tab: SpreadsheetApp.getActive().getActiveSheet().getName(), range: type || 'CHANGE', value: '' });
}

function installTriggers_() {
  removeTriggers_();
  var ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('handleEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('handleChange').forSpreadsheet(ss).onChange().create();
}

function removeTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'handleEdit' || t.getHandlerFunction() === 'handleChange') ScriptApp.deleteTrigger(t);
  });
}

// ------------------------------------------------------------------ the push

function push_(edit) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('DASHBOARD_URL');
  var secret = props.getProperty('WEBHOOK_SECRET');
  if (!url || !secret) return { ok: false, message: 'not connected (Audit Dashboard → Connect dashboard…)' };

  // one push at a time; quick successive edits each send the latest state
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return { ok: false, message: 'busy' };
  try {
    var sentAt = Date.now(); // lets the dashboard drop a push that arrives after a newer one
    var ss = SpreadsheetApp.getActive();
    var tabs = {};
    var gids = {};
    TABS.forEach(function (name) {
      var sheet = ss.getSheetByName(name);
      if (!sheet) return;
      gids[name] = sheet.getSheetId();
      tabs[name] = trimRows_(sheet.getDataRange().getDisplayValues());
    });
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + secret },
      payload: JSON.stringify({ edit: edit, gids: gids, tabs: tabs, sentAt: sentAt }),
      muteHttpExceptions: true,
      followRedirects: true,
    });
    var code = res.getResponseCode();
    var ok = code >= 200 && code < 300;
    props.setProperty('LAST_PUSH', new Date().toISOString() + ' → HTTP ' + code);
    return { ok: ok, message: ok ? 'ok' : 'HTTP ' + code + ' ' + res.getContentText().slice(0, 200) };
  } catch (err) {
    props.setProperty('LAST_PUSH', new Date().toISOString() + ' → ' + err);
    return { ok: false, message: String(err) };
  } finally {
    lock.releaseLock();
  }
}

// Entry tabs carry formulas down to row 1000 that show "0": drop those empty trailing rows.
function trimRows_(rows) {
  var end = rows.length;
  while (end > 0 && rows[end - 1].every(function (c) { return c === '' || c === '0'; })) end--;
  return rows.slice(0, end);
}
