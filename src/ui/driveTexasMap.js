import { msg, t } from '../i18n/index.js';
import { mountExternalMapToggle } from './externalMapToggle.js';

// DriveTexas share URLs use longitude,latitude and a zoom level. This view
// covers Cedar Creek Lake and nearby roads, but the site has no exact-mile
// radius filter. The map's visible extent depends on the browser window.
export const CEDAR_CREEK_DRIVE_TEXAS_URL =
  'https://drivetexas.org/?ll=-96.0976,32.1562&z=9';

/** Open TxDOT's current road-conditions map in a separate Movement tab. */
export function mountDriveTexasMapRow(container, windowRef) {
  return mountExternalMapToggle(
    container,
    {
      id: 'drivetexas-cedar-creek',
      icon: '🚧',
      label: t(msg('DriveTexas Alerts')),
      url: CEDAR_CREEK_DRIVE_TEXAS_URL,
      meta: t(msg('ZIP 75163 · regional alerts · no exact 50-mile filter')),
      closeMeta: t(msg('Close the DriveTexas tab to turn this off')),
      blockedMeta: t(msg('Allow pop-ups to open DriveTexas')),
    },
    windowRef,
  );
}
