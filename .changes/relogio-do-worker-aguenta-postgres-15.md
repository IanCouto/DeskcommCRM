---
impacto: nada_mudou
secao: corrigido
titulo: O relógio interno do assistente deixa de depender da versão do banco
---

Quando uma conexão de WhatsApp entra em espera, o sistema marca a fila com uma
data "infinita" — é assim que ele segura o atendimento até alguém resolver o
aviso. O cálculo de quanto falta para a próxima tarefa fazia uma conta com essa
data que **só funciona no Postgres 17**; em Postgres 15 ou 16 o banco recusa a
conta e o relógio do assistente para.

Isso nunca afetou quem seguiu a versão recomendada. Passa a importar agora que a
instalação aceita bancos mais antigos — e é exatamente onde apareceria: numa
máquina nova, com uma conexão em espera, sem nada na tela explicando.

A proteção já existia, mas na ordem errada: ela limitava o resultado da conta,
e a conta estourava antes. Agora limita a data antes de calcular.
