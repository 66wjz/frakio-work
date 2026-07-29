import test from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateProviderBaseUrls,
  normalizeProviderBaseUrl,
  providerInferenceUrl,
  shouldOfferV1Candidate,
} from './provider-adapters.mjs';

test('OpenAI-compatible roots safely offer a v1 candidate', () => {
  assert.deepEqual(candidateProviderBaseUrls('https://api.shuaiapi.com/', 'chat_completions'), [
    'https://api.shuaiapi.com',
    'https://api.shuaiapi.com/v1',
  ]);
  assert.equal(providerInferenceUrl({ baseUrl: 'https://api.shuaiapi.com/v1', apiMode: 'codex_responses' }), 'https://api.shuaiapi.com/v1/responses');
  assert.equal(providerInferenceUrl({ baseUrl: 'https://api.shuaiapi.com/v1', apiMode: 'chat_completions' }), 'https://api.shuaiapi.com/v1/chat/completions');
});

test('complete endpoints are reduced to a visible runtime root', () => {
  assert.equal(normalizeProviderBaseUrl('https://relay.example/v1/chat/completions'), 'https://relay.example/v1');
  assert.equal(normalizeProviderBaseUrl('https://relay.example/v1/responses'), 'https://relay.example/v1');
  assert.equal(normalizeProviderBaseUrl('https://relay.example/custom/models'), 'https://relay.example/custom');
});

test('existing versions and Azure deployment paths never receive another v1', () => {
  assert.deepEqual(candidateProviderBaseUrls('https://relay.example/v1beta', 'chat_completions'), ['https://relay.example/v1beta']);
  assert.equal(shouldOfferV1Candidate('https://example.openai.azure.com/openai/deployments/main', 'chat_completions'), false);
  assert.equal(providerInferenceUrl({
    baseUrl: 'https://example.openai.azure.com/openai/deployments/main',
    apiMode: 'chat_completions',
  }), 'https://example.openai.azure.com/openai/deployments/main/chat/completions');
});

test('Anthropic roots produce exactly one v1 messages suffix', () => {
  assert.equal(normalizeProviderBaseUrl('https://api.anthropic.com/v1', 'anthropic_messages'), 'https://api.anthropic.com');
  assert.equal(providerInferenceUrl({ baseUrl: 'https://api.anthropic.com', apiMode: 'anthropic_messages' }), 'https://api.anthropic.com/v1/messages');
  assert.equal(providerInferenceUrl({ baseUrl: 'https://relay.example/anthropic/v1', apiMode: 'anthropic_messages' }), 'https://relay.example/anthropic/v1/messages');
  assert.deepEqual(candidateProviderBaseUrls('https://relay.example/anthropic', 'anthropic_messages'), ['https://relay.example/anthropic']);
});
