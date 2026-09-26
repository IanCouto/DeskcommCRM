---
impacto: capacidade_nova
secao: adicionado
titulo: A integração que repete o pedido não cria dois textos sugeridos
---

Quando a integração que cria o texto sugerido repete o pedido — timeout, rede, retentativa do
ERP —, a porta `POST /api/v1/conversations/{id}/drafts` agora aceita `Idempotency-Key`, como os
outros POSTs de criação do produto: a mesma chave devolve a MESMA resposta gravada, sem criar um
segundo rascunho, e a mesma chave com conteúdo diferente responde 409. Sem o cabeçalho, nada muda
para quem já integra.

Crédito: @hiro-nikaitou.
