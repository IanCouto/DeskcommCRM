"use client";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { apiClient } from "@/lib/api/client";

/**
 * Criar, editar e arquivar FUNIL — a escrita da tela do Kanban.
 *
 * ⚠️ NÃO HÁ QUERY AQUI, E NÃO É ECONOMIA. A lista vem do Server Component, e
 * relê por `router.refresh()`. Uma query client-side teria de chamar
 * `GET /api/v1/pipelines`, que exige `manager` — mas a tela do Kanban é aberta a
 * QUALQUER papel autenticado: um `agent` relendo por ali levaria 403 e ficaria
 * sem quadro nenhum. Uma fonte de verdade só (o servidor), e o papel que pode
 * LER continua diferente do papel que pode ESCREVER.
 *
 * ⚠️ RELÊ DEPOIS DE QUALQUER RESPOSTA — sucesso OU erro. Não há concorrência
 * otimista nestas rotas: duas abas editando a mesma lista terminam em "o último
 * ganha", e o 409 diz literalmente "recarregue a página". Reler é o preço
 * honesto numa tela de configuração ocasional.
 */

const ROTA = "/api/v1/pipelines";
const doFunil = (id: string) => `${ROTA}/${encodeURIComponent(id)}`;

/** O que o PATCH aceita. `depois_de` é o vizinho DE CIMA (`null` = primeiro da lista). */
export interface PatchDeFunil {
  name?: string;
  description?: string | null;
  is_default?: boolean;
  depois_de?: string | null;
}

function useReler() {
  const router = useRouter();
  return () => router.refresh();
}

export function useCriarFunil() {
  const reler = useReler();
  return useMutation({
    mutationFn: (name: string) => apiClient.post<unknown>(ROTA, { name }),
    onSettled: reler,
  });
}

export function useEditarFunil() {
  const reler = useReler();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PatchDeFunil }) =>
      apiClient.patch<unknown>(doFunil(id), patch),
    onSettled: reler,
  });
}

export function useArquivarFunil() {
  const reler = useReler();
  return useMutation({
    // `definitivo` só é aceito pelo caso limpo (funil que nunca recebeu negócio,
    // sem formulário e sem automação apontando para ele); no resto a rota recusa
    // com a explicação, e a tela a mostra.
    mutationFn: ({ id, definitivo }: { id: string; definitivo?: boolean }) =>
      apiClient.delete<unknown>(definitivo ? `${doFunil(id)}?definitivo=1` : doFunil(id)),
    onSettled: reler,
  });
}
