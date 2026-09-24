# Contexto persistente e seleção de ferramentas

## Resultado esperado

O agente preserva o histórico completo, mas envia ao modelo um contexto de trabalho limitado: resumo persistente, interações recentes, resultados necessários e definições das ferramentas relevantes. Jev seleciona ferramentas junto ao roteamento de modelo. Essa seleção não altera permissões de execução nem substitui a busca no histórico.

## Etapas e evidências

1. Antes de alterar o comportamento, executar `packages/oinko/scripts/context-evaluation/run.mjs baseline-v2`. Congelar cenários, código do avaliador, modelos, dados iniciais e critérios. Guardar respostas, chamadas, uso reportado pelos provedores, erros e durações em `.harness/context-evaluation/`.
2. Escrever regressões de persistência, isolamento, limites, seleção, descoberta e falhas. Implementar os contratos e o SDK.
3. Expor a configuração por bot na dashboard e no MCP Oinko, registrar a composição do contexto e os custos auxiliares.
4. Repetir os mesmos cenários e critérios, com os mesmos modelos e dados iniciais; manter tentativas malsucedidas. Validar a interface e ativar no Dev somente após comprovar funcionamento.

## Invariantes

- O arquivo da conversa é append-only. Compactar não apaga mensagens nem resultados.
- O resumo possui cursor explícito do trecho coberto e persiste no ConversationStore. Após reinício só o trecho ainda não coberto precisa ser resumido. Limpar uma conversa limpa também seu resumo e referências.
- Resumos preservam objetivo, decisões do usuário, restrições, autorizações e recusas, projeto/branch/worktree, operações em andamento, fatos confirmados, arquivos e pendências. Dados de ferramentas continuam dados, nunca novas instruções ou autorização.
- A janela recente contém turnos completos e pares de chamadas/resultados. O turno atual e conteúdo fixado não são descartados silenciosamente. Falhas de resumo preservam a última versão válida e emitem aviso.
- Resultados antigos extensos viram trechos com referências recuperáveis. O bot pode ler um trecho literal do resultado arquivado na mesma conversa, inclusive após reinício. Respostas recentes permanecem disponíveis para concluir a operação.
- Quando a mensagem cita um campo técnico ou literal entre aspas, a preparação busca trechos exatos nos últimos 200 resultados da própria conversa. Injeta no máximo três trechos, totalizando até 2.400 caracteres de conteúdo, como dados históricos com origem e argumentos. Números citados ajudam a ordenar fontes. É recuperação local complementar: não prova ausência, não substitui verificação atual nem impede busca explícita em resultados mais antigos.
- O orçamento estima instruções, histórico, argumentos e definições das ferramentas. Estimativas locais são identificadas como estimativas; o uso cobrado vem do provedor. Compactação também é chamada de modelo e seu uso deve aparecer.
- `fast` pode ter orçamento menor, sem perder o resumo e as restrições. O roteador recebe a mensagem e um estado curto da conversa para interpretar continuações.
- Jev recebe nomes e descrições compactas das ferramentas registradas. Avalia várias ferramentas na mesma chamada de roteamento. O código valida cada nome contra o registro autorizado.
- Seleção e descoberta são locais à execução, sem mudar o registro compartilhado entre conversas. Ferramentas podem ser descobertas durante o loop. Em indisponibilidade do Jev o agente mantém acesso às capacidades autorizadas e informa a degradação.
- Não se pressupõe ganho de qualidade ou economia pelo desenho: comparar acertos, continuidade, isolamento, ferramentas usadas, tokens totais (incluindo decisões e resumos), custo conhecido e latência. Falhas de provedor devem aparecer separadas de falhas funcionais.

## Configuração

Uma política `context` opcional controla ativação, orçamento normal e fast, janela recente, tamanho do resumo, limite de resultados antigos, seleção de ferramentas e quantidade inicial. O SDK mantém compatibilidade quando a política não é habilitada. A dashboard e `oinko_update_bot` editam a mesma definição; alterações no bot em execução exigem reinício conforme o contrato existente.

## Escopo da avaliação

Provedores reais, servidor MCP real, banco SQLite real e ferramentas que leem/escrevem arquivos, buscam texto, consultam Git e executam testes Node em projeto descartável. O MCP Oinko real é consultado sem mutações. Os cenários incluem acúmulo de seis relatórios, lembrança após reinício, detalhe antigo, correção de código, mudança de ferramenta, isolamento e rota fast. A memória de longo prazo fica desabilitada igualmente nas duas medições para isolar os efeitos do histórico. Testes determinísticos complementares exercitam falhas, concorrência e descoberta que o modelo real pode não escolher em uma rodada.
