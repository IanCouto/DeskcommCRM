---
impacto: nada_mudou
secao: corrigido
titulo: O canal Zernio volta a enviar em quem configurou a partir do arquivo de exemplo
---

Quem conectou o canal Zernio numa instalação montada a partir do arquivo de
exemplo não conseguia enviar mensagem nenhuma por ele. As duas credenciais
estavam certas, o canal aparecia configurado, e o envio falhava assim mesmo —
tanto para quem deixou as credenciais na configuração quanto para quem as
cadastrou pela tela.

A causa estava no endereço do provedor. O arquivo de exemplo traz essa linha
vazia, e o comentário ao lado dela promete que vazio usa o endereço de produção
do provedor — a linha só existe para quem precisa apontar o sistema a um
ambiente de homologação. Não era o que acontecia: o vazio era tratado como se
fosse um endereço de verdade, e o sistema tentava falar com um lugar que não
existe.

Agora vazio significa o que o arquivo sempre disse que significava. Quem
preencheu a linha para apontar para homologação continua sendo respeitado, e
espaço sobrando em volta do endereço deixa de atrapalhar.

Ninguém precisa mexer em nada. Instalações que já enviavam seguem iguais, e as
que estavam com esse envio quebrado voltam a funcionar sozinhas.
