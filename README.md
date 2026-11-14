# Delp Copilot

Assistente de código **interno da Delp** para o VS Code. Conversa com um agente do **Microsoft Copilot Studio** usando a conta corporativa, lê os arquivos do projeto, propõe e aplica alterações (com revisão) e conhece a arquitetura dos nossos projetos **Fluig**.

> Distribuição apenas interna, via arquivo `.vsix`. Não publicar no Marketplace.

## O que ele faz

- **Chat lateral** com o arquivo aberto, a seleção ou arquivos anexados como contexto (`Ctrl+Alt+C`).
- **Modo agente**: lê sozinho os arquivos do repositório (`@ler`, `@buscar`, `@listar`), devolve edições em um ou vários arquivos e você revisa na pré-visualização do VS Code antes de aplicar — ou ativa **⚡ Aplicar automaticamente** (com botão Desfazer).
- **Ações no editor** (botão direito → Delp Copilot): explicar, refatorar, corrigir problemas, documentar, gerar testes, gerar código no cursor (`Ctrl+Alt+G`).
- **Especialista em Fluig**: guia de arquitetura da equipe embutido e **gerador da estrutura padrão Delp** (widget completo com build, formulário, dataset + SQL) pelos atalhos *Novo widget / formulário / dataset Fluig* ou pelo próprio agente (`@gerar`).
- **Design no padrão DELP**: guia de design enviado quando o assunto é tela/gráfico, gráficos prontos (`<ns>.grafico`, Chart.js real, paleta validada para daltonismo) no widget gerado, validação de cores/estilo e revisão de design por print.
- **Modos de trabalho**: ⚡ Corrido, 🧭 Planejado (plano em etapas com execução por etapa) e 💡 Planejamento (define a ideia e gera a especificação).
- **Escopo completo**: checklist conferido automaticamente, continuação de respostas cortadas e validação do código antes de concluir.
- **Referências de outras aplicações**: cite o caminho de outra pasta na mensagem e o agente segue o padrão dela, só lendo (nunca altera).
- **Histórico de conversas** por repositório, no estilo do Claude Code (busca, renomear, arquivar), e **imagens** no chat (Ctrl+V).
- **Troca de modelo** durante a conversa, **consumo estimado** com limite diário.

## Instalação rápida (usuário)

1. Peça ao responsável que **compartilhe o agente** "Delp Copilot Codigo" com você no Copilot Studio.
2. No VS Code: `Ctrl+Shift+X` → `⋯` → **Instalar do VSIX...** → selecione `delp-copilot-<versão>.vsix`.
3. `Ctrl+Shift+P` → **Reload Window**.
4. Abra a pasta do projeto, abra o chat (`Ctrl+Alt+C`) e envie uma mensagem.
5. Na primeira vez, entre com a conta Delp e aceite a permissão **"Allows Invoking Copilots"**.

Não é preciso privilégio de administrador nem configurar nada: o app do Entra ID e o agente já vêm configurados.

## Documentação

Na pasta `docs/` do repositório:

- `docs/INSTALACAO.md` — instalação do usuário, configuração inicial (Entra ID, Copilot Studio, compartilhamento) e solução de problemas.
- `docs/GUIA-DE-USO.md` — como usar o chat, o modo agente, as ações, a troca de modelo e os atalhos Fluig.
- `docs/MANUAL-TECNICO.md` — arquitetura, protocolos, configurações, segurança, build, testes e manutenção.
- `CHANGELOG.md` — histórico de versões.

## Desenvolvimento

```bash
npm install
npm test            # compila e roda os testes
npm run package     # gera delp-copilot-<versão>.vsix
```

`F5` abre uma janela de desenvolvimento com a pasta `sandbox/`.
