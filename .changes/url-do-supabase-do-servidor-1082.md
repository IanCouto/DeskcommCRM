---
impacto: capacidade_nova
secao: adicionado
titulo: O servidor pode falar com o Supabase por um endereço só dele
---

Quem tem o Supabase na mesma rede da instalação — Kong, Supabase self-host —
passa a poder declarar `SUPABASE_SERVER_URL=http://kong:8000` no `.env`. Aí o
app, o middleware e o worker do agente falam com o banco pelo caminho curto, e o
navegador continua na URL pública: o endpoint interno deixa de precisar estar
publicado na internet só para o servidor chegar nele.

Vazio é o padrão, e vazio é o que toda instalação já faz — nada muda para quem
não preencher. O valor tem de ser um endereço http(s) absoluto; se não for, o
servidor avisa no log e volta a usar a URL pública, em vez de derrubar a
instalação. É runtime puro: trocar o valor não pede rebuild da imagem.
