/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFromFile, saveToFile, serialize } from '../../src/persistence/serializer';
import { createPortfolioFrameDocument } from '../../src/examples/portfolioFrame';

afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  document.body.innerHTML = '';
});

function captureChooser(): () => HTMLInputElement {
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  return () => document.querySelector<HTMLInputElement>('input[type=file]')!;
}

describe('explicit portable scene files', () => {
  it('downloads actual serialized history without opening a native save picker', async () => {
    vi.useFakeTimers();
    const native = vi.fn(); Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: native });
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:scene-copy'); const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('frame.json'); expect(this.href).toBe('blob:scene-copy');
    });
    expect(await saveToFile(createPortfolioFrameDocument(20), 'frame.json', { portable: true })).toEqual({ ok: true, path: 'frame.json' });
    expect(native).not.toHaveBeenCalled(); expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.runAllTimersAsync(); expect(revokeObjectURL).toHaveBeenCalledWith('blob:scene-copy');
    expect(document.querySelector('a')).toBeNull();
  });

  it('imports selected scene bytes with feature and instance identities intact even when native pickers exist', async () => {
    const native = vi.fn(); Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: native });
    const chooser = captureChooser(); const source = createPortfolioFrameDocument(20); const encoded = serialize(source);
    if (!encoded.ok) throw new Error(encoded.error);
    const pending = loadFromFile({ portable: true }); const input = chooser();
    Object.defineProperty(input, 'files', { value: [{ name: 'saved-frame.json', text: async () => encoded.json }] });
    input.dispatchEvent(new Event('change'));
    const result = await pending; expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.document.features).toEqual(source.features);
    expect(result.document.componentInstances).toEqual(source.componentInstances);
    expect(native).not.toHaveBeenCalled(); expect(input.isConnected).toBe(false);
  });

  it('resolves a canceled chooser and removes its hidden input', async () => {
    const chooser = captureChooser(); const pending = loadFromFile({ portable: true }); const input = chooser();
    input.dispatchEvent(new Event('cancel'));
    expect(await pending).toEqual({ ok: false, error: 'Open cancelled' });
    expect(document.querySelector('input[type=file]')).toBeNull();
  });

  it.each(['invalid-json', 'read-error'])('returns a failed import for %s instead of leaving a pending promise', async mode => {
    const chooser = captureChooser(); const pending = loadFromFile({ portable: true }); const input = chooser();
    Object.defineProperty(input, 'files', { value: [{ name: 'broken.json', text: async () => {
      if (mode === 'read-error') throw new Error('read failed');
      return '{broken';
    } }] });
    input.dispatchEvent(new Event('change'));
    expect((await pending).ok).toBe(false); expect(input.isConnected).toBe(false);
  });

  it('preserves native Open behavior when portable mode is not requested', async () => {
    const source = createPortfolioFrameDocument(); const encoded = serialize(source);
    if (!encoded.ok) throw new Error(encoded.error);
    const native = vi.fn(async () => [{ name: 'native.json', getFile: async () => ({ text: async () => encoded.json }) }]);
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: native });
    expect((await loadFromFile()).ok).toBe(true); expect(native).toHaveBeenCalledOnce();
    expect(document.querySelector('input')).toBeNull();
  });
});
