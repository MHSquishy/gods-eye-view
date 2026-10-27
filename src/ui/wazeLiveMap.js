import { msg, t } from '../i18n/index.js';
import { mountExternalMapToggle } from './externalMapToggle.js';

// ZIP 75163 (Trinidad, Texas). Zoom 10 gives a useful regional view around
// Cedar Creek Lake on a desktop. Waze does not expose a radius filter in its
// public Live Map; the visible extent still depends on the browser window.
export const CEDAR_CREEK_WAZE_URL =
  'https://embed.waze.com/iframe?zoom=10&lat=32.1562&lon=-96.0976';

/** Open Waze's public Live Map in a separate browser tab from Movement. */
export function mountWazeLiveMapRow(container, windowRef) {
  return mountExternalMapToggle(
    container,
    {
      id: 'waze-cedar-creek',
      icon: '⚠',
      label: t(msg('Waze Live Map')),
      url: CEDAR_CREEK_WAZE_URL,
      meta: t(
        msg('Cedar Creek Lake · ZIP 75163 · opens Waze in a separate tab'),
      ),
      closeMeta: t(msg('Close the Waze tab to turn this off')),
      blockedMeta: t(msg('Allow pop-ups to open Waze Live Map')),
    },
    windowRef,
  );
}
