// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFromFile } from '../../src/persistence/serializer';
import { createDefaultDocument } from '../../src/types';

afterEach(() => vi.restoreAllMocks());

function openInput() {
  const inputs: HTMLInputElement[] = [];
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) { inputs.push(this); });
  const result = loadFromFile();
  expect(inputs).toHaveLength(1);
  return { input: inputs[0]!, result };
}

describe('fallback file input', () => {
  it('resolves picker cancellation and removes event handlers', async () => {
    const { input, result } = openInput();
    expect(input.isConnected).toBe(true);
    expect(input.hidden).toBe(true);
    expect(input.getAttribute('aria-label')).toBe('Import scene JSON file');
    input.dispatchEvent(new Event('cancel'));
    await expect(result).resolves.toEqual({ ok: false, error: 'Open cancelled' });
    expect(input.onchange).toBeNull();
    expect(input.oncancel).toBeNull();
    expect(input.isConnected).toBe(false);
  });

  it('keeps cancellation settled when an earlier file read finishes later', async () => {
    const { input, result } = openInput();
    let complete!: (text: string) => void;
    const text = new Promise<string>((resolve) => { complete = resolve; });
    Object.defineProperty(input, 'files', { value: [{ name: 'late.json', text: () => text }] });
    input.dispatchEvent(new Event('change'));
    input.dispatchEvent(new Event('cancel'));
    await expect(result).resolves.toEqual({ ok: false, error: 'Open cancelled' });
    complete(JSON.stringify(createDefaultDocument('Late read')));
    await text;
    await expect(result).resolves.toEqual({ ok: false, error: 'Open cancelled' });
    expect(input.isConnected).toBe(false);
  });

  it('resolves an empty selection as cancellation', async () => {
    const { input, result } = openInput();
    input.dispatchEvent(new Event('change'));
    await expect(result).resolves.toEqual({ ok: false, error: 'Open cancelled' });
  });

  it('resolves a rejected file read rather than leaving a pending open operation', async () => {
    const { input, result } = openInput();
    Object.defineProperty(input, 'files', { value: [{ name: 'bad.json', text: () => Promise.reject(new Error('Read denied')) }] });
    input.dispatchEvent(new Event('change'));
    await expect(result).resolves.toEqual({ ok: false, error: 'Read denied' });
    expect(input.onchange).toBeNull();
  });

  it('resolves a valid selection', async () => {
    const { input, result } = openInput();
    Object.defineProperty(input, 'files', { value: [{ name: 'valid.json', text: () => Promise.resolve(JSON.stringify(createDefaultDocument('Loaded'))) }] });
    input.dispatchEvent(new Event('change'));
    await expect(result).resolves.toMatchObject({ ok: true, path: 'valid.json', document: { metadata: { name: 'Loaded' } } });
  });

  it('resolves picker opening errors', async () => {
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => { throw new Error('Picker unavailable'); });
    await expect(loadFromFile()).resolves.toEqual({ ok: false, error: 'Picker unavailable' });
  });
});
