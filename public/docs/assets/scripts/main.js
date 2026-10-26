/* Docs entry point, loaded as <script type="module">. */
import { initDocumentList } from './modules/document-list.js';
import { initLightbox } from './modules/lightbox.js';

function init() {
  initDocumentList();
  initLightbox();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
