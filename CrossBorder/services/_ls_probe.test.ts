import { describe, it, expect } from 'vitest';
describe('ls', () => {
  it('works', () => {
    console.log('typeof', typeof localStorage);
    console.log('keys', localStorage && Object.keys(Object.getOwnPropertyDescriptors(localStorage)));
    console.log('setItem type', typeof localStorage?.setItem);
    console.log('proto', Object.getPrototypeOf(localStorage));
    try {
      localStorage.setItem('k', 'v');
      console.log('get', localStorage.getItem('k'));
    } catch (e) {
      console.log('err', e);
    }
    expect(typeof localStorage.setItem).toBe('function');
  });
});
