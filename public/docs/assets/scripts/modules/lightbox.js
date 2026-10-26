/* developer-guide.html / user-guide.html: placeholder fallback for broken
   screenshots, plus a click-to-enlarge lightbox with prev/next stepping. */
export function initLightbox() {
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
