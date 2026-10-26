/* docs/index.html: fetches assets/documents.json and renders the list. */
import { escapeHtml } from './dom-utils.js';

function renderDocumentList(container, documents) {
  container.innerHTML = '';
  documents.forEach(function (doc) {
    var item = document.createElement('article');
    item.className = 'doc-item';
    item.setAttribute('role', 'listitem');
    item.innerHTML =
      '<div class="doc-item__body">' +
        '<h2 class="doc-item__title">' + escapeHtml(doc.title || 'Untitled document') + '</h2>' +
        '<p class="doc-item__desc">' + escapeHtml(doc.description || '') + '</p>' +
        (doc.updated ? '<span class="doc-item__updated">Updated ' + escapeHtml(doc.updated) + '</span>' : '') +
      '</div>' +
      '<div class="doc-item__links">' +
        (doc.userGuide ? '<a class="doc-link" href="' + escapeHtml(doc.userGuide) + '">User Guide</a>' : '') +
        (doc.developerGuide ? '<a class="doc-link doc-link--dev" href="' + escapeHtml(doc.developerGuide) + '">Developer Guide</a>' : '') +
      '</div>';
    container.appendChild(item);
  });
  if (!documents.length) {
    container.innerHTML = '<p class="lede">No documents published yet.</p>';
  }
}

export function initDocumentList() {
  var container = document.getElementById('doc-list');
  if (!container) return;

  fetch('assets/documents.json', { cache: 'no-cache' })
    .then(function (res) {
      if (!res.ok) throw new Error('Failed to load documents.json (' + res.status + ')');
      return res.json();
    })
    .then(function (data) { renderDocumentList(container, data.documents || []); })
    .catch(function (err) {
      console.error('[Harleys Docs] ', err);
      container.innerHTML = '<p class="lede">Unable to load the document list.</p>';
    });
}
