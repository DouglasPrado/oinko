import { describe, it, expect } from 'vitest';
import {
  findNeverStore,
  maskPersonalIdentifiers,
  describeSensitiveKinds,
} from '../../../src/utils/sensitive-data.js';

const kinds = (text: string) => findNeverStore(text).map((f) => f.kind);

describe('findNeverStore', () => {
  it('finds a valid CPF with or without punctuation', () => {
    expect(kinds('meu CPF é 529.982.247-25')).toEqual(['cpf']);
    expect(kinds('cpf 52998224725 ok')).toEqual(['cpf']);
  });

  it('ignores eleven digits that fail the CPF check digits', () => {
    expect(kinds('pedido 529.982.247-24')).toEqual([]);
    expect(kinds('111.111.111-11')).toEqual([]);
  });

  it('finds a valid CNPJ', () => {
    expect(kinds('CNPJ 11.222.333/0001-81')).toEqual(['cnpj']);
    expect(kinds('11222333000181')).toEqual(['cnpj']);
  });

  it('finds a payment card that passes Luhn', () => {
    expect(kinds('cartão 4111 1111 1111 1111')).toEqual(['card']);
    expect(kinds('5555-5555-5555-4444')).toEqual(['card']);
  });

  it('lets the last four digits of a card through', () => {
    expect(kinds('o Visa final 4417')).toEqual([]);
  });

  it('does not mistake a Brazilian phone number for a card', () => {
    expect(kinds('+55 (11) 91234-5678')).toEqual([]);
    expect(kinds('5511912345678')).toEqual([]);
  });

  it('finds credentials: API keys, bearer tokens and stated passwords', () => {
    expect(kinds('key sk-abcdefghijklmnopqrstu')).toEqual(['credential']);
    expect(kinds('Authorization: Bearer abc.def.ghi')).toEqual(['credential']);
    expect(kinds('minha senha: hunter22')).toEqual(['credential']);
  });

  it('finds nothing in ordinary prose', () => {
    expect(kinds('Prefere respostas curtas e trabalha com TypeScript desde 2019.')).toEqual([]);
  });
});

describe('maskPersonalIdentifiers', () => {
  it('replaces identifiers and credentials, keeping the rest', () => {
    expect(maskPersonalIdentifiers('CPF 529.982.247-25, cartão 4111111111111111', '[x]')).toBe(
      'CPF [x], cartão [x]',
    );
  });
});

describe('describeSensitiveKinds', () => {
  it('names each kind once, in plain words', () => {
    const text = describeSensitiveKinds(findNeverStore('529.982.247-25 e 111.444.777-35'));
    expect(text).toBe('a CPF number');
  });
});
