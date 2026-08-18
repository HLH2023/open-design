import { describe, expect, it } from 'vitest';
import {
  apiTokenAuthorizationMatches,
  apiTokenAuthorizationMatchesAny,
} from '../src/api-token-auth.js';

describe('API token credential separation', () => {
  it('accepts either the agent token or the web proxy token', () => {
    expect(apiTokenAuthorizationMatchesAny('Bearer agent-token', ['agent-token', 'web-token'])).toBe(true);
    expect(apiTokenAuthorizationMatchesAny('Bearer web-token', ['agent-token', 'web-token'])).toBe(true);
  });

  it('rejects empty, unknown, and malformed credentials', () => {
    expect(apiTokenAuthorizationMatchesAny(undefined, ['agent-token', 'web-token'])).toBe(false);
    expect(apiTokenAuthorizationMatchesAny('Bearer unknown', ['agent-token', 'web-token'])).toBe(false);
    expect(apiTokenAuthorizationMatchesAny('Basic bad', ['agent-token', 'web-token'])).toBe(false);
  });

  it('keeps the existing single-token matcher behavior', () => {
    expect(apiTokenAuthorizationMatches('Bearer agent-token', 'agent-token')).toBe(true);
    expect(apiTokenAuthorizationMatches('Bearer web-token', 'agent-token')).toBe(false);
  });
});
