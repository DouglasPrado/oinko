/** Exibido quando o valor nao e conhecido. Nunca "US$ 0,00". */
export const UNKNOWN = '—';

/**
 * Formata custo em dolar preservando as casas que importam.
 *
 * Uma chamada custa fracoes de centavo, entao duas casas decimais
 * transformariam todo o painel em zeros. E `null` e "nao sei", nunca "de
 * graca": arredondar um custo desconhecido para US$ 0,00 e o jeito mais facil
 * de fazer um relatorio de custo mentir.
 */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return UNKNOWN;

  // Tres faixas, nao duas: um turno custa milesimos e uma conversa inteira
  // custa centesimos. Com duas casas fixas, US$ 0,0156 vira "US$ 0,02" e a
  // diferenca entre duas conversas desaparece justamente na escala em que se
  // compara uma com a outra.
  const magnitude = Math.abs(value);
  const digits = value === 0 ? 2 : magnitude < 0.01 ? 6 : magnitude < 1 ? 4 : 2;
  // Maximo, nao fixo: com casas fixas US$ 0,0048 sairia "0,004800", e os
  // zeros a direita nao dizem nada sobre o valor.
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  });
}
