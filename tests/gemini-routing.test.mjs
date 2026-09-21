import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTeacherHandler } from '../server/ai-handler.js';
import {
  DEFAULT_ADVANCED_MODEL,
  DEFAULT_FAST_MODEL,
  OUTPUT_TOKEN_CAPS,
  generateTeachingResult,
  selectGeminiModel,
} from '../server/gemini.js';
import { TUTOR_ACTION as A } from '../js/tutor-actions.js';
import { inputFor, resultFor } from './tutor-fixtures.mjs';

const env = { GEMINI_API_KEY: 'test-server-secret-never-public' };

test('installed SDK receives the server-selected model and request shape for every action', async (t) => {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const request = url instanceof Request ? url : new Request(url, options);
    const payload = await request.json();
    sent.push(payload);
    return Response.json({
      id: 'mock',
      status: 'completed',
      output_text: JSON.stringify(resultFor(A.SENTENCE_HINT)),
      steps: [],
    });
  });
  for (const action of Object.values(A)) {
    const input = inputFor(action);
    const raw = await generateTeachingResult(
      { ...input, vocabularyCandidates: [] },
      {
        apiKey: env.GEMINI_API_KEY,
        model: selectGeminiModel(action).model,
        signal: new AbortController().signal,
      },
    );
    assert.deepEqual(JSON.parse(raw), resultFor(A.SENTENCE_HINT));
  }
  assert.equal(sent.length, Object.values(A).length);
  for (const [index, action] of Object.values(A).entries()) {
    const request = sent[index];
    const advanced = [A.PARAGRAPH_REVIEW, A.ESSAY_REVIEW].includes(action);
    assert.equal(request.model, advanced ? DEFAULT_ADVANCED_MODEL : DEFAULT_FAST_MODEL);
    assert.deepEqual(request.generation_config, {
      max_output_tokens: OUTPUT_TOKEN_CAPS[action],
      ...(advanced ? { thinking_level: 'minimal' } : {}),
    });
    if (action === A.PARAGRAPH_REVIEW) assert.equal(request.generation_config.max_output_tokens, 1200);
    if (action === A.ESSAY_REVIEW) assert.equal(request.generation_config.max_output_tokens, 1800);
    for (const field of advanced
      ? ['thinking_budget', 'thinking_config']
      : ['thinking_budget', 'thinking_config', 'thinking_level'])
      assert.ok(!Object.hasOwn(request.generation_config, field));
  }
});

test('upstream error categories are logged from bounded metadata without response-body leakage', async () => {
  for (const [statusCode, upstreamCode, category] of [
    [400, 'INVALID_ARGUMENT', 'invalid_request'],
    [403, 'PERMISSION_DENIED', 'permission_denied'],
    [404, 'NOT_FOUND', 'not_found'],
    [429, 'RESOURCE_EXHAUSTED', 'rate_limited'],
    [500, 'INTERNAL', 'unavailable'],
    [503, 'UNAVAILABLE', 'unavailable'],
  ]) {
    const warnings = [];
    const handler = createTeacherHandler({
      env,
      logger: { info() {}, warn: (...args) => warnings.push(args) },
      generate: async () => {
        throw {
          statusCode,
          error: { status: upstreamCode, message: `private response ${env.GEMINI_API_KEY}` },
        };
      },
    });
    const response = await handler(
      new Request('http://localhost/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputFor(A.SENTENCE_CHECK)),
      }),
    );
    const body = await response.json();
    assert.equal(response.status, statusCode === 429 ? 429 : 503);
    assert.equal(body.error.code, statusCode === 429 ? 'AI_RATE_LIMIT' : 'AI_UNAVAILABLE');
    const diagnostic = warnings[0][1];
    assert.equal(diagnostic.action, A.SENTENCE_CHECK);
    assert.equal(diagnostic.routeClass, 'fast');
    assert.equal(diagnostic.model, DEFAULT_FAST_MODEL);
    assert.equal(typeof diagnostic.durationMs, 'number');
    assert.equal(diagnostic.status, category);
    assert.equal(diagnostic.upstreamStatus, statusCode);
    assert.equal(diagnostic.upstreamCode, upstreamCode);
    assert.ok(!JSON.stringify(warnings).includes(env.GEMINI_API_KEY));
  }
});
