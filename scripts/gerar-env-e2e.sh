#!/usr/bin/env bash
#
# Gera o `.env.e2e` — o ambiente da suíte Playwright, apontado para o Supabase
# LOCAL.
#
# ═══ POR QUE ESTE ARQUIVO EXISTE ═══
#
# O `.env.local` de um checkout de trabalho normalmente aponta para o Supabase
# de PRODUÇÃO (é com ele que se desenvolve). O `playwright.config.ts` sobe o app
# com `next start`, que carrega `.env.local`. Resultado, medido em 2026-08-06:
# rodar `pnpm test:e2e` criava agentes, versões e conversas de teste **no banco
# real**, sem nenhum aviso — o teste passava, e o estrago era invisível.
#
# A saída não é "lembrar de trocar o .env.local antes de testar": isso é
# exatamente o tipo de disciplina que falha uma vez e ninguém percebe. É ter um
# arquivo separado que a suíte usa sempre.
#
# ═══ A ARMADILHA DAS VARS `NEXT_PUBLIC_*` ═══
#
# Elas são embutidas no BUNDLE durante o `next build`, não lidas no start.
# Trocar o env só na hora de subir o servidor deixaria a URL de produção dentro
# do JavaScript que roda no browser — e o teste passaria falando com a nuvem
# pela metade cliente. Por isso o build do e2e tem script próprio:
#
#   pnpm e2e:build && pnpm test:e2e
#
# Uso:
#   pnpm e2e:env      # (re)cria o .env.e2e a partir do stack local de pé
set -euo pipefail

cd "$(dirname "$0")/.."

if ! npx supabase status >/dev/null 2>&1; then
  echo "==> O Supabase local não está de pé. Rode 'npx supabase start' antes." >&2
  exit 1
fi

ENVOUT="$(npx supabase status -o env 2>/dev/null)"
ler() { printf '%s\n' "$ENVOUT" | grep "^$1=" | cut -d= -f2- | tr -d '"'; }

API_URL="$(ler API_URL)"
ANON="$(ler ANON_KEY)"
SERVICE="$(ler SERVICE_ROLE_KEY)"

if [ -z "$API_URL" ] || [ -z "$ANON" ] || [ -z "$SERVICE" ]; then
  echo "==> Não consegui ler as chaves do stack local (API_URL/ANON_KEY/SERVICE_ROLE_KEY)." >&2
  exit 1
fi

# Guarda contra o erro que este arquivo existe para impedir. Se um dia o
# `supabase status` devolver um host remoto (config apontada para projeto
# linkado, por exemplo), é melhor falhar aqui do que gerar um `.env.e2e` que
# manda a suíte para a nuvem — o modo de falha silencioso é o caro.
case "$API_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *)
    echo "==> RECUSADO: o stack local respondeu com uma URL que não é local: $API_URL" >&2
    exit 1
    ;;
esac

cat > .env.e2e <<EOF
# ── Ambiente do E2E — LOCAL, nunca a nuvem ──────────────────────────────────
# GERADO por 'pnpm e2e:env'. Não versionado (.gitignore cobre '.env*').
# Antes de rodar a suíte: pnpm e2e:build && pnpm test:e2e
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

# Placeholders: 'next start' roda em NODE_ENV=production, e lib/env.ts exige
# estas vars em produção. As specs não exercitam os serviços por trás delas.
# Valores iguais aos do CI (.github/workflows/e2e.yml), para que local e CI
# falhem pelos mesmos motivos.
INTERNAL_SECRET=e2e-placeholder-nao-e-segredo
CPF_ENCRYPTION_KEY=e2e-placeholder-nao-e-segredo
WAHA_BYO_ENCRYPTION_KEY=e2e-placeholder-nao-e-segredo
AI_CRED_AES_KEY=e2e-placeholder-nao-e-segredo
WAHA_API_BASE_URL=http://127.0.0.1:3999
WAHA_API_KEY=e2e-placeholder-nao-e-segredo
WAHA_WEBHOOK_BASE_URL=http://127.0.0.1:3001
UPSTASH_REDIS_REST_URL=http://127.0.0.1:3998
UPSTASH_REDIS_REST_TOKEN=e2e-placeholder-nao-e-segredo
NEXT_TELEMETRY_DISABLED=1
EOF

echo "==> .env.e2e gerado, apontando para $API_URL"
echo "==> Próximo: pnpm e2e:build && pnpm test:e2e"
