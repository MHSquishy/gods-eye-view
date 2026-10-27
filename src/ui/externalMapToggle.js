import { msg, t } from '../i18n/index.js';

const openWindows = new Map();

/** Mount a Movement row for an official map that opens in its own tab. */
export function mountExternalMapToggle(
  container,
  { id, icon, label, url, meta: defaultMeta, closeMeta, blockedMeta },
  windowRef = container.ownerDocument.defaultView || globalThis,
) {
  const doc = container.ownerDocument;
  const row = doc.createElement('div');
  row.className = 'data-toggle-row';
  row.dataset.externalView = id;

  const top = doc.createElement('div');
  top.className = 'data-toggle-top';
  const left = doc.createElement('div');
  left.className = 'data-toggle-left';
  const iconElement = doc.createElement('span');
  iconElement.className = 'data-icon';
  iconElement.setAttribute('aria-hidden', 'true');
  iconElement.textContent = icon;
  const name = doc.createElement('span');
  name.className = 'data-name';
  name.textContent = label;
  left.append(iconElement, name);

  const right = doc.createElement('div');
  right.className = 'data-toggle-right';
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'data-toggle-btn';
  right.appendChild(toggle);
  top.append(left, right);

  const detail = doc.createElement('div');
  detail.className = 'data-toggle-meta';
  detail.textContent = defaultMeta;
  row.append(top, detail);
  container.appendChild(row);

  const isOpen = () => {
    const opened = openWindows.get(id);
    return Boolean(opened && !opened.closed);
  };
  const sync = () => {
    if (openWindows.get(id)?.closed) {
      openWindows.delete(id);
      detail.textContent = defaultMeta;
    }
    const open = isOpen();
    toggle.classList.toggle('active', open);
    toggle.setAttribute('aria-pressed', String(open));
    toggle.setAttribute(
      'aria-label',
      `${label}: ${t(open ? msg('ON') : msg('OFF'))}`,
    );
    toggle.textContent = t(open ? msg('ON') : msg('OFF'));
  };
  const onToggle = () => {
    if (isOpen()) {
      const opened = openWindows.get(id);
      opened.close();
      if (opened.closed) openWindows.delete(id);
      sync();
      detail.textContent = isOpen() ? closeMeta : defaultMeta;
      return;
    }
    // Keep a script-opened tab handle for the OFF switch. Sever the opener
    // before loading the external site so it cannot reach this application.
    const opened = windowRef.open?.('about:blank', '_blank');
    if (!opened) {
      detail.textContent = blockedMeta;
      return;
    }
    opened.opener = null;
    opened.location.replace(url);
    openWindows.set(id, opened);
    opened.focus?.();
    detail.textContent = defaultMeta;
    sync();
  };
  toggle.addEventListener('click', onToggle);
  const watch = windowRef.open ? windowRef.setInterval(sync, 2000) : null;
  sync();
  return () => {
    toggle.removeEventListener('click', onToggle);
    if (watch !== null) windowRef.clearInterval(watch);
  };
}
