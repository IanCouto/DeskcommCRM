---
impacto: nada_mudou
secao: corrigido
titulo: O atendente de IA volta a achar horário quando consulta a agenda
---

Numa clínica, o atendente de IA tentou marcar um procedimento e não conseguiu —
duas vezes seguidas. Ele fez tudo certo: descobriu o tipo de atendimento,
resolveu a data que a pessoa pediu e foi consultar os horários. Mesmo assim
respondeu que a equipe precisava confirmar, e abriu um chamado interno.

A causa não era a agenda nem o atendente. Quando a IA não tem um dado opcional
para preencher — no caso, qual profissional atenderia —, alguns modelos escrevem
um código vazio em vez de simplesmente não mandar o campo. O sistema aceitava
esse código como se fosse um profissional de verdade, procurava a agenda de
alguém que não existe, e concluía que não havia horário publicado. Nenhum erro
aparecia em lugar nenhum: a consulta era registrada como bem-sucedida.

O sistema agora reconhece esses códigos vazios e os ignora, voltando a usar o
profissional configurado no tipo de atendimento. Isso valia para dezenas de
lugares além da agenda — inclusive a busca no acervo de conhecimento, em que o
efeito era o atendente responder "não sei" com o material publicado ao lado, e o
cadastro de negócios, em que um responsável inexistente ficava gravado e sumia
dos filtros por dono.
