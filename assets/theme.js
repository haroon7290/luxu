/* ==========================================================================
   Provenance theme — scripts
   Vanilla JS, no dependencies. Custom elements + delegated events.
   ========================================================================== */
(() => {
  'use strict';

  const theme = window.theme || { routes: {}, settings: {}, strings: {} };
  const routes = theme.routes || {};
  const strings = theme.strings || {};
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const root = (routes.root || '/').replace(/\/$/, '');

  /* ---------- Utilities ---------- */
  const debounce = (fn, wait = 300) => {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(null, args), wait); };
  };

  const fetchJSON = (url, body, method = 'POST') =>
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: body ? JSON.stringify(body) : undefined
    }).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.status) { const err = new Error(data.description || data.message || strings.cartError); err.data = data; throw err; }
      return data;
    });

  const parseHTML = (html) => new DOMParser().parseFromString(html, 'text/html');

  const formatMoney = (cents, format) => {
    if (typeof cents === 'string') cents = cents.replace('.', '');
    cents = parseInt(cents, 10) || 0;
    format = format || (theme.settings.showCurrencyCode ? theme.settings.moneyWithCurrencyFormat : theme.settings.moneyFormat) || '{{amount}}';
    const placeholder = /\{\{\s*(\w+)\s*\}\}/;
    const fmt = (n, precision, thousands = ',', decimal = '.') => {
      const num = (n / 100).toFixed(precision);
      const parts = num.split('.');
      const whole = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, `$1${thousands}`);
      return whole + (parts[1] ? decimal + parts[1] : '');
    };
    const match = format.match(placeholder);
    if (!match) return format;
    let value;
    switch (match[1]) {
      case 'amount_no_decimals': value = fmt(cents, 0); break;
      case 'amount_with_comma_separator': value = fmt(cents, 2, '.', ','); break;
      case 'amount_no_decimals_with_comma_separator': value = fmt(cents, 0, '.', ','); break;
      case 'amount_with_apostrophe_separator': value = fmt(cents, 2, "'", '.'); break;
      case 'amount_no_decimals_with_space_separator': value = fmt(cents, 0, ' ', ','); break;
      case 'amount_with_space_separator': value = fmt(cents, 2, ' ', ','); break;
      case 'amount_with_period_and_space_separator': value = fmt(cents, 2, ' ', '.'); break;
      default: value = fmt(cents, 2);
    }
    return format.replace(placeholder, value);
  };
  theme.formatMoney = formatMoney;

  /* Toast */
  let toastTimer;
  const toast = (message, icon = true) => {
    const el = $('[data-toast]');
    if (!el) return;
    el.innerHTML = (icon ? '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"/></svg>' : '') + `<span>${message}</span>`;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2800);
  };
  theme.toast = toast;

  /* Scroll lock */
  let lockCount = 0;
  const lockScroll = () => { lockCount++; document.body.classList.add('is-locked'); };
  const unlockScroll = () => { lockCount = Math.max(0, lockCount - 1); if (!lockCount) document.body.classList.remove('is-locked'); };

  /* Focus trap */
  const focusable = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const trapFocus = (container, e) => {
    const items = $$(focusable, container).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  /* ==========================================================================
     Overlays: drawers, modals, search
     ========================================================================== */
  class OverlayPanel extends HTMLElement {
    connectedCallback() {
      if (this._bound) return;
      this._bound = true;
      this.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) { e.preventDefault(); this.close(); } });
      this.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.close();
        if (e.key === 'Tab') trapFocus(this, e);
      });
    }
    get isOpen() { return this.classList.contains('is-open'); }
    open(trigger) {
      if (this.isOpen) return;
      this._trigger = trigger || document.activeElement;
      OverlayPanel.closeAll(this);
      this.classList.add('is-open');
      this.setAttribute('aria-hidden', 'false');
      lockScroll();
      requestAnimationFrame(() => {
        const target = $('[autofocus], input[type="search"], input[type="email"]', this) || $('[role="dialog"]', this) || this;
        target.focus({ preventScroll: true });
      });
      this.dispatchEvent(new CustomEvent('overlay:open', { bubbles: true }));
    }
    close() {
      if (!this.isOpen) return;
      this.classList.remove('is-open');
      this.setAttribute('aria-hidden', 'true');
      unlockScroll();
      if (this._trigger && this._trigger.focus) this._trigger.focus({ preventScroll: true });
      this.dispatchEvent(new CustomEvent('overlay:close', { bubbles: true }));
    }
    static closeAll(except) {
      $$('drawer-panel.is-open, cart-drawer.is-open, search-modal.is-open, modal-dialog.is-open').forEach((el) => { if (el !== except) el.close(); });
    }
  }
  customElements.define('drawer-panel', class extends OverlayPanel {});
  customElements.define('modal-dialog', class extends OverlayPanel {});

  /* Account drawer view switching */
  document.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-account-switch]');
    if (!sw) return;
    const drawer = sw.closest('drawer-panel');
    $$('[data-account-view]', drawer).forEach((v) => { v.hidden = v.dataset.accountView !== sw.dataset.accountSwitch; });
  });

  /* ==========================================================================
     Cart
     ========================================================================== */
  const Cart = {
    sectionIds() {
      const ids = ['cart-drawer'];
      const page = $('[data-main-cart]');
      if (page) ids.push(page.dataset.sectionId);
      return ids;
    },
    async add(formData) {
      formData.append('sections', this.sectionIds().join(','));
      formData.append('sections_url', window.location.pathname);
      const res = await fetch(`${routes.cartAdd}`, { method: 'POST', headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: formData });
      const data = await res.json();
      if (!res.ok || data.status) { const err = new Error(data.description || data.message || strings.cartError); throw err; }
      this.render(data.sections);
      return data;
    },
    async change(line, quantity) {
      const data = await fetchJSON(`${routes.cartChange}`, { line, quantity, sections: this.sectionIds(), sections_url: window.location.pathname });
      this.render(data.sections);
      return data;
    },
    async update(body) {
      const data = await fetchJSON(`${routes.cartUpdate}`, Object.assign({ sections: this.sectionIds(), sections_url: window.location.pathname }, body));
      this.render(data.sections);
      return data;
    },
    async refresh() {
      const res = await fetch(`${window.location.pathname}?sections=${this.sectionIds().join(',')}`);
      const data = await res.json();
      this.render(data);
    },
    render(sections) {
      if (!sections) return;
      let count = null;
      if (sections['cart-drawer']) {
        const doc = parseHTML(sections['cart-drawer']);
        const content = $('[data-cart-content]', doc);
        const inner = $('#CartDrawer-Inner');
        if (content && inner) {
          const scroll = $('.drawer__body', inner)?.scrollTop || 0;
          inner.innerHTML = content.outerHTML;
          const body = $('.drawer__body', inner); if (body) body.scrollTop = scroll;
        }
        if (content) count = parseInt(content.dataset.itemCount, 10);
      }
      const page = $('[data-main-cart]');
      if (page && sections[page.dataset.sectionId]) {
        const doc = parseHTML(sections[page.dataset.sectionId]);
        const fresh = $('[data-main-cart]', doc);
        if (fresh) page.innerHTML = fresh.innerHTML;
        if (count === null && fresh) count = parseInt(fresh.dataset.itemCount, 10);
      }
      if (count !== null && !Number.isNaN(count)) this.setCount(count);
      document.dispatchEvent(new CustomEvent('cart:updated', { detail: { count } }));
    },
    setCount(count) {
      $$('[data-cart-count]').forEach((el) => {
        el.textContent = count > 0 ? count : '';
        el.dataset.count = count;
        el.classList.remove('is-bump'); void el.offsetWidth; el.classList.add('is-bump');
      });
    },
    open() {
      const drawer = $('cart-drawer');
      if (drawer && theme.settings.cartType === 'drawer') { drawer.open(); return true; }
      return false;
    }
  };
  theme.cart = Cart;

  class CartDrawer extends OverlayPanel {
    connectedCallback() {
      super.connectedCallback();
      bindCartControls(this);
    }
  }
  customElements.define('cart-drawer', CartDrawer);

  function bindCartControls(scope) {
    if (scope._cartBound) return;
    scope._cartBound = true;

    const setLoading = (line) => { const item = $(`.cart-item[data-line="${line}"]`, scope); if (item) item.classList.add('is-updating'); };

    scope.addEventListener('click', async (e) => {
      const remove = e.target.closest('[data-cart-remove]');
      if (remove) {
        e.preventDefault();
        const line = parseInt(remove.dataset.cartRemove, 10);
        setLoading(line);
        try { await Cart.change(line, 0); } catch (err) { toast(err.message, false); Cart.refresh(); }
        return;
      }
      const apply = e.target.closest('[data-discount-apply]');
      if (apply) {
        const wrap = apply.closest('details') || scope;
        const input = $('[data-discount-input]', wrap);
        const code = input && input.value.trim();
        if (!code) return;
        apply.classList.add('is-loading');
        const existing = $$('[data-discount-remove]', scope).map((b) => b.dataset.discountRemove);
        try {
          const data = await Cart.update({ discount: [...existing, code].join(',') });
          const codes = (data.discount_codes || []);
          const found = codes.find((c) => c.code.toLowerCase() === code.toLowerCase());
          if (found && !found.applicable) toast(strings.discountInvalid, false);
        } catch (err) { toast(err.message, false); }
        apply.classList.remove('is-loading');
        return;
      }
      const removeCode = e.target.closest('[data-discount-remove]');
      if (removeCode) {
        const keep = $$('[data-discount-remove]', scope).map((b) => b.dataset.discountRemove).filter((c) => c !== removeCode.dataset.discountRemove);
        try { await Cart.update({ discount: keep.join(',') }); } catch (err) { toast(err.message, false); }
      }
    });

    scope.addEventListener('change', async (e) => {
      const qty = e.target.closest('.qty__input[data-line]');
      if (qty) {
        const line = parseInt(qty.dataset.line, 10);
        setLoading(line);
        try { await Cart.change(line, parseInt(qty.value, 10) || 0); } catch (err) { toast(err.message, false); Cart.refresh(); }
        return;
      }
      const attr = e.target.closest('[data-cart-attribute]');
      if (attr) {
        const attributes = {}; attributes[attr.dataset.cartAttribute] = attr.checked ? 'Yes' : '';
        try { await Cart.update({ attributes }); } catch (err) { toast(err.message, false); }
      }
    });

    scope.addEventListener('input', debounce((e) => {
      const note = e.target.closest('[data-cart-note]');
      if (note) fetchJSON(`${routes.cartUpdate}`, { note: note.value }).catch(() => {});
    }, 600));

    scope.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('[data-discount-input]')) {
        e.preventDefault();
        const btn = $('[data-discount-apply]', e.target.closest('details') || scope);
        if (btn) btn.click();
      }
    });
  }

  class MainCart extends HTMLElement {
    connectedCallback() { bindCartControls(this); }
  }
  customElements.define('main-cart', MainCart);

  /* Free shipping bar (converts threshold to presentment currency) */
  class FreeShippingBar extends HTMLElement {
    connectedCallback() {
      const base = parseInt(this.dataset.threshold, 10) || 0;
      if (!base) return;
      const rate = parseFloat((window.Shopify && window.Shopify.currency && window.Shopify.currency.rate) || 1) || 1;
      const threshold = Math.round(base * rate);
      const total = parseInt(this.dataset.total, 10) || 0;
      const remaining = threshold - total;
      const pct = Math.min(100, (total / threshold) * 100);
      const text = $('[data-ship-text]', this);
      const fill = $('[data-ship-fill]', this);
      if (fill) requestAnimationFrame(() => { fill.style.width = `${pct}%`; });
      if (text) {
        text.innerHTML = remaining > 0
          ? (strings.freeShippingAway || '').replace('[amount]', `<strong>${formatMoney(remaining)}</strong>`)
          : `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4.5 12.5l5 5 10-11"/></svg> ${strings.freeShippingReached}`;
      }
    }
  }
  customElements.define('free-shipping-bar', FreeShippingBar);

  /* Quantity input */
  class QuantityInput extends HTMLElement {
    connectedCallback() {
      if (this._bound) return; this._bound = true;
      this.input = $('input', this);
      this.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-qty-minus], [data-qty-plus]');
        if (!btn) return;
        const min = parseInt(this.input.min, 10); const max = this.input.max ? parseInt(this.input.max, 10) : Infinity;
        let v = parseInt(this.input.value, 10) || 0;
        v = btn.hasAttribute('data-qty-plus') ? Math.min(max, v + 1) : Math.max(Number.isNaN(min) ? 0 : min, v - 1);
        if (String(v) !== this.input.value) { this.input.value = v; this.input.dispatchEvent(new Event('change', { bubbles: true })); }
      });
    }
  }
  customElements.define('quantity-input', QuantityInput);

  /* ==========================================================================
     Product form
     ========================================================================== */
  class ProductForm extends HTMLElement {
    connectedCallback() {
      if (this._bound) return; this._bound = true;
      this.form = $('form', this);
      if (!this.form) return;
      this.form.addEventListener('submit', (e) => this.onSubmit(e));
    }
    async onSubmit(e) {
      e.preventDefault();
      const btn = $('[data-add-button]', this.form) || $('[type="submit"]', this.form);
      const errorEl = $('[data-form-error]', this.form);
      if (!btn || btn.getAttribute('aria-disabled') === 'true') return;
      btn.classList.add('is-loading'); btn.setAttribute('aria-disabled', 'true');
      if (errorEl) errorEl.hidden = true;
      try {
        await Cart.add(new FormData(this.form));
        const modal = this.closest('modal-dialog');
        if (modal) modal.close();
        if (!Cart.open()) toast(strings.added);
      } catch (err) {
        if (errorEl) { errorEl.textContent = err.message; errorEl.hidden = false; } else toast(err.message, false);
      } finally {
        btn.classList.remove('is-loading'); btn.removeAttribute('aria-disabled');
      }
    }
  }
  customElements.define('product-form', ProductForm);

  /* ==========================================================================
     Variant picker
     ========================================================================== */
  class VariantPicker extends HTMLElement {
    connectedCallback() {
      if (this._bound) return; this._bound = true;
      try { this.variants = JSON.parse($('[data-variants]', this).textContent); } catch (e) { this.variants = []; }
      this.scope = this.closest('[data-product-scope]') || document;
      this.addEventListener('change', () => this.onChange());
      this.markAvailability();
    }
    selectedOptions() {
      return $$('fieldset', this).map((fs) => { const c = $('input:checked', fs); return c ? c.value : null; });
    }
    onChange() {
      const opts = this.selectedOptions();
      const variant = this.variants.find((v) => v.options.every((o, i) => o === opts[i]));
      $$('[data-option-selected]', this).forEach((el, i) => { el.textContent = opts[i] || ''; });
      this.markAvailability();
      this.update(variant);
    }
    markAvailability() {
      const fieldsets = $$('fieldset', this);
      const opts = this.selectedOptions();
      fieldsets.forEach((fs, idx) => {
        $$('input', fs).forEach((input) => {
          const test = opts.slice(); test[idx] = input.value;
          const ok = this.variants.some((v) => v.available && v.options.every((o, i) => i === idx ? o === input.value : (i < idx ? o === test[i] : true)));
          input.classList.toggle('is-unavailable', !ok);
        });
      });
    }
    update(variant) {
      const scope = this.scope;
      const idInputs = $$('[data-variant-id]', scope);
      const buttons = $$('[data-add-button]', scope);
      const labels = $$('[data-add-label]', scope);
      if (!variant) {
        buttons.forEach((b) => { b.disabled = true; });
        labels.forEach((l) => { l.textContent = strings.unavailable; });
        return;
      }
      idInputs.forEach((i) => { i.value = variant.id; i.disabled = !variant.available; });
      buttons.forEach((b) => { b.disabled = !variant.available; });
      labels.forEach((l) => { l.textContent = variant.available ? strings.addToCart : strings.soldOut; });
      $$('[data-dynamic-checkout]', scope).forEach((d) => { d.hidden = !variant.available; });
      $$('[data-price]', scope).forEach((el) => { el.innerHTML = formatMoney(variant.price); });
      $$('[data-compare-price]', scope).forEach((el) => {
        const sale = variant.compare_at_price && variant.compare_at_price > variant.price;
        el.hidden = !sale; if (sale) el.innerHTML = formatMoney(variant.compare_at_price);
      });
      $$('[data-saving]', scope).forEach((el) => {
        const sale = variant.compare_at_price && variant.compare_at_price > variant.price;
        el.hidden = !sale; if (sale) el.textContent = `−${Math.round(((variant.compare_at_price - variant.price) / variant.compare_at_price) * 100)}%`;
      });
      $$('[data-price-wrapper]', scope).forEach((el) => {
        el.classList.toggle('price--sale', !!(variant.compare_at_price && variant.compare_at_price > variant.price));
        el.classList.toggle('price--sold-out', !variant.available);
      });
      $$('[data-sku]', scope).forEach((el) => { el.textContent = variant.sku || ''; el.closest('[data-sku-wrap]')?.toggleAttribute('hidden', !variant.sku); });
      if (variant.featured_media) {
        const gallery = $('product-gallery', scope);
        if (gallery && gallery.goToMedia) gallery.goToMedia(variant.featured_media.id);
      }
      if (this.hasAttribute('data-update-url')) {
        const url = new URL(window.location.href); url.searchParams.set('variant', variant.id);
        window.history.replaceState({}, '', url.toString());
      }
      scope.dispatchEvent(new CustomEvent('variant:change', { bubbles: true, detail: { variant } }));
    }
  }
  customElements.define('variant-picker', VariantPicker);

  /* ==========================================================================
     Product gallery + lightbox
     ========================================================================== */
  class ProductGallery extends HTMLElement {
    connectedCallback() {
      if (this._bound) return; this._bound = true;
      this.track = $('[data-gallery-track]', this);
      this.slides = $$('.gallery__slide', this);
      this.thumbs = $$('[data-thumb]', this);
      this.counter = $('[data-gallery-current]', this);
      this.lightbox = $('[data-lightbox]', this);
      if (!this.track) return;
      this.track.addEventListener('scroll', debounce(() => this.onScroll(), 60), { passive: true });
      this.addEventListener('click', (e) => {
        const thumb = e.target.closest('[data-thumb]');
        if (thumb) return this.goTo(parseInt(thumb.dataset.thumb, 10));
        if (e.target.closest('[data-gallery-prev]')) return this.goTo(this.index - 1);
        if (e.target.closest('[data-gallery-next]')) return this.goTo(this.index + 1);
        const zoom = e.target.closest('[data-zoom]');
        if (zoom) return this.openLightbox(parseInt(zoom.dataset.zoom, 10));
        if (e.target.closest('[data-lightbox-close]')) return this.closeLightbox();
        if (e.target.closest('[data-lightbox-prev]')) return this.lbGo(-1);
        if (e.target.closest('[data-lightbox-next]')) return this.lbGo(1);
        const lbImg = e.target.closest('.lightbox__slide img');
        if (lbImg) lbImg.parentElement.classList.toggle('is-zoomed');
      });
      this.index = 0;
    }
    onScroll() {
      const w = this.track.clientWidth || 1;
      const i = Math.round(this.track.scrollLeft / w);
      this.setActive(i);
    }
    setActive(i) {
      this.index = Math.max(0, Math.min(this.slides.length - 1, i));
      this.slides.forEach((s, n) => s.classList.toggle('is-active', n === this.index));
      this.thumbs.forEach((t, n) => t.classList.toggle('is-active', n === this.index));
      if (this.counter) this.counter.textContent = this.index + 1;
      const active = this.thumbs[this.index];
      if (active) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    goTo(i) {
      if (i < 0) i = this.slides.length - 1;
      if (i >= this.slides.length) i = 0;
      const slide = this.slides[i];
      if (!slide) return;
      const stacked = getComputedStyle(this.track).display === 'grid';
      if (stacked) slide.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else this.track.scrollTo({ left: slide.offsetLeft - this.track.offsetLeft, behavior: 'smooth' });
      this.setActive(i);
    }
    goToMedia(id) {
      const i = this.slides.findIndex((s) => String(s.dataset.mediaId) === String(id));
      if (i > -1) this.goTo(i);
    }
    openLightbox(i) {
      if (!this.lightbox) return;
      this.lightbox.hidden = false; lockScroll();
      this.lbTrack = $('[data-lightbox-track]', this.lightbox);
      const target = $$('.lightbox__slide', this.lbTrack).find((s) => parseInt(s.dataset.index, 10) === i) || $('.lightbox__slide', this.lbTrack);
      requestAnimationFrame(() => { if (target) this.lbTrack.scrollLeft = target.offsetLeft; $('[data-lightbox-close]', this.lightbox).focus(); });
      this._lbKey = (e) => { if (e.key === 'Escape') this.closeLightbox(); if (e.key === 'ArrowRight') this.lbGo(1); if (e.key === 'ArrowLeft') this.lbGo(-1); };
      document.addEventListener('keydown', this._lbKey);
    }
    lbGo(dir) { if (this.lbTrack) this.lbTrack.scrollBy({ left: dir * this.lbTrack.clientWidth, behavior: 'smooth' }); }
    closeLightbox() {
      if (!this.lightbox || this.lightbox.hidden) return;
      this.lightbox.hidden = true; unlockScroll();
      $$('.is-zoomed', this.lightbox).forEach((el) => el.classList.remove('is-zoomed'));
      document.removeEventListener('keydown', this._lbKey);
    }
  }
  customElements.define('product-gallery', ProductGallery);

  /* ==========================================================================
     Generic slider (product carousels, testimonials, collections)
     ========================================================================== */
  class SliderComponent extends HTMLElement {
    connectedCallback() {
      if (this._bound) return; this._bound = true;
      this.track = $('[data-slider]', this);
      if (!this.track) return;
      this.prev = $('[data-slider-prev]', this);
      this.next = $('[data-slider-next]', this);
      this.progress = $('[data-slider-progress]', this);
      this.prev && this.prev.addEventListener('click', () => this.move(-1));
      this.next && this.next.addEventListener('click', () => this.move(1));
      this.track.addEventListener('scroll', () => this.update(), { passive: true });
      new ResizeObserver(() => this.update()).observe(this.track);
      this.update();
    }
    move(dir) {
      const item = this.track.firstElementChild;
      const step = item ? item.getBoundingClientRect().width + parseFloat(getComputedStyle(this.track).columnGap || 0) : this.track.clientWidth;
      const perView = Math.max(1, Math.floor(this.track.clientWidth / step));
      this.track.scrollBy({ left: dir * step * perView, behavior: 'smooth' });
    }
    update() {
      const max = this.track.scrollWidth - this.track.clientWidth;
      const x = this.track.scrollLeft;
      if (this.prev) this.prev.disabled = x <= 2;
      if (this.next) this.next.disabled = x >= max - 2;
      if (this.progress) {
        const ratio = this.track.clientWidth / (this.track.scrollWidth || 1);
        const bar = this.progress.firstElementChild;
        this.progress.hidden = ratio >= 0.999;
        if (bar) {
          bar.style.setProperty('--progress-w', `${ratio * 100}%`);
          bar.style.setProperty('--progress-x', `${max > 0 ? (x / max) * ((1 / ratio) - 1) * 100 : 0}%`);
        }
      }
    }
  }
  customElements.define('slider-component', SliderComponent);

  /* ==========================================================================
     Slideshow (hero)
     ========================================================================== */
  class SlideShow extends HTMLElement {
    connectedCallback() {
      if (this._bound) return; this._bound = true;
      this.slides = $$('.slideshow__slide', this);
      this.counter = $('[data-slide-current]', this);
      this.index = 0;
      this.autoplay = this.dataset.autoplay === 'true' && this.slides.length > 1;
      this.speed = (parseInt(this.dataset.speed, 10) || 6) * 1000;
      this.style.setProperty('--autoplay', `${this.speed / 1000}s`);
      $('[data-slide-prev]', this)?.addEventListener('click', () => this.go(this.index - 1, true));
      $('[data-slide-next]', this)?.addEventListener('click', () => this.go(this.index + 1, true));
      this.addEventListener('mouseenter', () => this.pause());
      this.addEventListener('mouseleave', () => this.play());
      this.addEventListener('focusin', () => this.pause());
      let startX = null;
      this.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
      this.addEventListener('touchend', (e) => {
        if (startX === null) return;
        const dx = e.changedTouches[0].clientX - startX;
        if (Math.abs(dx) > 40) this.go(this.index + (dx < 0 ? 1 : -1), true);
        startX = null;
      });
      this.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') this.go(this.index + 1, true); if (e.key === 'ArrowLeft') this.go(this.index - 1, true); });
      this.play();
    }
    go(i, user) {
      const n = this.slides.length;
      this.index = ((i % n) + n) % n;
      this.slides.forEach((s, k) => { s.classList.toggle('is-active', k === this.index); s.setAttribute('aria-hidden', k === this.index ? 'false' : 'true'); });
      if (this.counter) this.counter.textContent = this.index + 1;
      if (user) { this.pause(); this.play(); }
      else this.restartProgress();
    }
    restartProgress() {
      const bar = $('.slideshow__progress span', this);
      if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = ''; }
    }
    play() {
      if (!this.autoplay || this.timer) return;
      this.classList.add('is-playing'); this.restartProgress();
      this.timer = setInterval(() => this.go(this.index + 1), this.speed);
    }
    pause() { clearInterval(this.timer); this.timer = null; this.classList.remove('is-playing'); }
    disconnectedCallback() { this.pause(); }
  }
  customElements.define('slide-show', SlideShow);

  /* Announcement bar */
  class AnnouncementBar extends HTMLElement {
    connectedCallback() {
      if (this._bound) return; this._bound = true;
      this.slides = $$('.announcement__slide', this);
      if (this.slides.length < 2) return;
      this.i = 0;
      this.speed = (parseInt(this.dataset.speed, 10) || 5) * 1000;
      $('[data-announce-prev]', this)?.addEventListener('click', () => this.go(this.i - 1));
      $('[data-announce-next]', this)?.addEventListener('click', () => this.go(this.i + 1));
      this.addEventListener('mouseenter', () => clearInterval(this.t));
      this.addEventListener('mouseleave', () => this.start());
      this.start();
    }
    start() { clearInterval(this.t); this.t = setInterval(() => this.go(this.i + 1), this.speed); }
    go(i) {
      const n = this.slides.length; this.i = ((i % n) + n) % n;
      this.slides.forEach((s, k) => { s.classList.toggle('is-active', k === this.i); s.setAttribute('aria-hidden', k !== this.i); });
    }
    disconnectedCallback() { clearInterval(this.t); }
  }
  customElements.define('announcement-bar', AnnouncementBar);

  /* ==========================================================================
     Header: sticky behaviour, mega menu keyboard support
     ========================================================================== */
  class SiteHeader extends HTMLElement {
    connectedCallback() {
      if (this._bound) return; this._bound = true;
      this.wrapper = this.closest('.shopify-section') || this;
      this.mode = this.dataset.sticky || 'always';
      if (this.mode !== 'none') this.wrapper.classList.add('is-sticky', 'section-header-wrapper');
      this.lastY = window.scrollY;
      const setH = () => {
        const h = this.offsetHeight;
        document.documentElement.style.setProperty('--header-h', `${h}px`);
        document.documentElement.style.setProperty('--sticky-offset', this.mode === 'none' ? '0px' : `${h}px`);
      };
      setH();
      new ResizeObserver(setH).observe(this);
      window.addEventListener('scroll', () => this.onScroll(), { passive: true });

      $$('.nav__item--mega, .nav__item--dropdown', this).forEach((item) => {
        const link = $('.nav__link', item);
        item.addEventListener('mouseenter', () => link && link.setAttribute('aria-expanded', 'true'));
        item.addEventListener('mouseleave', () => { link && link.setAttribute('aria-expanded', 'false'); item.classList.remove('is-open'); });
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { item.classList.remove('is-open'); link && link.focus(); link && link.setAttribute('aria-expanded', 'false'); }
        });
        if (link) link.addEventListener('click', (e) => {
          if (window.matchMedia('(hover: none)').matches && !item.classList.contains('is-open')) { e.preventDefault(); item.classList.add('is-open'); link.setAttribute('aria-expanded', 'true'); }
        });
      });
    }
    onScroll() {
      const y = window.scrollY;
      this.wrapper.classList.toggle('is-scrolled', y > 10);
      if (this.mode === 'scroll-up') {
        const hide = y > this.lastY && y > this.offsetHeight * 2 && !$('.nav__item--mega:hover', this);
        this.wrapper.classList.toggle('is-hidden', hide);
        document.documentElement.style.setProperty('--sticky-offset', hide ? '0px' : `${this.offsetHeight}px`);
      }
      this.lastY = y;
    }
  }
  customElements.define('site-header', SiteHeader);

  /* ==========================================================================
     Predictive search
     ========================================================================== */
  class SearchModal extends OverlayPanel {
    connectedCallback() {
      super.connectedCallback();
      if (this._searchBound) return; this._searchBound = true;
      this.input = $('[data-predictive-input]', this) || $('input[type="search"]', this);
      this.results = $('[data-predictive-results]', this);
      this.defaults = $('[data-search-default]', this);
      this.reset = $('[data-search-reset]', this);
      if (!this.input) return;
      this.input.addEventListener('input', debounce(() => this.search(), 260));
      $('form', this).addEventListener('reset', () => setTimeout(() => this.search(), 0));
    }
    async search() {
      const q = this.input.value.trim();
      if (this.reset) this.reset.hidden = !q;
      if (!q || !this.input.hasAttribute('data-predictive-input')) { this.results.hidden = true; this.defaults.hidden = false; return; }
      this.abort && this.abort.abort();
      this.abort = new AbortController();
      try {
        const url = `${routes.predictiveSearch}?q=${encodeURIComponent(q)}&resources[type]=product,collection,query,page,article&resources[limit]=8&resources[options][unavailable_products]=last&section_id=predictive-search`;
        const res = await fetch(url, { signal: this.abort.signal });
        const html = await res.text();
        const doc = parseHTML(html);
        const content = $('[data-predictive-content]', doc);
        this.results.innerHTML = content ? content.innerHTML : '';
        this.results.hidden = false; this.defaults.hidden = true;
      } catch (e) { /* aborted */ }
    }
  }
  customElements.define('search-modal', SearchModal);

  /* ==========================================================================
     Wishlist (saved items, stored locally)
     ========================================================================== */
  const Wishlist = {
    key: 'provenance:saved',
    get() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch (e) { return []; } },
    set(list) { try { localStorage.setItem(this.key, JSON.stringify(list)); } catch (e) { /* storage unavailable */ } this.sync(); },
    has(h) { return this.get().includes(h); },
    toggle(h) {
      const list = this.get(); const i = list.indexOf(h);
      if (i > -1) { list.splice(i, 1); this.set(list); toast(strings.removed); return false; }
      list.unshift(h); this.set(list.slice(0, 100)); toast(strings.saved); return true;
    },
    sync(scope = document) {
      const list = this.get();
      $$('[data-wishlist-toggle]', scope).forEach((b) => b.setAttribute('aria-pressed', list.includes(b.dataset.handle) ? 'true' : 'false'));
      $$('[data-wishlist-count]').forEach((el) => { el.textContent = list.length || ''; el.dataset.count = list.length; });
      document.dispatchEvent(new CustomEvent('wishlist:updated', { detail: { list } }));
    }
  };
  theme.wishlist = Wishlist;

  const fetchCards = async (handles, container) => {
    const cards = await Promise.all(handles.map((h) => fetch(`${root}/products/${encodeURIComponent(h)}?view=card`).then((r) => (r.ok ? r.text() : '')).catch(() => '')));
    container.innerHTML = cards.join('');
    Wishlist.sync(container);
    observeReveal(container);
    return cards.filter(Boolean).length;
  };

  class WishlistGrid extends HTMLElement {
    connectedCallback() {
      if (this._bound) return; this._bound = true;
      this.grid = $('[data-wishlist-grid]', this);
      this.empty = $('[data-wishlist-empty]', this);
      this.countEl = $('[data-wishlist-total]', this);
      this.render();
      document.addEventListener('wishlist:updated', debounce(() => this.render(), 200));
      $('[data-wishlist-clear]', this)?.addEventListener('click', () => { Wishlist.set([]); });
      $('[data-wishlist-share]', this)?.addEventListener('click', () => {
        const url = `${window.location.origin}${window.location.pathname}?saved=${Wishlist.get().join(',')}`;
        copyText(url);
      });
      const shared = new URLSearchParams(window.location.search).get('saved');
      if (shared) { this.shared = shared.split(',').filter(Boolean); this.render(); }
    }
    async render() {
      const list = this.shared || Wishlist.get();
      if (this.countEl) this.countEl.textContent = list.length;
      if (!list.length) { this.grid.innerHTML = ''; this.empty.hidden = false; return; }
      this.empty.hidden = true;
      const sig = list.join('|');
      if (sig === this._sig) return; this._sig = sig;
      this.grid.classList.add('is-loading');
      const n = await fetchCards(list, this.grid);
      this.grid.classList.remove('is-loading');
      if (!n) this.empty.hidden = false;
    }
  }
  customElements.define('wishlist-grid', WishlistGrid);

  /* Recently viewed */
  const Recent = {
    key: 'provenance:recent',
    get() { try { return JSON.parse(localStorage.getItem(this.key)) || []; } catch (e) { return []; } },
    push(h) { const l = this.get().filter((x) => x !== h); l.unshift(h); try { localStorage.setItem(this.key, JSON.stringify(l.slice(0, 16))); } catch (e) { /* ignore */ } }
  };
  class RecentlyViewed extends HTMLElement {
    connectedCallback() {
      if (this._bound) return; this._bound = true;
      const current = this.dataset.current;
      const limit = parseInt(this.dataset.limit, 10) || 8;
      const list = Recent.get().filter((h) => h !== current).slice(0, limit);
      if (!list.length) { this.closest('.shopify-section')?.setAttribute('hidden', ''); return; }
      this.closest('.shopify-section')?.removeAttribute('hidden');
      const track = $('[data-recent-track]', this);
      fetchCards(list, track).then(() => { const s = this.querySelector('slider-component'); s && s.update && s.update(); });
    }
  }
  customElements.define('recently-viewed', RecentlyViewed);

  /* ==========================================================================
     Collection filtering, sorting, density, load more
     ========================================================================== */
  class FacetFilters extends HTMLElement {
    connectedCallback() {
      if (this._bound) return; this._bound = true;
      this.sectionId = this.dataset.sectionId;
      this.bind();
      window.addEventListener('popstate', (e) => { if (e.state && e.state.facets) this.render(window.location.search.slice(1), false); });
      const saved = (() => { try { return localStorage.getItem('provenance:density'); } catch (e) { return null; } })();
      if (saved) this.setDensity(saved);
    }
    bind() {
      this.addEventListener('change', (e) => {
        if (e.target.closest('[data-sort]')) {
          const hidden = $('[data-sort-hidden]', this);
          const form = $('[data-facets-form]', this);
          if (hidden) hidden.value = e.target.value;
          else if (form) { const h = document.createElement('input'); h.type = 'hidden'; h.name = 'sort_by'; h.value = e.target.value; h.setAttribute('data-sort-hidden', ''); form.appendChild(h); }
          this.submit();
          return;
        }
        if (e.target.closest('[data-facets-form]')) this.debouncedSubmit();
      });
      this.debouncedSubmit = debounce(() => this.submit(), 450);
      this.addEventListener('input', (e) => {
        const s = e.target.closest('[data-facet-search]');
        if (!s) return;
        const q = s.value.toLowerCase();
        $$('[data-facet-value]', s.closest('.facet')).forEach((li) => { li.hidden = q && !li.dataset.facetValue.includes(q); });
      });
      this.addEventListener('submit', (e) => { if (e.target.closest('[data-facets-form]')) { e.preventDefault(); this.submit(); } });
      this.addEventListener('click', (e) => {
        const link = e.target.closest('[data-facet-link]');
        if (link) { e.preventDefault(); const u = new URL(link.href, window.location.origin); this.render(u.searchParams.toString()); return; }
        const density = e.target.closest('[data-density]');
        if (density) { this.setDensity(density.dataset.density); try { localStorage.setItem('provenance:density', density.dataset.density); } catch (err) { /* ignore */ } return; }
        if (e.target.closest('[data-open-facets]')) { this.openPanel(); return; }
        if (e.target.closest('[data-close-facets]')) { this.closePanel(); return; }
        const more = e.target.closest('[data-load-more-btn]');
        if (more) { e.preventDefault(); this.loadMore(more.href); }
      });
      this.observeInfinite();
    }
    setDensity(cols) {
      const grid = $('[data-product-grid]', this);
      if (grid) grid.style.setProperty('--grid-cols', cols);
      $$('[data-density]', this).forEach((b) => b.setAttribute('aria-pressed', b.dataset.density === String(cols) ? 'true' : 'false'));
    }
    openPanel() { $('.facets-panel', this)?.classList.add('is-open'); $('.facets-overlay', this)?.classList.add('is-open'); lockScroll(); }
    closePanel() { const p = $('.facets-panel.is-open', this); if (!p) return; p.classList.remove('is-open'); $('.facets-overlay', this)?.classList.remove('is-open'); unlockScroll(); }
    submit() {
      const form = $('[data-facets-form]', this);
      const params = new URLSearchParams(new FormData(form));
      for (const [k, v] of Array.from(params.entries())) { if (v === '') params.delete(k); }
      this.render(params.toString());
    }
    async render(search, push = true) {
      const wrap = $('[data-grid-wrap]', this);
      wrap && wrap.classList.add('is-loading');
      const url = `${window.location.pathname}?${search}${search ? '&' : ''}section_id=${this.sectionId}`;
      try {
        const html = await fetch(url).then((r) => r.text());
        const doc = parseHTML(html);
        const openIds = $$('details.facet', this).filter((d) => d.open).map((d) => d.dataset.facetId);
        ['[data-grid-wrap]', '[data-active-facets]', '[data-facets-body]', '[data-results-count]'].forEach((sel) => {
          const fresh = $(sel, doc); const cur = $(sel, this);
          if (fresh && cur) cur.innerHTML = fresh.innerHTML;
        });
        $$('details.facet', this).forEach((d) => { if (openIds.includes(d.dataset.facetId)) d.open = true; });
        const saved = (() => { try { return localStorage.getItem('provenance:density'); } catch (e) { return null; } })();
        if (saved) this.setDensity(saved);
        Wishlist.sync(this); observeReveal(this); this.observeInfinite();
        if (push) window.history.pushState({ facets: true }, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
        const top = this.getBoundingClientRect().top + window.scrollY - 120;
        if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
      } catch (e) { window.location.search = search; }
      wrap && wrap.classList.remove('is-loading');
    }
    async loadMore(href) {
      const btn = $('[data-load-more-btn]', this);
      if (!href || this._loading) return;
      this._loading = true; btn && btn.classList.add('is-loading');
      const u = new URL(href, window.location.origin); u.searchParams.set('section_id', this.sectionId);
      try {
        const doc = parseHTML(await fetch(u.toString()).then((r) => r.text()));
        const grid = $('[data-product-grid]', this);
        $$('[data-product-grid] > *', doc).forEach((el) => grid.appendChild(el));
        const freshMore = $('[data-load-more]', doc); const curMore = $('[data-load-more]', this);
        if (curMore) { if (freshMore) curMore.replaceWith(freshMore); else curMore.remove(); }
        Wishlist.sync(grid); observeReveal(grid); this.observeInfinite();
      } catch (e) { window.location.href = href; }
      this._loading = false;
    }
    observeInfinite() {
      const el = $('[data-load-more][data-infinite]', this);
      if (!el || !('IntersectionObserver' in window)) return;
      this._io && this._io.disconnect();
      this._io = new IntersectionObserver((entries) => {
        entries.forEach((en) => { if (en.isIntersecting) { const b = $('[data-load-more-btn]', this); b && this.loadMore(b.href); } });
      }, { rootMargin: '600px' });
      this._io.observe(el);
    }
  }
  customElements.define('facet-filters', FacetFilters);

  /* ==========================================================================
     Misc components
     ========================================================================== */
  const copyText = async (text, btn) => {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    toast(`${strings.copied}${text.length < 30 ? ` — ${text}` : ''}`);
    if (btn) { btn.classList.add('is-copied'); setTimeout(() => btn.classList.remove('is-copied'), 2200); }
  };

  class CountdownTimer extends HTMLElement {
    connectedCallback() {
      const raw = (this.dataset.end || '').trim().replace(' ', 'T');
      this.end = Date.parse(raw);
      if (Number.isNaN(this.end)) return;
      this.units = { d: $('[data-d]', this), h: $('[data-h]', this), m: $('[data-m]', this), s: $('[data-s]', this) };
      this.tick(); this.t = setInterval(() => this.tick(), 1000);
    }
    tick() {
      const diff = Math.max(0, this.end - Date.now());
      const d = Math.floor(diff / 864e5), h = Math.floor((diff % 864e5) / 36e5), m = Math.floor((diff % 36e5) / 6e4), s = Math.floor((diff % 6e4) / 1e3);
      const pad = (n) => String(n).padStart(2, '0');
      if (this.units.d) this.units.d.textContent = pad(d);
      if (this.units.h) this.units.h.textContent = pad(h);
      if (this.units.m) this.units.m.textContent = pad(m);
      if (this.units.s) this.units.s.textContent = pad(s);
      if (!diff) {
        clearInterval(this.t);
        const timer = $('[data-countdown-timer]', this); const done = $('[data-countdown-expired]', this);
        if (done) { done.hidden = false; if (timer) timer.hidden = true; }
        if (this.dataset.hideOnEnd === 'true') this.closest('.shopify-section')?.setAttribute('hidden', '');
      }
    }
    disconnectedCallback() { clearInterval(this.t); }
  }
  customElements.define('countdown-timer', CountdownTimer);

  class TabsComponent extends HTMLElement {
    connectedCallback() {
      if (this._bound) return; this._bound = true;
      this.addEventListener('click', (e) => {
        const btn = e.target.closest('[role="tab"]');
        if (!btn || !this.contains(btn)) return;
        $$('[role="tab"]', this).forEach((b) => b.setAttribute('aria-selected', b === btn ? 'true' : 'false'));
        $$('[role="tabpanel"]', this).forEach((p) => {
          const on = p.id === btn.getAttribute('aria-controls');
          p.classList.toggle('is-active', on); p.hidden = !on;
          if (on) { const s = p.querySelector('slider-component'); s && s.update && s.update(); observeReveal(p); }
        });
      });
    }
  }
  customElements.define('tabs-component', TabsComponent);

  class StickyAtc extends HTMLElement {
    connectedCallback() {
      const target = document.getElementById(this.dataset.target);
      if (!target || !('IntersectionObserver' in window)) return;
      new IntersectionObserver(([en]) => {
        const passed = !en.isIntersecting && en.boundingClientRect.top < 0;
        this.classList.toggle('is-visible', passed);
      }).observe(target);
      this.addEventListener('click', (e) => {
        if (e.target.closest('[data-sticky-submit]')) {
          const form = document.getElementById(this.dataset.form);
          if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
        }
      });
    }
  }
  customElements.define('sticky-atc', StickyAtc);

  class SiteVideo extends HTMLElement {
    connectedCallback() {
      this.addEventListener('click', (e) => {
        const cover = e.target.closest('[data-video-play]');
        if (!cover) return;
        const tpl = $('template', this);
        if (!tpl) return;
        const holder = $('[data-video-holder]', this);
        holder.appendChild(tpl.content.cloneNode(true));
        cover.remove();
        const v = $('video', holder); v && v.play && v.play();
      });
    }
  }
  customElements.define('site-video', SiteVideo);

  /* Popup (newsletter / welcome offer) */
  class SitePopup extends OverlayPanel {
    connectedCallback() {
      super.connectedCallback();
      if (this._popupBound) return; this._popupBound = true;
      const key = `provenance:popup:${this.dataset.id}`;
      const days = parseInt(this.dataset.days, 10) || 7;
      let last = 0; try { last = parseInt(localStorage.getItem(key), 10) || 0; } catch (e) { /* ignore */ }
      this.addEventListener('overlay:close', () => { try { localStorage.setItem(key, Date.now()); } catch (e) { /* ignore */ } });
      if (window.Shopify && window.Shopify.designMode) return;
      if (Date.now() - last < days * 864e5) return;
      if (new URLSearchParams(window.location.search).has('customer_posted')) { this.open(); return; }
      setTimeout(() => this.open(), (parseInt(this.dataset.delay, 10) || 8) * 1000);
      if (this.dataset.exit === 'true') document.addEventListener('mouseout', (e) => { if (!e.relatedTarget && e.clientY < 10) this.open(); }, { once: true });
    }
  }
  customElements.define('site-popup', SitePopup);

  /* Typing placeholder for the search hero */
  class TypedText extends HTMLElement {
    connectedCallback() {
      const words = (this.dataset.words || '').split('|').map((w) => w.trim()).filter(Boolean);
      if (!words.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      let w = 0, c = 0, del = false;
      const step = () => {
        const word = words[w];
        this.textContent = word.slice(0, c);
        if (!del && c < word.length) { c++; this.t = setTimeout(step, 70); }
        else if (!del) { del = true; this.t = setTimeout(step, 1600); }
        else if (c > 0) { c--; this.t = setTimeout(step, 35); }
        else { del = false; w = (w + 1) % words.length; this.t = setTimeout(step, 300); }
      };
      step();
    }
    disconnectedCallback() { clearTimeout(this.t); }
  }
  customElements.define('typed-text', TypedText);

  /* ==========================================================================
     Delegated events
     ========================================================================== */
  document.addEventListener('click', async (e) => {
    const opener = e.target.closest('[data-open]');
    if (opener) {
      const el = document.getElementById(opener.dataset.open);
      if (el && el.open) {
        if (opener.dataset.open === 'CartDrawer' && theme.settings.cartType !== 'drawer') return;
        e.preventDefault(); el.open(opener);
        if (opener.dataset.open === 'SearchModal' && opener.dataset.query) { const i = $('input[type="search"]', el); if (i) { i.value = opener.dataset.query; i.dispatchEvent(new Event('input')); } }
        return;
      }
    }

    const wish = e.target.closest('[data-wishlist-toggle]');
    if (wish) { e.preventDefault(); e.stopPropagation(); Wishlist.toggle(wish.dataset.handle); return; }

    const qv = e.target.closest('[data-quick-view]');
    if (qv) {
      e.preventDefault();
      const modal = document.getElementById('QuickView');
      const content = modal && $('[data-quick-view-content]', modal);
      if (!modal || !content) { window.location.href = qv.dataset.quickView; return; }
      content.innerHTML = ''; content.classList.add('is-loading');
      modal.open(qv);
      try {
        const u = new URL(qv.dataset.quickView, window.location.origin); u.searchParams.set('view', 'quick');
        content.innerHTML = await fetch(u.toString()).then((r) => r.text());
        Wishlist.sync(content);
        if (window.Shopify && window.Shopify.PaymentButton) window.Shopify.PaymentButton.init();
      } catch (err) { window.location.href = qv.dataset.quickView; }
      content.classList.remove('is-loading');
      return;
    }

    const copy = e.target.closest('[data-copy]');
    if (copy) { e.preventDefault(); copyText(copy.dataset.copy, copy); return; }

    const share = e.target.closest('[data-share]');
    if (share) {
      e.preventDefault();
      const data = { title: share.dataset.title || document.title, url: share.dataset.url || window.location.href };
      if (navigator.share) navigator.share(data).catch(() => {}); else copyText(data.url);
      return;
    }

    if (e.target.closest('[data-back-to-top]')) { window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });

  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open][role="button"]')) { e.preventDefault(); e.target.click(); }
  });

  document.addEventListener('change', (e) => {
    const auto = e.target.closest('[data-autosubmit]');
    if (auto && auto.form) auto.form.submit();
  });

  /* Back-to-top visibility */
  const btt = $('[data-back-to-top]');
  if (btt) window.addEventListener('scroll', () => btt.classList.toggle('is-visible', window.scrollY > 900), { passive: true });

  /* Parallax banners */
  const parallax = () => {
    $$('[data-parallax] img').forEach((img) => {
      const r = img.parentElement.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      const p = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;
      img.style.transform = `translate3d(0, ${p * -8}%, 0)`;
    });
  };
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) window.addEventListener('scroll', () => requestAnimationFrame(parallax), { passive: true });

  /* Reveal on scroll */
  let revealIO;
  function observeReveal(scope = document) {
    if (!document.body.classList.contains('has-reveal')) return;
    const els = $$('.reveal:not(.is-in)', scope);
    if (!('IntersectionObserver' in window) || (window.Shopify && window.Shopify.designMode)) { els.forEach((el) => el.classList.add('is-in')); return; }
    revealIO = revealIO || new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); revealIO.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    els.forEach((el) => revealIO.observe(el));
  }

  /* Live schedule: highlight today */
  const markToday = (scope = document) => {
    const day = new Date().getDay();
    $$('[data-live-day]', scope).forEach((row) => {
      const days = row.dataset.liveDay.split(',').map((d) => parseInt(d, 10));
      row.classList.toggle('is-today', days.includes(day));
    });
  };

  /* Init */
  const init = (scope = document) => {
    Wishlist.sync(scope);
    observeReveal(scope);
    markToday(scope);
    const handle = $('[data-recent-handle]', scope);
    if (handle) Recent.push(handle.dataset.recentHandle);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init()); else init();

  /* Restore cart when navigating back (bfcache) */
  window.addEventListener('pageshow', (e) => { if (e.persisted) Cart.refresh().catch(() => {}); });

  /* Theme editor support */
  document.addEventListener('shopify:section:load', (e) => init(e.target));
  document.addEventListener('shopify:section:select', (e) => {
    const popup = $('site-popup', e.target); if (popup) popup.open();
    const cart = $('cart-drawer', e.target); if (cart) cart.open();
  });
  document.addEventListener('shopify:section:deselect', (e) => { const popup = $('site-popup', e.target); if (popup) popup.close(); });
  document.addEventListener('shopify:block:select', (e) => {
    const show = e.target.closest('slide-show');
    if (show) { show.pause(); show.go(parseInt(e.target.dataset.index, 10) || 0); }
    const bar = e.target.closest('announcement-bar');
    if (bar && bar.go) { clearInterval(bar.t); bar.go(parseInt(e.target.dataset.index, 10) || 0); }
    const slider = e.target.closest('[data-slider]');
    if (slider) slider.scrollTo({ left: e.target.offsetLeft - slider.offsetLeft, behavior: 'smooth' });
  });
  document.addEventListener('shopify:block:deselect', (e) => { const show = e.target.closest('slide-show'); if (show) show.play(); });
})();
