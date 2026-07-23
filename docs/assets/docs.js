/* ==========================================================================
   Harleys Fine Baking ODOO DEV — Shared Documentation Script
   1. Document list  — docs/index.html renders assets/documents.json
   2. Lightbox       — click any figure image to view it enlarged, then step
                        through every screenshot on the page with prev/next
                        or arrow keys.
   ========================================================================== */
(function () {
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ------------------------------------------------------------------------
     1. DOCUMENT LIST (docs/index.html)
     ------------------------------------------------------------------------ */
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

  function initDocumentList() {
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

  /* ------------------------------------------------------------------------
     2. SCREENSHOT FIGURES — placeholder fallback + lightbox
        (developer-guide.html, user-guide.html)
     ------------------------------------------------------------------------ */
  function initLightbox() {
    var shots = Array.prototype.slice.call(document.querySelectorAll('.shot'));
    if (!shots.length) return;

    // Each figure toggles its own placeholder on load/error — no inline
    // onload/onerror attributes in the markup. Only images that actually
    // loaded join the lightbox gallery.
    var gallery = [];
    shots.forEach(function (shot) {
      var img = shot.querySelector('img');
      var placeholder = shot.querySelector('.placeholder');
      if (!img) return;

      function onLoad() {
        if (placeholder) placeholder.hidden = true;
        if (gallery.indexOf(img) === -1) {
          gallery.push(img);
          img.setAttribute('data-lightbox', 'true');
          img.setAttribute('tabindex', '0');
          img.setAttribute('role', 'button');
          img.setAttribute('aria-label', 'View larger: ' + (img.alt || 'screenshot'));
        }
      }
      function onError() { img.hidden = true; }

      if (img.complete) {
        if (img.naturalWidth > 0) onLoad(); else onError();
      } else {
        img.addEventListener('load', onLoad);
        img.addEventListener('error', onError);
      }
    });

    var overlay = document.createElement('div');
    overlay.className = 'lightbox';
    overlay.innerHTML =
      '<div class="lightbox__frame">' +
        '<button type="button" class="lightbox__close" aria-label="Close">&times;</button>' +
        '<button type="button" class="lightbox__nav lightbox__nav--prev" aria-label="Previous screenshot">&#8249;</button>' +
        '<img class="lightbox__img" alt="">' +
        '<button type="button" class="lightbox__nav lightbox__nav--next" aria-label="Next screenshot">&#8250;</button>' +
        '<p class="lightbox__caption"></p>' +
      '</div>';
    document.body.appendChild(overlay);

    var frameImg = overlay.querySelector('.lightbox__img');
    var caption = overlay.querySelector('.lightbox__caption');
    var current = 0;

    function show(index) {
      if (!gallery.length) return;
      current = (index + gallery.length) % gallery.length;
      var img = gallery[current];
      frameImg.src = img.src;
      frameImg.alt = img.alt || '';
      var figcaption = img.closest('figure');
      var captionEl = figcaption ? figcaption.querySelector('figcaption') : null;
      caption.textContent = captionEl ? captionEl.textContent.trim() : (img.alt || '');
    }

    function open(index) {
      show(index);
      overlay.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    }

    function close() {
      overlay.classList.remove('is-open');
      document.body.style.overflow = '';
    }

    gallery.forEach(function (img, index) {
      img.addEventListener('click', function () { open(index); });
      img.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(index);
        }
      });
    });

    overlay.querySelector('.lightbox__close').addEventListener('click', close);
    overlay.querySelector('.lightbox__nav--prev').addEventListener('click', function () { show(current - 1); });
    overlay.querySelector('.lightbox__nav--next').addEventListener('click', function () { show(current + 1); });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', function (e) {
      if (!overlay.classList.contains('is-open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(current - 1);
      if (e.key === 'ArrowRight') show(current + 1);
    });
  }

  function init() {
    initDocumentList();
    initLightbox();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
