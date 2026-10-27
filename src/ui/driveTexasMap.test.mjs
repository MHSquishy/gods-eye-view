import test from 'node:test';
import assert from 'node:assert/strict';
import { railFixture } from './railTestFixture.mjs';
import {
  CEDAR_CREEK_DRIVE_TEXAS_URL,
  mountDriveTexasMapRow,
} from './driveTexasMap.js';
import { mountWazeLiveMapRow } from './wazeLiveMap.js';

test('DriveTexas opens official conditions around 75163 independently of Waze', () => {
  const f = railFixture();
  const navigated = [];
  const popups = [];
  let nextTimerId = 0;
  const clearedTimers = [];
  const windowRef = {
    open(url, target) {
      assert.equal(url, 'about:blank');
      assert.equal(target, '_blank');
      const popup = {
        opener: windowRef,
        closed: false,
        location: {
          replace(next) {
            assert.equal(popup.opener, null);
            navigated.push(next);
          },
        },
        focus() {},
        close() {
          this.closed = true;
        },
      };
      popups.push(popup);
      return popup;
    },
    setInterval() {
      return ++nextTimerId;
    },
    clearInterval(id) {
      clearedTimers.push(id);
    },
  };
  const cleanupWaze = mountWazeLiveMapRow(f.container, windowRef);
  const cleanupDriveTexas = mountDriveTexasMapRow(f.container, windowRef);
  const wazeRow = f.find(
    (node) => node.dataset.externalView === 'waze-cedar-creek',
  );
  const driveRow = f.find(
    (node) => node.dataset.externalView === 'drivetexas-cedar-creek',
  );
  const wazeToggle = wazeRow.querySelector('.data-toggle-btn');
  const driveToggle = driveRow.querySelector('.data-toggle-btn');

  assert.deepEqual(f.container.children, [wazeRow, driveRow]);
  assert.match(
    driveRow.querySelector('.data-toggle-meta').textContent,
    /no exact 50-mile filter/,
  );
  assert.equal(driveToggle.getAttribute('aria-pressed'), 'false');
  driveToggle.click();
  assert.deepEqual(navigated, [CEDAR_CREEK_DRIVE_TEXAS_URL]);
  assert.equal(driveToggle.getAttribute('aria-pressed'), 'true');
  wazeToggle.click();
  assert.equal(wazeToggle.getAttribute('aria-pressed'), 'true');
  driveToggle.click();
  assert.equal(popups[0].closed, true);
  assert.equal(driveToggle.getAttribute('aria-pressed'), 'false');
  assert.equal(wazeToggle.getAttribute('aria-pressed'), 'true');

  popups[1].close();
  cleanupWaze();
  cleanupDriveTexas();
  assert.deepEqual(clearedTimers, [1, 2]);
  const mapUrl = new URL(CEDAR_CREEK_DRIVE_TEXAS_URL);
  assert.equal(mapUrl.hostname, 'drivetexas.org');
  assert.equal(mapUrl.searchParams.get('ll'), '-96.0976,32.1562');
  assert.equal(mapUrl.searchParams.get('z'), '9');
});
