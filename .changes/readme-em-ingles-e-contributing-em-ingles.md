---
impacto: nada_mudou
secao: alterado
titulo: README em inglês volta a acompanhar o português e o CONTRIBUTING ganha versão em inglês
---

A decisão do mantenedor de 16/09/2026 (#890) manda `README.md` e `CONTRIBUTING.md` serem
mantidos em inglês ao lado das versões em português, e ela fecha dois buracos medidos:
`README.en.md` estava atrás do `README.md` em dois lugares — o parágrafo dos guias do
assistente de instalação (`scripts/instalar-guias.sh`, `.agents/skills/`) e a seção
`📁 Estrutura` —, e `CONTRIBUTING.en.md` não existia. Os dois parágrafos foram
traduzidos para o inglês sem mudar o conteúdo: comandos, caminhos de arquivo e
identificadores ficaram iguais, e a árvore de diretórios da seção `📁 Structure`
mantém os mesmos comentários por diretório. `CONTRIBUTING.en.md` é a tradução integral
de `CONTRIBUTING.md` (234 linhas), e ambos ganharam o seletor de idioma no topo, no
mesmo formato do `README.md`; os dois links para o CONTRIBUTING dentro do
`README.en.md` passaram a apontar para a versão em inglês. Nenhum outro arquivo mudou:
a seção `🧹 Desinstalar` e o comentário das extensões do Postgres continuam fora do
inglês — drift pré-existente, fora dos dois itens que a decisão nomeou.

Contribuição de @webtecnica (#890).
