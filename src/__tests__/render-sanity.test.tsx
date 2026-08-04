import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

describe('sanity de render', () => {
  it('renderiza un componente RN básico', () => {
    const { getByText } = render(<Text>hola greenfit</Text>);
    expect(getByText('hola greenfit')).toBeTruthy();
  });
});
