/**
 * Tests for the AI Coach structured output parser (v0.3.4).
 * Verifies the model's JSON reply is parsed into typed cards, with graceful
 * fallbacks for the messy replies small local models sometimes produce.
 */
import { describe, it, expect } from 'vitest';
import { parseAiAnalysis } from '../aiAnalysis';

describe('parseAiAnalysis', () => {
  it('parses a well-formed analysis', () => {
    const raw = JSON.stringify({
      summary: 'You are making solid progress.',
      top_priorities: [
        { title: 'Protect your sleep', why: 'Energy is slipping', action: 'Set a 10pm wind-down' },
      ],
      trends: [{ title: 'Reading', detail: 'Up 40% this month' }],
      risks: [{ title: 'Exercise', detail: 'Missed 5 days', action: 'Do a 10-min walk' }],
      next_step: 'Do one 10-min walk today',
    });
    const parsed = parseAiAnalysis(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.summary).toContain('solid progress');
    expect(parsed!.top_priorities).toHaveLength(1);
    expect(parsed!.top_priorities![0].action).toContain('wind-down');
    expect(parsed!.trends).toHaveLength(1);
    expect(parsed!.risks).toHaveLength(1);
    expect(parsed!.risks![0].action).toContain('walk');
    expect(parsed!.next_step).toContain('10-min walk');
  });

  it('strips markdown code fences from the reply', () => {
    const inner = JSON.stringify({ summary: 'Hello', next_step: 'Do it' });
    const parsed = parseAiAnalysis('```json\n' + inner + '\n```');
    expect(parsed).not.toBeNull();
    expect(parsed!.summary).toBe('Hello');
    expect(parsed!.next_step).toBe('Do it');
  });

  it('handles a partial reply with only some fields', () => {
    const parsed = parseAiAnalysis(JSON.stringify({ summary: 'Just a summary' }));
    expect(parsed).not.toBeNull();
    expect(parsed!.summary).toBe('Just a summary');
    expect(parsed!.top_priorities).toEqual([]);
  });

  it('returns null for non-JSON text', () => {
    expect(parseAiAnalysis('I do not speak JSON')).toBeNull();
  });

  it('returns null for JSON that is not an object', () => {
    expect(parseAiAnalysis('42')).toBeNull();
    expect(parseAiAnalysis('[]')).toBeNull();
  });

  it('returns null for an empty or null reply', () => {
    expect(parseAiAnalysis('')).toBeNull();
    expect(parseAiAnalysis('null')).toBeNull();
  });

  it('filters out malformed items in arrays', () => {
    const raw = JSON.stringify({
      summary: 'Ok',
      top_priorities: [{ title: 'Good' }, 'junk', 42, null],
    });
    const parsed = parseAiAnalysis(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.top_priorities).toHaveLength(1);
    expect(parsed!.top_priorities![0].title).toBe('Good');
  });
});
