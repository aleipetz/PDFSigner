# PDF Signer

App web para **assinar e preencher local e data em PDFs direto pelo celular**. A assinatura é a sua, feita à mão no papel: você fotografa uma vez e o app remove o fundo. O resultado é o **mesmo PDF original** com a assinatura e os textos aplicados por cima.

- Funciona no navegador do celular (Android e iPhone) e pode ser instalado como app (PWA).
- Tudo é processado no próprio aparelho. Nenhum documento é enviado para servidor.
- Funciona offline depois do primeiro acesso.

## Como usar

1. **Configure a assinatura (só na primeira vez).**
   - Assine numa folha branca, sem pauta, com caneta escura (azul ou preta).
   - Toque em *Configurar assinatura* → *Tirar foto* e fotografe de perto, com boa luz.
   - O app recorta e deixa o fundo transparente. Ajuste a *Sensibilidade* se algum traço sumir ou se aparecer sujeira. Escolha a cor (original, azul ou preta) e toque em *Salvar*.
   - Se preferir, use a aba *Desenhar* para assinar com o dedo.
   - Opcional: configure também uma **rubrica**.
2. **Abra o PDF** em *Abrir PDF*.
3. Escolha na barra inferior **Assinatura**, **Rubrica**, **Data**, **Local**, **Local e data** ou **Texto** e toque no lugar da página onde o item deve ficar.
   - Arraste o item para posicionar. Use a bolinha azul ou os botões A− e A+ para mudar o tamanho.
   - Para alterar um texto, toque em *Editar texto*. Há também *Duplicar* e *Excluir*.
   - O local fica salvo para as próximas vezes. O formato da data (`11/10/2026` ou `11 de outubro de 2026`) e a cor do texto ficam em ⚙︎ Configurações.
4. Toque em **Salvar PDF**: você pode *Compartilhar* (WhatsApp, e-mail…), *Baixar* ou *Abrir para conferir*. O arquivo sai como `nome-original_assinado.pdf`.

No Android, com o app instalado, também dá para abrir um PDF pelo menu *Compartilhar* de outros apps (WhatsApp, Gmail, Arquivos) e escolher *PDF Signer*.

## Publicação (GitHub Pages)

O workflow `.github/workflows/pages.yml` publica o app a cada push na branch `main`. Para ativar, faça uma vez:

1. No GitHub, abra **Settings → Pages**.
2. Em **Build and deployment → Source**, escolha **GitHub Actions**.

O app fica em `https://<seu-usuario>.github.io/pdfsigner/`. Abra esse endereço no celular e, para instalar:

- **Android (Chrome):** menu ⋮ → *Instalar app* (ou *Adicionar à tela inicial*).
- **iPhone (Safari):** botão Compartilhar → *Adicionar à Tela de Início*.

Para testar no computador: `python3 -m http.server` na pasta do projeto e abra `http://localhost:8000`.

## Observações

- A assinatura aplicada é uma **imagem da sua assinatura manuscrita**, equivalente a assinar o papel impresso e escanear. Não é uma *assinatura digital com certificado* (ICP-Brasil / gov.br). Se o documento exigir assinatura digital, use um serviço próprio para isso.
- Se o PDF original já tiver uma assinatura digital, ela é invalidada ao salvar, como acontece com qualquer edição.
- PDFs protegidos por senha não podem ser abertos.

## Tecnologia

HTML, CSS e JavaScript puro, sem etapa de build.

- [PDF.js](https://mozilla.github.io/pdf.js/) 4.10.38 (Apache-2.0) para exibir as páginas.
- [pdf-lib](https://pdf-lib.js.org/) 1.17.1 (MIT) para gravar no PDF original.

As duas bibliotecas estão em `vendor/`.
