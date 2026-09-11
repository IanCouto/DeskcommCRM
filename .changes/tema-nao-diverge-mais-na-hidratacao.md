---
impacto: nada_mudou
secao: corrigido
titulo: O seletor de tema não gera mais erro de hidratação no console
---

Quem tinha o tema escuro (ou claro) salvo via, no console do navegador, um aviso de "hydration mismatch" ao abrir qualquer tela — o React reclamando que o HTML do servidor e o do navegador não batiam no ícone e no texto do botão de tema. O visual não quebrava, mas o erro aparecia sempre. Agora a primeira renderização do navegador bate com a do servidor, e o tema salvo é aplicado logo em seguida, sem gerar aviso nenhum.
