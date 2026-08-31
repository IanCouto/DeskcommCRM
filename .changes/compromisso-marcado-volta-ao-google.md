---
impacto: nada_mudou
secao: corrigido
titulo: Compromisso marcado na agenda volta a aparecer no Google Calendar
---

Quem marca um horário na Agenda via instalação no plano gratuito da Vercel
via o compromisso nascer no sistema e nunca chegar ao Google Calendar. O
trabalho que publica lá só rodava no relógio da VPS; no Hobby esse relógio
não existe, e o único cron diário da Vercel cuida de outra coisa.

A marcação agora empurra o compromisso para o Google logo depois de
confirmar — sem a pessoa esperar —, e o relógio HTTP (o mesmo que já andava
os follow-ups) passa a renovar o token e a reenviar o que ficou pendente.

Para quem opera: nada a fazer. Nenhuma configuração nova, nenhum passo de
atualização.
