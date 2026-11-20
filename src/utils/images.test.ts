import { describe, expect, it } from 'vitest';
import { fitWithin, splitDataUrl } from './images';

describe('fitWithin', () => {
  it('leaves small pictures alone', () => {
    expect(fitWithin(800, 600, 1568)).toEqual({ width: 800, height: 600 });
  });

  it('scales the longer side down and keeps proportions', () => {
    expect(fitWithin(3136, 1568, 1568)).toEqual({ width: 1568, height: 784 });
    expect(fitWithin(1000, 4000, 1000)).toEqual({ width: 250, height: 1000 });
  });

  it('never returns a zero-sized picture', () => {
    expect(fitWithin(10000, 1, 100)).toEqual({ width: 100, height: 1 });
    expect(fitWithin(0, 0, 100)).toEqual({ width: 1, height: 1 });
  });
});

describe('splitDataUrl', () => {
  it('separates the media type from the base64 data', () => {
    expect(splitDataUrl('data:image/png;base64,aGVsbG8=')).toEqual({
      mediaType: 'image/png',
      data: 'aGVsbG8=',
    });
  });

  it('rejects anything that is not a base64 data URL', () => {
    expect(splitDataUrl('https://example.com/a.png')).toBeNull();
    expect(splitDataUrl('data:text/plain,hello')).toBeNull();
  });
});
