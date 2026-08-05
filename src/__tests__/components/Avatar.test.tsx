import React from 'react';
import { render } from '@testing-library/react-native';
import Avatar, { getAvatarColor, getInitials } from '../../components/Avatar';

describe('Avatar (usado en Perfil, Feed, comentarios, Mensajes y Ranking)', () => {
  it('con `uri`, muestra la foto real (no cae al fallback de iniciales)', () => {
    const { toJSON, queryByText } = render(<Avatar uri="https://cdn/foto.jpg" name="Facundo Uria" />);
    expect(JSON.stringify(toJSON())).toContain('https://cdn/foto.jpg');
    expect(queryByText('FU')).toBeNull();
  });

  it('sin `uri`, cae al fallback de iniciales', () => {
    const { getByText } = render(<Avatar uri={null} name="Facundo Uria" />);
    expect(getByText('FU')).toBeTruthy();
  });

  it('sin `uri` y con un solo nombre, usa las primeras 2 letras', () => {
    const { getByText } = render(<Avatar uri={undefined} name="Martina" />);
    expect(getByText('MA')).toBeTruthy();
  });

  it('getAvatarColor da SIEMPRE el mismo color para el mismo nombre', () => {
    expect(getAvatarColor('Facundo Uria')).toBe(getAvatarColor('Facundo Uria'));
  });

  it('getInitials devuelve "?" ante un nombre vacío', () => {
    expect(getInitials('   ')).toBe('?');
  });
});
