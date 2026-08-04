import { classify, getBucket, formatCardTime } from '../../screens/user/NotificacionesMobileView';

describe('classify (Módulo 4 -- clasificador de notificaciones)', () => {
  it('clasifica como vencimiento cualquier aviso a deudores, sin mirar el texto', () => {
    expect(classify({ id: '1', title: 'Hola', body: 'sin pistas', createdAt: '', audienceType: 'debtors' })).toBe(
      'vencimiento'
    );
  });

  it('clasifica reserva por palabra clave en el cuerpo', () => {
    expect(
      classify({ id: '1', title: 'Todo listo', body: 'Confirmamos tu reserva para hoy', createdAt: '', audienceType: 'user' })
    ).toBe('reserva');
  });

  it('clasifica recordatorio', () => {
    expect(
      classify({ id: '1', title: 'Recordatorio', body: 'Tu clase empieza en breve', createdAt: '', audienceType: 'class' })
    ).toBe('recordatorio');
  });

  it('clasifica promoción/urgente', () => {
    expect(classify({ id: '1', title: '2x1 en Pases', body: 'Últimos lugares', createdAt: '', audienceType: 'all' })).toBe(
      'promocion'
    );
  });

  it('usa "novedad" como fallback cuando no matchea ninguna palabra clave', () => {
    expect(classify({ id: '1', title: 'Che', body: 'Cambiamos la música del box', createdAt: '', audienceType: 'all' })).toBe(
      'novedad'
    );
  });
});

describe('getBucket (agrupamiento temporal HOY/AYER/ESTA SEMANA)', () => {
  it('agrupa como HOY algo creado hace unos minutos', () => {
    expect(getBucket(new Date().toISOString())).toBe('HOY');
  });

  it('agrupa como AYER algo de hace 1 día', () => {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    expect(getBucket(ayer.toISOString())).toBe('AYER');
  });

  it('agrupa como ESTA SEMANA algo de hace 5 días', () => {
    const hace5dias = new Date();
    hace5dias.setDate(hace5dias.getDate() - 5);
    expect(getBucket(hace5dias.toISOString())).toBe('ESTA SEMANA');
  });

  it('agrupa como ANTERIORES algo de hace 20 días', () => {
    const hace20dias = new Date();
    hace20dias.setDate(hace20dias.getDate() - 20);
    expect(getBucket(hace20dias.toISOString())).toBe('ANTERIORES');
  });
});

describe('formatCardTime', () => {
  it('muestra hora (HH:mm) para HOY/AYER', () => {
    const iso = new Date('2026-08-04T15:30:00').toISOString();
    expect(formatCardTime(iso, 'HOY')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('muestra fecha corta (d/m) para ESTA SEMANA/ANTERIORES', () => {
    // El ICU embebido en el entorno de test no siempre zero-paddea
    // (devuelve "1/8" en vez de "01/08") -- el formato real en dispositivo
    // sí lo hace (mismo patrón que formatDayLabel en lib/classTime.ts).
    // Acá solo verificamos la forma día/mes, no el padding exacto.
    const iso = new Date('2026-08-01T15:30:00').toISOString();
    expect(formatCardTime(iso, 'ESTA SEMANA')).toMatch(/^\d{1,2}\/\d{1,2}$/);
  });
});
