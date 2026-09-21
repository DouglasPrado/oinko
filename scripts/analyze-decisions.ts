/**
 * Reads a decision log (JSONL written by RecordingDecider / ShadowDecider)
 * and reports what it says about the engine behind it.
 *
 * Usage:
 *   node scripts/analyze-decisions.ts decisions.jsonl [--labels labels.jsonl]
 *
 * The labels file is JSONL of `{ "id": "<record id>", "outcome": <value> }`,
 * where outcome is the verdict the decision *should* have had. Without it the
 * report still covers volume, latency, verdict mix and avoided work — only
 * accuracy and calibration need ground truth.
 */

import { readFile } from 'node:fs/promises';
import { argv } from 'node:process';
import { pathToFileURL } from 'node:url';

export interface AnalysedRecord {
  id: string;
  point: string;
  answers: Record<string, { value: string | number | boolean; confidence: number }>;
  durationMs: number;
  error?: string;
  // Shadow records carry these instead.
  primary?: Record<string, { value: string | number | boolean; confidence: number }>;
  shadow?: Record<string, { value: string | number | boolean; confidence: number }>;
  agreed?: boolean;
  primaryMs?: number;
  shadowMs?: number;
}

export interface Label {
  id: string;
  outcome: string | number | boolean;
  /** Which question to judge; defaults to the record's single answer. */
  key?: string;
}

export function parseJsonl<T>(text: string): T[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as T];
      } catch {
        return [];
      }
    });
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index]!;
}

/** The single verdict of a record, for points that ask one question. */
export function singleVerdict(
  record: AnalysedRecord,
  key?: string,
): { value: string | number | boolean; confidence: number } | undefined {
  const answers = record.answers ?? record.primary ?? {};
  const entries = Object.entries(answers);
  if (entries.length === 0) return undefined;
  if (key) return answers[key];
  return entries.length === 1 ? entries[0]![1] : undefined;
}

export interface PointSummary {
  point: string;
  decisions: number;
  errors: number;
  p50Ms: number;
  p95Ms: number;
  avgConfidence: number;
  verdicts: Record<string, number>;
}

export function summarize(records: AnalysedRecord[]): PointSummary[] {
  const byPoint = new Map<string, AnalysedRecord[]>();
  for (const record of records) {
    const list = byPoint.get(record.point) ?? [];
    list.push(record);
    byPoint.set(record.point, list);
  }

  return [...byPoint.entries()]
    .map(([point, rows]) => {
      const durations = rows.map((r) => r.durationMs ?? r.primaryMs ?? 0);
      const verdicts: Record<string, number> = {};
      let confidenceSum = 0;
      let confidenceCount = 0;

      for (const row of rows) {
        const answers = row.answers ?? row.primary ?? {};
        for (const answer of Object.values(answers)) {
          const bucket = typeof answer.value === 'number' ? 'score' : String(answer.value);
          verdicts[bucket] = (verdicts[bucket] ?? 0) + 1;
          confidenceSum += answer.confidence;
          confidenceCount++;
        }
      }

      return {
        point,
        decisions: rows.length,
        errors: rows.filter((r) => r.error !== undefined).length,
        p50Ms: percentile(durations, 50),
        p95Ms: percentile(durations, 95),
        avgConfidence: confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
        verdicts,
      };
    })
    .sort((a, b) => b.decisions - a.decisions);
}

/**
 * Expensive work the decision avoided, per point.
 *
 * This is the number that answers "did it pay for itself" — each avoided item
 * is an LLM call, an embedding round trip or a retry that did not happen.
 */
export function savings(
  records: AnalysedRecord[],
): { point: string; avoided: number; what: string }[] {
  const avoided = new Map<string, { count: number; what: string }>();

  const bump = (point: string, what: string) => {
    const current = avoided.get(point) ?? { count: 0, what };
    current.count++;
    avoided.set(point, current);
  };

  for (const record of records) {
    const verdict = singleVerdict(record);
    if (!verdict) continue;

    switch (record.point) {
      case 'memory_extraction':
        if (verdict.value === false) bump(record.point, 'LLM extraction calls not made');
        break;
      case 'knowledge_gate':
        if (verdict.value === false) bump(record.point, 'embedding + vector searches skipped');
        break;
      case 'tool_error':
        if (verdict.value !== 'transient') bump(record.point, 'retry rounds not spent');
        break;
      case 'model_routing':
        if (verdict.value === 'fast') bump(record.point, 'turns served by the cheap model');
        break;
      case 'skill_activation':
        bump(record.point, 'embedding passes replaced by one call');
        break;
      default:
        break;
    }
  }

  // Relevance replaces one LLM call per invocation, whatever the verdict.
  const relevance = records.filter((r) => r.point === 'memory_relevance').length;
  if (relevance > 0)
    avoided.set('memory_relevance', { count: relevance, what: 'LLM selection calls replaced' });

  return [...avoided.entries()]
    .map(([point, { count, what }]) => ({ point, avoided: count, what }))
    .sort((a, b) => b.avoided - a.avoided);
}

export interface ClassificationResult {
  point: string;
  labelled: number;
  correct: number;
  accuracy: number;
}

export function classify(records: AnalysedRecord[], labels: Label[]): ClassificationResult[] {
  const byId = new Map(labels.map((label) => [label.id, label]));
  const byPoint = new Map<string, { labelled: number; correct: number }>();

  for (const record of records) {
    const label = byId.get(record.id);
    if (!label) continue;

    const verdict = singleVerdict(record, label.key);
    if (!verdict) continue;

    const stats = byPoint.get(record.point) ?? { labelled: 0, correct: 0 };
    stats.labelled++;
    if (verdict.value === label.outcome) stats.correct++;
    byPoint.set(record.point, stats);
  }

  return [...byPoint.entries()].map(([point, { labelled, correct }]) => ({
    point,
    labelled,
    correct,
    accuracy: labelled > 0 ? correct / labelled : 0,
  }));
}

export interface CalibrationBucket {
  range: string;
  n: number;
  meanConfidence: number;
  observedAccuracy: number;
}

/**
 * Does a stated confidence of 0.8 actually mean 80% right?
 *
 * If the buckets line up, the thresholds in the gates are meaningful and can
 * be tuned from data. If they do not, `confidence` is not a quantity worth
 * gating on, whatever the vendor claims.
 */
export function calibration(records: AnalysedRecord[], labels: Label[]): CalibrationBucket[] {
  const byId = new Map(labels.map((label) => [label.id, label]));
  const buckets = new Map<string, { n: number; confidenceSum: number; correct: number }>();

  for (const record of records) {
    const label = byId.get(record.id);
    if (!label) continue;

    const verdict = singleVerdict(record, label.key);
    if (!verdict) continue;

    const floor = Math.min(0.9, Math.floor(verdict.confidence * 10) / 10);
    const range = `${floor.toFixed(1)}-${(floor + 0.1).toFixed(1)}`;
    const bucket = buckets.get(range) ?? { n: 0, confidenceSum: 0, correct: 0 };

    bucket.n++;
    bucket.confidenceSum += verdict.confidence;
    if (verdict.value === label.outcome) bucket.correct++;
    buckets.set(range, bucket);
  }

  return [...buckets.entries()]
    .map(([range, b]) => ({
      range,
      n: b.n,
      meanConfidence: b.confidenceSum / b.n,
      observedAccuracy: b.correct / b.n,
    }))
    .sort((a, b) => a.range.localeCompare(b.range));
}

/** Weighted average gap between promised and observed accuracy. */
export function expectedCalibrationError(buckets: CalibrationBucket[]): number {
  const total = buckets.reduce((sum, b) => sum + b.n, 0);
  if (total === 0) return 0;
  return buckets.reduce(
    (sum, b) => sum + (b.n / total) * Math.abs(b.meanConfidence - b.observedAccuracy),
    0,
  );
}

/** Disagreement rate between a primary and a challenger, per point. */
export function agreement(
  records: AnalysedRecord[],
): { point: string; compared: number; agreed: number }[] {
  const byPoint = new Map<string, { compared: number; agreed: number }>();

  for (const record of records) {
    if (record.agreed === undefined) continue;
    const stats = byPoint.get(record.point) ?? { compared: 0, agreed: 0 };
    stats.compared++;
    if (record.agreed) stats.agreed++;
    byPoint.set(record.point, stats);
  }

  return [...byPoint.entries()].map(([point, s]) => ({ point, ...s }));
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatReport(records: AnalysedRecord[], labels: Label[]): string {
  const lines: string[] = [];
  const summaries = summarize(records);

  lines.push(`Decisions analysed: ${records.length}`, '');
  lines.push('Per decision point');
  lines.push('point                 count  errors   p50ms   p95ms  avg.conf  verdicts');
  for (const s of summaries) {
    const verdicts = Object.entries(s.verdicts)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    lines.push(
      `${s.point.padEnd(20)} ${String(s.decisions).padStart(6)} ${String(s.errors).padStart(7)} ` +
        `${String(s.p50Ms).padStart(7)} ${String(s.p95Ms).padStart(7)} ${s.avgConfidence.toFixed(2).padStart(9)}  ${verdicts}`,
    );
  }

  const saved = savings(records);
  if (saved.length > 0) {
    lines.push('', 'Work avoided');
    for (const s of saved)
      lines.push(`  ${s.point.padEnd(20)} ${String(s.avoided).padStart(6)}  ${s.what}`);
  }

  const agreements = agreement(records);
  if (agreements.length > 0) {
    lines.push('', 'Shadow agreement');
    for (const a of agreements) {
      lines.push(
        `  ${a.point.padEnd(20)} ${a.agreed}/${a.compared} (${pct(a.agreed / a.compared)})`,
      );
    }
  }

  if (labels.length > 0) {
    lines.push('', 'Accuracy against labels');
    for (const c of classify(records, labels)) {
      lines.push(`  ${c.point.padEnd(20)} ${c.correct}/${c.labelled} (${pct(c.accuracy)})`);
    }

    const buckets = calibration(records, labels);
    if (buckets.length > 0) {
      lines.push('', 'Calibration — stated confidence vs. observed accuracy');
      lines.push('  range        n   stated  observed');
      for (const b of buckets) {
        lines.push(
          `  ${b.range}  ${String(b.n).padStart(5)}   ${pct(b.meanConfidence).padStart(6)}  ${pct(b.observedAccuracy).padStart(8)}`,
        );
      }
      lines.push(`  expected calibration error: ${pct(expectedCalibrationError(buckets))}`);
    }
  } else {
    lines.push('', 'No labels supplied — accuracy and calibration skipped.');
    lines.push('Pass --labels <file.jsonl> with {"id","outcome"} rows to measure them.');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error(
      'usage: node scripts/analyze-decisions.ts <decisions.jsonl> [--labels <labels.jsonl>]',
    );
    process.exitCode = 1;
    return;
  }

  const labelsIndex = args.indexOf('--labels');
  const labelsFile = labelsIndex >= 0 ? args[labelsIndex + 1] : undefined;

  const records = parseJsonl<AnalysedRecord>(await readFile(file, 'utf8'));
  const labels = labelsFile ? parseJsonl<Label>(await readFile(labelsFile, 'utf8')) : [];

  console.log(formatReport(records, labels));
}

// Only runs as a CLI; importing the module for tests must not execute it.
if (argv[1] && pathToFileURL(argv[1]).href === import.meta.url) {
  await main();
}
