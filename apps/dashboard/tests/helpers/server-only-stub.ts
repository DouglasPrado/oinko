// `server-only` existe para quebrar o build quando um modulo de servidor e
// importado pelo cliente. Em teste nao ha essa fronteira, e o pacote real
// recusaria a importacao — entao ele e substituido por este vazio.
export {};
