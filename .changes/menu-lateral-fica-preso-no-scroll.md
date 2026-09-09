---
impacto: nada_mudou
secao: corrigido
titulo: O menu lateral para de subir junto com a página
---

Ao rolar uma tela longa, o menu da esquerda ia embora com o conteúdo. A trava
contra scroll horizontal da página (`overflow-x: hidden` no html e no body)
transformava os dois em um ancestral de rolagem, e o `sticky` da barra deixava
de prender na viewport.

A trava agora é `clip`: o estouro horizontal continua cortado, e o menu fica
no lugar.
