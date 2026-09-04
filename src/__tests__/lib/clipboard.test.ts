import { copyToClipboard } from '../../lib/clipboard';

describe('copyToClipboard (sin expo-clipboard -- navigator.clipboard en Web, no-op en nativo)', () => {
  const originalNavigator = (global as any).navigator;

  afterEach(() => {
    (global as any).navigator = originalNavigator;
  });

  it('devuelve true y copia el texto cuando navigator.clipboard.writeText existe (Web)', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    (global as any).navigator = { clipboard: { writeText } };

    const ok = await copyToClipboard('greenfit.alias');

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('greenfit.alias');
  });

  it('devuelve false sin romper cuando no hay navigator.clipboard (nativo)', async () => {
    (global as any).navigator = {};
    await expect(copyToClipboard('greenfit.alias')).resolves.toBe(false);
  });

  it('devuelve false sin romper si writeText rechaza (ej. permiso denegado por el navegador)', async () => {
    (global as any).navigator = { clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denegado')) } };
    await expect(copyToClipboard('greenfit.alias')).resolves.toBe(false);
  });
});
