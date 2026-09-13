import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hydrate } from '../js/storage.js';

test('activity return context and resumable snapshots survive valid state hydration only', () => {
  const state = hydrate({
    version: 1,
    activityContext: {
      returnContext: {
        sourceRoute: '#activity/essay?word=3-x',
        sourceActivity: 'essay',
        sourceLabel: '作文',
        helperType: 'vocabulary',
        helperLabel: '查词',
        timestamp: 42,
      },
      snapshots: {
        '#activity/essay?word=3-x': {
          activityId: 'essay', activityName: '作文', queueIds: ['3-x'], round: 1,
          step: 0, sessionSuccess: 2, remaining: 12, scrollPosition: 640,
        },
        'not-an-activity-route': { activityId: 'essay' },
      },
    },
  });
  assert.equal(state.activityContext.returnContext.sourceRoute, '#activity/essay?word=3-x');
  assert.equal(state.activityContext.snapshots['#activity/essay?word=3-x'].scrollPosition, 640);
  assert.equal(state.activityContext.snapshots['not-an-activity-route'], undefined);
});

test('malformed activity context is discarded without affecting normal state recovery', () => {
  const state = hydrate({
    version: 1,
    activityContext: { returnContext: { sourceRoute: '#home', timestamp: 'never' }, snapshots: { '#activity/essay': null } },
  });
  assert.equal(state.activityContext.returnContext, null);
  assert.deepEqual(state.activityContext.snapshots, {});
});
