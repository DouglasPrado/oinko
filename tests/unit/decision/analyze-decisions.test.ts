import { describe, it, expect } from 'vitest';
import {
  parseJsonl,
  percentile,
  summarize,
  savings,
  classify,
  calibration,
  expectedCalibrationError,
  agreement,
  formatReport,
  type AnalysedRecord,
  type Label,
} from '../../../scripts/analyze-decisions.js';

function record(over: Partial<AnalysedRecord> = {}): AnalysedRecord {
  return {
    id: over.id ?? 'id-1',
    point: over.point ?? 'memory_extraction',
    answers: over.answers ?? { durable: { value: true, confidence: 0.9 } },
    durationMs: over.durationMs ?? 100,
    ...over,
  };
}

describe('parseJsonl', () => {
  it('reads one object per line and skips malformed ones', () => {
    const rows = parseJsonl<{ id: string }>('{"id":"a"}\nnot json\n\n{"id":"b"}\n');
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('percentile', () => {
  it('returns 0 for no samples', () => {
    expect(percentile([], 95)).toBe(0);
  });

  it('picks the requested percentile', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(51);
    expect(percentile(values, 95)).toBe(96);
  });
});

describe('summarize', () => {
  it('groups by decision point with latency and verdict mix', () => {
    const rows = [
      record({ id: '1', durationMs: 100 }),
      record({ id: '2', durationMs: 300, answers: { durable: { value: false, confidence: 0.8 } } }),
      record({
        id: '3',
        point: 'knowledge_gate',
        answers: { needsKnowledge: { value: true, confidence: 0.7 } },
      }),
    ];

    const [first, second] = summarize(rows);

    expect(first!.point).toBe('memory_extraction');
    expect(first!.decisions).toBe(2);
    expect(first!.verdicts).toEqual({ true: 1, false: 1 });
    expect(first!.avgConfidence).toBeCloseTo(0.85);
    expect(second!.point).toBe('knowledge_gate');
  });

  it('counts errored decisions', () => {
    const rows = [record({ id: '1' }), record({ id: '2', answers: {}, error: 'network down' })];
    expect(summarize(rows)[0]!.errors).toBe(1);
  });

  it('buckets numeric verdicts as score', () => {
    const rows = [
      record({ point: 'knowledge_rerank', answers: { c0: { value: 2.5, confidence: 0.9 } } }),
    ];
    expect(summarize(rows)[0]!.verdicts).toEqual({ score: 1 });
  });
});

describe('savings', () => {
  it('counts extraction calls avoided by a negative verdict', () => {
    const rows = [
      record({ id: '1', answers: { durable: { value: false, confidence: 0.9 } } }),
      record({ id: '2', answers: { durable: { value: false, confidence: 0.9 } } }),
      record({ id: '3', answers: { durable: { value: true, confidence: 0.9 } } }),
    ];

    const result = savings(rows).find((s) => s.point === 'memory_extraction');
    expect(result!.avoided).toBe(2);
  });

  it('counts searches skipped, retries not spent and cheap turns', () => {
    const rows = [
      record({
        id: '1',
        point: 'knowledge_gate',
        answers: { needsKnowledge: { value: false, confidence: 0.9 } },
      }),
      record({
        id: '2',
        point: 'tool_error',
        answers: { kind: { value: 'permanent', confidence: 0.9 } },
      }),
      record({
        id: '3',
        point: 'tool_error',
        answers: { kind: { value: 'transient', confidence: 0.9 } },
      }),
      record({
        id: '4',
        point: 'model_routing',
        answers: { tier: { value: 'fast', confidence: 0.9 } },
      }),
    ];

    const byPoint = Object.fromEntries(savings(rows).map((s) => [s.point, s.avoided]));
    expect(byPoint.knowledge_gate).toBe(1);
    expect(byPoint.tool_error).toBe(1);
    expect(byPoint.model_routing).toBe(1);
  });

  it('counts every relevance call as one LLM call replaced', () => {
    const rows = [
      record({
        id: '1',
        point: 'memory_relevance',
        answers: { m0: { value: true, confidence: 0.9 } },
      }),
      record({
        id: '2',
        point: 'memory_relevance',
        answers: { m0: { value: false, confidence: 0.9 } },
      }),
    ];

    expect(savings(rows).find((s) => s.point === 'memory_relevance')!.avoided).toBe(2);
  });
});

describe('classify', () => {
  it('scores verdicts against labels', () => {
    const rows = [
      record({ id: '1', answers: { durable: { value: true, confidence: 0.9 } } }),
      record({ id: '2', answers: { durable: { value: false, confidence: 0.9 } } }),
    ];
    const labels: Label[] = [
      { id: '1', outcome: true },
      { id: '2', outcome: true },
    ];

    const [result] = classify(rows, labels);
    expect(result!.labelled).toBe(2);
    expect(result!.correct).toBe(1);
    expect(result!.accuracy).toBe(0.5);
  });

  it('ignores records with no label', () => {
    const rows = [record({ id: '1' }), record({ id: 'unlabelled' })];
    expect(classify(rows, [{ id: '1', outcome: true }])[0]!.labelled).toBe(1);
  });
});

describe('calibration', () => {
  it('compares stated confidence with observed accuracy per bucket', () => {
    const rows = [
      record({ id: '1', answers: { durable: { value: true, confidence: 0.95 } } }),
      record({ id: '2', answers: { durable: { value: true, confidence: 0.95 } } }),
      record({ id: '3', answers: { durable: { value: true, confidence: 0.65 } } }),
    ];
    const labels: Label[] = [
      { id: '1', outcome: true },
      { id: '2', outcome: true },
      { id: '3', outcome: false },
    ];

    const buckets = calibration(rows, labels);
    const high = buckets.find((b) => b.range === '0.9-1.0');
    const mid = buckets.find((b) => b.range === '0.6-0.7');

    expect(high!.observedAccuracy).toBe(1);
    expect(mid!.observedAccuracy).toBe(0);
  });

  it('reports a perfect score as zero calibration error', () => {
    const buckets = [
      { range: '0.9-1.0', n: 10, meanConfidence: 0.9, observedAccuracy: 0.9 },
      { range: '0.7-0.8', n: 10, meanConfidence: 0.7, observedAccuracy: 0.7 },
    ];
    expect(expectedCalibrationError(buckets)).toBe(0);
  });

  it('weights the error by bucket size', () => {
    const buckets = [
      { range: '0.9-1.0', n: 90, meanConfidence: 0.9, observedAccuracy: 0.9 },
      { range: '0.5-0.6', n: 10, meanConfidence: 0.5, observedAccuracy: 0.0 },
    ];
    expect(expectedCalibrationError(buckets)).toBeCloseTo(0.05);
  });
});

describe('agreement', () => {
  it('counts how often the challenger matched the primary', () => {
    const rows = [
      record({ id: '1', agreed: true }),
      record({ id: '2', agreed: false }),
      record({ id: '3', agreed: true }),
      record({ id: '4' }),
    ];

    const [result] = agreement(rows);
    expect(result!.compared).toBe(3);
    expect(result!.agreed).toBe(2);
  });
});

describe('formatReport', () => {
  it('says plainly when there are no labels', () => {
    const report = formatReport([record()], []);
    expect(report).toContain('No labels supplied');
    expect(report).toContain('memory_extraction');
  });

  it('includes accuracy and calibration once labels exist', () => {
    const report = formatReport([record({ id: '1' })], [{ id: '1', outcome: true }]);
    expect(report).toContain('Accuracy against labels');
    expect(report).toContain('Calibration');
    expect(report).toContain('expected calibration error');
  });
});
