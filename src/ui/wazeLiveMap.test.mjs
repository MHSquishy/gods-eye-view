import test from 'node:test';
import assert from 'node:assert/strict';
import { railFixture } from './railTestFixture.mjs';
import { CEDAR_CREEK_WAZE_URL, mountWazeLiveMapRow } from './wazeLiveMap.js';

test('Waze companion toggle opens a separate map and closes it again', () => {
  const f = railFixture();
  let poll;
  let cleared = false;
  let popup;
  const windowRef = {
    open(url, target) {
      assert.equal(url, 'about:blank');
      assert.equal(target, '_blank');
      popup = {
        opener: windowRef,
        closed: false,
        location: {
          replace(next) {
            assert.equal(
              popup.opener,
              null,
              'Waze cannot reach the app opener',
            );
            assert.equal(next, CEDAR_CREEK_WAZE_URL);
          },
        },
        focus() {},
        close() {
          this.closed = true;
        },
      };
      return popup;
    },
    setInterval(callback) {
      poll = callback;
      return 1;
    },
    clearInterval(id) {
      assert.equal(id, 1);
      cleared = true;
    },
  };
  const cleanup = mountWazeLiveMapRow(f.container, windowRef);
  const row = f.find(
    (node) => node.dataset.externalView === 'waze-cedar-creek',
  );
  const toggle = row.querySelector('.data-toggle-btn');

  assert.match(CEDAR_CREEK_WAZE_URL, /lat=32\.1562&lon=-96\.0976/);
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  toggle.click();
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  toggle.click();
  assert.equal(popup.closed, true);
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');

  toggle.click();
  popup.closed = true;
  poll();
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  cleanup();
  assert.equal(cleared, true);
});

test('Waze toggle stays on when the browser does not close its tab', () => {
  const f = railFixture();
  const popup = {
    closed: false,
    location: { replace() {} },
    close() {},
  };
  let poll;
  const windowRef = {
    open: () => popup,
    setInterval(callback) {
      poll = callback;
      return 1;
    },
    clearInterval() {},
  };
  mountWazeLiveMapRow(f.container, windowRef);
  const row = f.find(
    (node) => node.dataset.externalView === 'waze-cedar-creek',
  );
  const toggle = row.querySelector('.data-toggle-btn');
  const meta = row.querySelector('.data-toggle-meta');

  toggle.click();
  toggle.click();
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  assert.match(meta.textContent, /Close the Waze tab/);
  popup.closed = true;
  poll();
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.match(meta.textContent, /ZIP 75163/);
});

test('a blocked pop-up leaves the map and toggle in place', () => {
  const f = railFixture();
  const windowRef = {
    open: () => null,
    setInterval: () => 1,
    clearInterval() {},
    location: {
      assign() {
        assert.fail('GEV should not be replaced by Waze');
      },
    },
  };
  mountWazeLiveMapRow(f.container, windowRef);
  const row = f.find(
    (node) => node.dataset.externalView === 'waze-cedar-creek',
  );
  row.querySelector('.data-toggle-btn').click();
  assert.equal(
    row.querySelector('.data-toggle-btn').getAttribute('aria-pressed'),
    'false',
  );
  assert.match(
    row.querySelector('.data-toggle-meta').textContent,
    /Allow pop-ups/,
  );
});
